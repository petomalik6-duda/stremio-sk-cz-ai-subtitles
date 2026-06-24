import { searchSubtitles, downloadSubtitleText } from "./opensubtitles.js";
import { parseSubtitle, toSrt } from "./subtitles.js";
import { translateCues, translateSrtDocument } from "./deepl.js";
import crypto from "node:crypto";
import {
  readIfExists,
  writeAtomic,
  sourcePath,
  translatedPath,
  writeJob,
  jobOutputPath
} from "./cache.js";
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

function createJobId(lookup, target, candidateIndex, mediaId) {
  const stable = JSON.stringify({ lookup, target, candidateIndex, mediaId, version: 5 });
  return crypto.createHmac("sha256", process.env.TOKEN_SECRET || "missing-secret")
    .update(stable)
    .digest("hex")
    .slice(0, 32);
}

export async function listTranslationOptions({ req, config, type, id, extra }) {
  const media = parseMediaId(type, id, extra);
  const base = publicBase(req);
  const subtitles = [];
  const lookup = compactLookup(media, type, config.sources, config.maxCandidates);

  for (const target of config.targets) {
    for (let candidateIndex = 0; candidateIndex < config.maxCandidates; candidateIndex += 1) {
      const payload = {
        lookup,
        target,
        candidateIndex,
        mediaId: id,
        version: 5,
        exp: Date.now() + Math.max(1, Number(process.env.SIGNED_URL_TTL_HOURS || 168)) * 60 * 60 * 1000
      };
      const jobId = createJobId(lookup, target, candidateIndex, id);
      await writeJob(jobId, payload);

      const output = await readIfExists(jobOutputPath(jobId));
      const state = getTranslationJobState(jobId);
      const ready = Boolean(output || state?.status === "done");

      // Start the preferred source variant before the user selects it. This makes
      // the first visible result much faster without translating every fallback.
      if (candidateIndex === 0 && !ready && hasLookupClue(media)) {
        startTranslationJob(jobId, payload);
      }

      const revision = ready
        ? `ready-${state?.finishedAt || "disk"}`
        : `pending-${Math.floor(Date.now() / 15000)}`;
      subtitles.push({
        id: `skcz-deepl-${target}-${candidateIndex + 1}-${ready ? "ready" : "online"}-${crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 8)}`,
        lang: LANGUAGE_META[target].stremio,
        url: `${base}/t/${jobId}.srt?v=${encodeURIComponent(revision)}`
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
  if (!candidate) throw new Error("OpenSubtitles nenašlo vhodné zdrojové titulky pre toto video.");
  return candidate;
}

export async function buildTranslatedSubtitle(payload) {
  const candidate = await resolveCandidate(payload);
  const mode = String(process.env.DEEPL_TRANSLATION_MODE || "document").trim().toLowerCase();
  const providerRevision = `deepl:${mode}:${process.env.DEEPL_MODEL_TYPE || "prefer_quality_optimized"}`;
  const sourceLanguage = candidate.language || payload.source || "en";
  const translationKey = [candidate.fileId, sourceLanguage, payload.target, providerRevision, "deepl-srt-v1"].join(":");
  const targetFile = translatedPath(translationKey);
  const cached = await readIfExists(targetFile);
  if (cached) return { srt: cached, cached: true, cueCount: null, candidate };

  return once(translationKey, async () => {
    const secondCheck = await readIfExists(targetFile);
    if (secondCheck) return { srt: secondCheck, cached: true, cueCount: null, candidate };
    const sourceFile = sourcePath(candidate.fileId);
    let original = await readIfExists(sourceFile);
    if (!original) {
      original = await downloadSubtitleText(candidate.fileId);
      await writeAtomic(sourceFile, original);
    }
    const cues = parseSubtitle(original);
    const normalizedSrt = toSrt(cues);
    let srt = null;
    let method = "text";

    if (mode !== "text") {
      try {
        srt = await translateSrtDocument(normalizedSrt, sourceLanguage, payload.target);
        // Validate that DeepL returned a readable subtitle file. Normalize it once
        // more to keep Stremio compatibility and UTF-8 BOM/comma timestamps.
        const translatedDocumentCues = parseSubtitle(srt);
        srt = toSrt(translatedDocumentCues);
        method = "document";
      } catch (error) {
        const fallbackAllowed = String(process.env.DEEPL_TEXT_FALLBACK || "true").toLowerCase() !== "false";
        if (!fallbackAllowed || [403, 456].includes(Number(error?.status))) throw error;
        console.warn(`[deepl] dokumentový režim zlyhal, používam textový fallback: ${error.message}`);
      }
    }

    if (!srt) {
      const translated = await translateCues(cues, sourceLanguage, payload.target);
      srt = toSrt(translated);
      method = "text";
    }

    await writeAtomic(targetFile, srt);
    return { srt, cached: false, cueCount: cues.length, candidate, method };
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
    .then(async (result) => {
      await writeAtomic(jobOutputPath(jobId), result.srt);
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
    cached: state.result?.cached ?? null,
    cueCount: state.result?.cueCount ?? null,
    fileId: state.result?.candidate?.fileId ?? null,
    method: state.result?.method ?? null
  };
}

export async function getReadyJobOutput(jobId) {
  const state = translationJobs.get(jobId);
  if (state?.status === "done" && state.result?.srt) return state.result;
  const disk = await readIfExists(jobOutputPath(jobId));
  if (disk) return { srt: disk, cached: true, cueCount: null };
  return null;
}

export async function waitForTranslationJob(state, timeoutMs = 12000) {
  if (!state) return null;
  if (state.status === "done") return state.result;
  if (state.status === "error") throw new Error(state.error || "Preklad zlyhal");
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, Number(timeoutMs) || 0));
    timer.unref?.();
  });
  return Promise.race([state.promise, timeout]);
}
