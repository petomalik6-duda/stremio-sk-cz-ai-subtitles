const DEFAULT_SOURCES = String(process.env.DEFAULT_SOURCE_LANGUAGES || "en")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DEFAULT_CONFIG = Object.freeze({
  targets: ["sk", "cs"],
  sources: DEFAULT_SOURCES.length ? DEFAULT_SOURCES : ["en"],
  maxCandidates: Math.min(3, Math.max(1, Number(process.env.MAX_SOURCE_CANDIDATES || 2)))
});

const TARGETS = new Set(["sk", "cs"]);
const SOURCES = new Set(["en", "de", "pl", "es", "fr", "it", "pt", "uk", "ru"]);

function unique(values) {
  return [...new Set(values)];
}

export function normalizeConfig(input = {}) {
  const targets = unique(Array.isArray(input.targets) ? input.targets : DEFAULT_CONFIG.targets)
    .filter((value) => TARGETS.has(value));
  const sources = unique(Array.isArray(input.sources) ? input.sources : DEFAULT_CONFIG.sources)
    .filter((value) => SOURCES.has(value));
  const serverMaximum = Math.min(3, Math.max(1, Number(process.env.MAX_SOURCE_CANDIDATES || 3)));
  const maxCandidates = Math.min(serverMaximum, Math.max(1, Number(input.maxCandidates || DEFAULT_CONFIG.maxCandidates)));

  return {
    targets: targets.length ? targets : [...DEFAULT_CONFIG.targets],
    sources: sources.length ? sources : [...DEFAULT_CONFIG.sources],
    maxCandidates
  };
}

export function encodeConfig(config) {
  return Buffer.from(JSON.stringify(normalizeConfig(config)), "utf8").toString("base64url");
}

export function decodeConfig(token) {
  if (!token) return normalizeConfig();
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig();
  }
}

export const LANGUAGE_META = Object.freeze({
  sk: { stremio: "slk", name: "slovenčiny", label: "Slovenské AI" },
  cs: { stremio: "ces", name: "češtiny", label: "České AI" },
  en: { name: "angličtiny" },
  de: { name: "nemčiny" },
  pl: { name: "poľštiny" },
  es: { name: "španielčiny" },
  fr: { name: "francúzštiny" },
  it: { name: "taliančiny" },
  pt: { name: "portugalčiny" },
  uk: { name: "ukrajinčiny" },
  ru: { name: "ruštiny" }
});
