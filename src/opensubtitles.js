import AdmZip from "adm-zip";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { decodeSubtitleBuffer } from "./subtitles.js";

const gunzip = promisify(zlib.gunzip);
const API_ROOT = "https://api.opensubtitles.com/api/v1";
const searchCache = new Map();
let authToken = process.env.OPENSUBTITLES_TOKEN || null;
let authTokenAt = authToken ? Date.now() : 0;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function headers(withAuth = false) {
  const result = {
    "Api-Key": required("OPENSUBTITLES_API_KEY"),
    "User-Agent": process.env.OPENSUBTITLES_USER_AGENT || "SKCZAITranslator v1.0.6",
    Accept: "application/json"
  };
  if (withAuth && authToken) result.Authorization = `Bearer ${authToken}`;
  return result;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = typeof data === "object" ? data?.message || data?.error : data;
    const error = new Error(`OpenSubtitles ${response.status}: ${message || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function login() {
  if (authToken && Date.now() - authTokenAt < 22 * 60 * 60 * 1000) return authToken;
  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;
  if (!username || !password) return authToken;
  const data = await apiFetch(`${API_ROOT}/login`, {
    method: "POST",
    headers: { ...headers(false), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  authToken = data?.token || null;
  authTokenAt = Date.now();
  return authToken;
}

function scoreResult(entry, videoHash) {
  const a = entry?.attributes || {};
  let score = 0;
  if (videoHash && String(a.moviehash_match) === "true") score += 100000;
  if (a.from_trusted) score += 5000;
  if (!a.machine_translated) score += 2000;
  if (!a.hearing_impaired) score += 1000;
  score += Number(a.ratings || 0) * 100;
  score += Math.log10(Number(a.download_count || 0) + 1) * 100;
  return score;
}

export async function searchSubtitles({ type, imdbId, season, episode, videoHash, videoSize, query, sources = ["en"], maxCandidates = 2 }) {
  const ttl = Math.max(1, Number(process.env.SEARCH_CACHE_TTL_MINUTES || 60)) * 60 * 1000;
  const cacheKey = JSON.stringify({ type, imdbId, season, episode, videoHash, videoSize, query, sources, maxCandidates });
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ttl) return cached.value;

  const params = new URLSearchParams();
  params.set("languages", sources.join(","));
  params.set("type", type === "series" ? "episode" : "movie");
  params.set("order_by", "download_count");
  params.set("order_direction", "desc");
  if (videoHash) params.set("moviehash", videoHash);
  if (videoSize) params.set("moviebytesize", String(videoSize));
  if (imdbId) params.set("imdb_id", String(imdbId).replace(/^tt/i, ""));
  if (!imdbId && query) params.set("query", query);
  if (type === "series" && season) params.set("season_number", String(season));
  if (type === "series" && episode) params.set("episode_number", String(episode));

  const data = await apiFetch(`${API_ROOT}/subtitles?${params.toString()}`, { headers: headers(false) });
  const candidates = (data?.data || [])
    .flatMap((entry) => {
      const attributes = entry.attributes || {};
      return (attributes.files || []).map((file) => ({
        fileId: file.file_id,
        fileName: file.file_name || attributes.release || `subtitle-${file.file_id}.srt`,
        language: attributes.language,
        release: attributes.release || "",
        hearingImpaired: Boolean(attributes.hearing_impaired),
        score: scoreResult(entry, videoHash)
      }));
    })
    .filter((item) => item.fileId && item.language)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  searchCache.set(cacheKey, { at: Date.now(), value: candidates });
  return candidates;
}

export async function getDownloadLink(fileId) {
  await login();
  const request = async () => apiFetch(`${API_ROOT}/download`, {
    method: "POST",
    headers: { ...headers(Boolean(authToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: Number(fileId), sub_format: "srt" })
  });
  try {
    return await request();
  } catch (error) {
    if (error.status === 401 && process.env.OPENSUBTITLES_USERNAME && process.env.OPENSUBTITLES_PASSWORD) {
      authToken = null;
      await login();
      return request();
    }
    throw error;
  }
}

export async function downloadSubtitleText(fileId) {
  const info = await getDownloadLink(fileId);
  if (!info?.link) throw new Error("OpenSubtitles did not return a download link");
  const response = await fetch(info.link, { redirect: "follow" });
  if (!response.ok) throw new Error(`Subtitle download failed with HTTP ${response.status}`);
  let buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntries().find((item) => !item.isDirectory && /\.(srt|vtt|ass|ssa)$/i.test(item.entryName));
    if (!entry) throw new Error("ZIP archive does not contain a supported subtitle file");
    buffer = entry.getData();
  } else if ((buffer[0] === 0x1f && buffer[1] === 0x8b) || contentType.includes("gzip")) {
    buffer = await gunzip(buffer);
  }
  return decodeSubtitleBuffer(buffer);
}
