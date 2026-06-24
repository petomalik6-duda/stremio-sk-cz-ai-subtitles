export function parseMediaId(type, rawId) {
  const parts = String(rawId || "").split(":");
  const imdb = parts[0].match(/^tt(\d+)$/i);
  if (!imdb) return { imdbId: null, season: null, episode: null };
  const season = type === "series" && parts[1] ? Number(parts[1]) : null;
  const episode = type === "series" && parts[2] ? Number(parts[2]) : null;
  return {
    imdbId: imdb[1],
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null
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
