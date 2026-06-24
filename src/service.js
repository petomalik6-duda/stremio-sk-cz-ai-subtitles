import { searchSubtitles, downloadSubtitleText } from "./opensubtitles.js";
import { parseSubtitle, toWebVtt } from "./subtitles.js";
import { translateCues } from "./gemini.js";
import crypto from "node:crypto";
import { readIfExists, writeAtomic, sourcePath, translatedPath, writeJob } from "./cache.js";
import { LANGUAGE_META } from "./config.js";
import { parseMediaId } from "./media.js";

const inFlight = new Map();

const translationJobs = new Map();

function pruneTranslationJobs() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [jobId, state] of translationJobs.entries()) {
    const timestamp = state.finishedAt || state.startedAt || 0;
    if (timestamp < cutoff) translationJobs.delete(jobId);
  }
}

setInterval(pruneTranslationJobs, 30 * 60 * 1000).unref();

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
  const base = publicBase(req);
  const subtitles = [];
  const lookup = compactLookup(media, type, config.sources, config.maxCandidates);

  // Keep URLs short for Android TV / Google TV clients. The full lookup payload is
  // stored server-side and addressed by a compact job id.
  for (const target of config.targets) {
    for (let candidateIndex = 0; candidateIndex < config.maxCandidates; candidateIndex += 1) {
      const payload = {
        lookup,
        target,
        candidateIndex,
        mediaId: id,
        version: 3,
        exp: Date.now() + Math.max(1, Number(process.env.SIGNED_URL_TTL_HOURS || 168)) * 60 * 60 * 1000
      };
      const stable = JSON.stringify({ lookup, target, candidateIndex, mediaId: id, version: 3 });
      const jobId = crypto.createHmac("sha256", process.env.TOKEN_SECRET || "missing-secret")
        .update(stable)
        .digest("hex")
        .slice(0, 32);
      await writeJob(jobId, payload);
      subtitles.push({
        id: `skcz-ai-${target}-${candidateIndex + 1}-${crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 10)}`,
        lang: LANGUAGE_META[target].stremio,
        url: `${base}/t/${jobId}.vtt`
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


export function startTranslationJob(jobId, payload) {
  const existing = translationJobs.get(jobId);
  if (existing && (existing.status === "pending" || existing.status === "done")) return existing;

  const state = {
    jobId,
    status: "pending",
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    result: null,
    promise: null
  };

  state.promise = buildTranslatedSubtitle(payload)
    .then((result) => {
      state.status = "done";
      state.finishedAt = Date.now();
      state.result = result;
      return result;
    })
    .catch((error) => {
      state.status = "error";
      state.finishedAt = Date.now();
      state.error = error instanceof Error ? error.message : String(error);
      throw error;
    });

  // Prevent an unhandled rejection when the HTTP request has already returned
  // the loading subtitle while translation continues in the background.
  state.promise.catch(() => {});
  translationJobs.set(jobId, state);
  return state;
}

export function getTranslationJobState(jobId) {
  const state = translationJobs.get(jobId);
  if (!state) return null;
  return {
    jobId: state.jobId,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error,
    cached: state.result?.cached ?? null
  };
}

export async function waitForTranslationJob(state, timeoutMs = 2500) {
  if (!state) return null;
  if (state.status === "done") return state.result;
  if (state.status === "error") throw new Error(state.error || "Preklad zlyhal");
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, Number(timeoutMs) || 0));
    timer.unref?.();
  });
  return Promise.race([state.promise, timeout]);
}
