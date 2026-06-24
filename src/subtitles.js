import iconv from "iconv-lite";
import chardet from "chardet";

function normalizeTimestamp(value) {
  let timestamp = value.trim().replace(",", ".");
  if (/^\d:\d{2}:\d{2}\.\d{2}$/.test(timestamp)) {
    const [h, m, rest] = timestamp.split(":");
    const [s, cs] = rest.split(".");
    timestamp = `${String(h).padStart(2, "0")}:${m}:${s}.${cs}0`;
  }
  if (/^\d{2}:\d{2}:\d{2}\.\d{2}$/.test(timestamp)) timestamp += "0";
  return timestamp;
}

function parseBlocks(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const withoutHeader = normalized.startsWith("WEBVTT")
    ? normalized.replace(/^WEBVTT[^\n]*\n+/, "")
    : normalized;
  const blocks = withoutHeader.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/([^\s]+)\s*-->\s*([^\s]+)(.*)$/);
    if (!timing) continue;
    const body = lines.slice(timingIndex + 1).join("\n").trim();
    if (!body) continue;
    cues.push({
      start: normalizeTimestamp(timing[1]),
      end: normalizeTimestamp(timing[2]),
      settings: timing[3]?.trim() || "",
      text: body
    });
  }
  return cues;
}

function assToCues(text) {
  const cues = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.startsWith("Dialogue:")) continue;
    const data = line.slice("Dialogue:".length).trim().split(",");
    if (data.length < 10) continue;
    const start = normalizeTimestamp(data[1]);
    const end = normalizeTimestamp(data[2]);
    const body = data.slice(9).join(",").replace(/\\N/g, "\n").replace(/\{\\[^}]+\}/g, "").trim();
    if (body) cues.push({ start, end, settings: "", text: body });
  }
  return cues;
}

export function decodeSubtitleBuffer(buffer) {
  const encoding = chardet.detect(buffer) || "UTF-8";
  return iconv.decode(buffer, encoding);
}

export function parseSubtitle(text) {
  const trimmed = String(text || "").trim();
  const cues = /^\[Script Info\]/im.test(trimmed) ? assToCues(trimmed) : parseBlocks(trimmed);
  if (!cues.length) throw new Error("The subtitle file contains no readable SRT/VTT cues");
  return cues;
}

export function toWebVtt(cues) {
  const blocks = cues.map((cue, index) => {
    const settings = cue.settings ? ` ${cue.settings}` : "";
    return `${index + 1}\n${cue.start} --> ${cue.end}${settings}\n${cue.text}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function protectFormatting(text) {
  const tokens = [];
  const protectedText = String(text).replace(/<[^>]+>|\{\\[^}]+\}/g, (match) => {
    const token = `[[[FMT_${tokens.length}]]]`;
    tokens.push(match);
    return token;
  });
  return { protectedText, tokens };
}

export function restoreFormatting(text, tokens) {
  let result = String(text || "");
  tokens.forEach((tokenValue, index) => {
    result = result.replaceAll(`[[[FMT_${index}]]]`, tokenValue);
  });
  return result;
}

export function chunkCues(cues, maxCues, maxChars) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (let i = 0; i < cues.length; i += 1) {
    const size = cues[i].text.length;
    if (current.length && (current.length >= maxCues || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push({ cue: cues[i], index: i });
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
