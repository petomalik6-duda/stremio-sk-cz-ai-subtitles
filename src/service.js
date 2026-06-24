import { searchSubtitles, downloadSubtitleText } from "./opensubtitles.js";
import { parseSubtitle, toWebVtt } from "./subtitles.js";
import { translateCues } from "./gemini.js";
import { readIfExists, writeAtomic, sourcePath, translatedPath } from "./cache.js";
import { signPayload } from "./token.js";
import { LANGUAGE_META } from "./config.js";
import { parseMediaId } from "./media.js";

const inFlight = new Map();

async function once(key, worker) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = worker().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${req.get("host")}`;
}

function compactLookup(media, type, sources, maxCandidates) {
  return {
    type,
    imdbId: media.imdbId,
    season: media.season,
    episode: media.episode,
    videoHash: media.videoHash,
    videoSize: media.videoSize,
    query: media.query,
    sources,
    maxCandidates
  };
}

function hasLookupClue(media) {
  return Boolean(media.imdbId || media.videoHash || media.query);
}

export function describeLookup({ type, id, extra, config }) {
  const media = parseMediaId(type, id, extra);
  return {
    media,
    usable: hasLookupClue(media),
    targets: config.targets,
    sources: config.sources,
    maxCandidates: config.maxCandidates
  };
}

export async function listTranslationOptions({ req, config, type, id, extra }) {
  const media = parseMediaId(type, id, extra);
  if (!hasLookupClue(media)) return [];

  const base = publicBase(req);
  const subtitles = [];
  const lookup = compactLookup(media, type, config.sources, config.maxCandidates);

  // Lazy translation entries: OpenSubtitles search starts only when the user selects a track.
  for (const target of config.targets) {
    for (let candidateIndex = 0; candidateIndex < config.maxCandidates; candidateIndex += 1) {
      const token = signPayload({
        lookup,
        target,
        candidateIndex,
        mediaId: id,
        version: 2
      });
      subtitles.push({
        id: `ai-${target}-${candidateIndex + 1}-${String(id).slice(0, 32)}`,
        lang: LANGUAGE_META[target].stremio,
        url: `${base}/translated/${token}.vtt`
      });
    }
  }
  return subtitles;
}

async function resolveCandidate(payload) {
  if (payload.fileId) {
    return {
      fileId: payload.fileId,
      language: payload.source,
      fileName: payload.fileName || `subtitle-${payload.fileId}.srt`
    };
  }

  const lookup = payload.lookup || {};
  const candidates = await searchSubtitles(lookup);
  const index = Math.max(0, Number(payload.candidateIndex || 0));
  const candidate = candidates[index] || candidates[0];
  if (!candidate) {
    throw new Error("OpenSubtitles nenašlo vhodné zdrojové titulky pre toto video.");
  }
  return candidate;
}

export async function buildTranslatedSubtitle(payload) {
  const candidate = await resolveCandidate(payload);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const sourceLanguage = candidate.language || payload.source || "en";
  const translationKey = [candidate.fileId, sourceLanguage, payload.target, model, "prompt-v2"].join(":");
  const targetFile = translatedPath(translationKey);
  const cached = await readIfExists(targetFile);
  if (cached) return { vtt: cached, cached: true };

  return once(translationKey, async () => {
    const secondCheck = await readIfExists(targetFile);
    if (secondCheck) return { vtt: secondCheck, cached: true };
    const sourceFile = sourcePath(candidate.fileId);
    let original = await readIfExists(sourceFile);
    if (!original) {
      original = await downloadSubtitleText(candidate.fileId);
      await writeAtomic(sourceFile, original);
    }
    const cues = parseSubtitle(original);
    if (!cues.length) throw new Error("Zdrojový titulkový súbor neobsahuje žiadne čitateľné repliky.");
    const translated = await translateCues(cues, sourceLanguage, payload.target);
    const vtt = toWebVtt(translated);
    await writeAtomic(targetFile, vtt);
    return { vtt, cached: false };
  });
}
