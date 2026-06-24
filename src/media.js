import path from "node:path";

function parseEpisodeHint(value = "") {
  const text = String(value || "");
  const stremio = text.match(/(?:^|:)(\d+):(\d+)$/);
  if (stremio) return { season: Number(stremio[1]), episode: Number(stremio[2]) };
  const filename = text.match(/\bS(\d{1,3})E(\d{1,3})\b/i);
  if (filename) return { season: Number(filename[1]), episode: Number(filename[2]) };
  return { season: null, episode: null };
}

function cleanFilename(value = "") {
  const base = path.basename(String(value || ""));
  return base
    .replace(/\.(mkv|mp4|avi|mov|webm|m4v)$/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web[- ]?dl|hdtv|x26[45]|hevc|aac|dts|hdr|dv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMediaId(type, rawId, extra = {}) {
  const idCandidates = [
    extra.videoId,
    extra.videoID,
    extra.video_id,
    extra.id,
    rawId,
    extra.filename
  ].filter(Boolean).map(String);

  let imdbId = null;
  let stremioVideoId = null;
  for (const candidate of idCandidates) {
    const match = candidate.match(/(tt\d{5,})(?::(\d+):(\d+))?/i);
    if (!match) continue;
    imdbId = match[1].slice(2);
    stremioVideoId = match[0];
    break;
  }

  const episodeHints = [extra.videoId, extra.videoID, rawId, extra.filename]
    .filter(Boolean)
    .map(parseEpisodeHint)
    .find((hint) => hint.season && hint.episode) || { season: null, episode: null };

  const explicitSeason = Number(extra.season || extra.season_number || 0) || null;
  const explicitEpisode = Number(extra.episode || extra.episode_number || 0) || null;
  const season = type === "series" ? (explicitSeason || episodeHints.season) : null;
  const episode = type === "series" ? (explicitEpisode || episodeHints.episode) : null;

  const raw = String(rawId || "");
  const rawLooksLikeHash = /^[a-f0-9]{16}$/i.test(raw);
  const videoHash = String(extra.videoHash || extra.moviehash || (rawLooksLikeHash ? raw : "") || "") || null;
  const filename = String(extra.filename || extra.fileName || "") || null;
  const query = filename ? cleanFilename(filename) : null;

  return {
    imdbId,
    stremioVideoId,
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
    videoHash,
    videoSize: Number(extra.videoSize || extra.video_size || 0) || null,
    filename,
    query
  };
}

export function parseExtra(extraString = "", query = {}) {
  const result = { ...query };
  for (const part of String(extraString || "").replace(/\.json$/, "").split("&")) {
    if (!part) continue;
    const [key, ...rest] = part.split("=");
    if (!key) continue;
    result[decodeURIComponent(key)] = decodeURIComponent(rest.join("=") || "");
  }
  return result;
}
