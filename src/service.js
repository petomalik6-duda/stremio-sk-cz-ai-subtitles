import { searchSubtitles, downloadSubtitleText } from "./opensubtitles.js";
import { parseSubtitle, toWebVtt } from "./subtitles.js";
import { translateCues } from "./gemini.js";
import { readIfExists, writeAtomic, sourcePath, translatedPath } from "./cache.js";
import { signPayload } from "./token.js";
import { LANGUAGE_META } from "./config.js";

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

export async function listTranslationOptions({ req, config, type, id, extra }) {
  const { parseMediaId } = await import("./media.js");
  const media = parseMediaId(type, id);
  if (!media.imdbId) return [];
  const candidates = await searchSubtitles({
    type,
    imdbId: media.imdbId,
    season: media.season,
    episode: media.episode,
    videoHash: extra.videoHash,
    sources: config.sources,
    maxCandidates: config.maxCandidates
  });
  const base = publicBase(req);
  const subtitles = [];
  for (const candidate of candidates) {
    for (const target of config.targets) {
      const token = signPayload({
        fileId: candidate.fileId,
        source: candidate.language,
        target,
        fileName: candidate.fileName,
        mediaId: id,
        version: 1
      });
      subtitles.push({
        id: `ai-${target}-${candidate.fileId}`,
        lang: LANGUAGE_META[target].stremio,
        url: `${base}/translated/${token}.vtt`
      });
    }
  }
  return subtitles;
}

export async function buildTranslatedSubtitle(payload) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const translationKey = [payload.fileId, payload.source, payload.target, model, "prompt-v1"].join(":");
  const targetFile = translatedPath(translationKey);
  const cached = await readIfExists(targetFile);
  if (cached) return { vtt: cached, cached: true };

  return once(translationKey, async () => {
    const secondCheck = await readIfExists(targetFile);
    if (secondCheck) return { vtt: secondCheck, cached: true };
    const sourceFile = sourcePath(payload.fileId);
    let original = await readIfExists(sourceFile);
    if (!original) {
      original = await downloadSubtitleText(payload.fileId);
      await writeAtomic(sourceFile, original);
    }
    const cues = parseSubtitle(original);
    const translated = await translateCues(cues, payload.source, payload.target);
    const vtt = toWebVtt(translated);
    await writeAtomic(targetFile, vtt);
    return { vtt, cached: false };
  });
}
