import { GoogleGenAI } from "@google/genai";
import { chunkCues, protectFormatting, restoreFormatting } from "./subtitles.js";
import { LANGUAGE_META } from "./config.js";

let client = null;
function aiClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const schema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "integer" },
      text: { type: "string" }
    },
    required: ["id", "text"],
    additionalProperties: false
  }
};

function promptFor(entries, source, target) {
  const sourceName = LANGUAGE_META[source]?.name || source;
  const targetName = LANGUAGE_META[target]?.name || target;
  return [
    `Prelož nasledujúce filmové alebo seriálové titulky z ${sourceName} do ${targetName}.`,
    "Pravidlá:",
    "- Vráť presne jeden objekt pre každý vstupný objekt a zachovaj jeho id.",
    "- Prekladaj iba text, nie id.",
    "- Zachovaj význam, tón, vulgarizmy, mená, čísla a prirodzený hovorový štýl.",
    "- Zachovaj zalomenia riadkov a všetky značky [[[FMT_n]]] presne bez zmeny.",
    "- Nepridávaj vysvetlenia, poznámky ani cenzúru.",
    JSON.stringify(entries)
  ].join("\n");
}

async function translateChunk(chunk, source, target) {
  const protectedEntries = chunk.map(({ cue, index }) => {
    const { protectedText, tokens } = protectFormatting(cue.text);
    return { id: index, text: protectedText, tokens };
  });
  const retries = Math.max(0, Number(process.env.TRANSLATION_RETRIES || 2));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const interaction = await aiClient().interactions.create({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
        input: promptFor(protectedEntries.map(({ id, text }) => ({ id, text })), source, target),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema
        }
      });
      const parsed = JSON.parse(interaction.output_text);
      const resultMap = new Map(parsed.map((entry) => [Number(entry.id), String(entry.text ?? "")]));
      return protectedEntries.map((entry) => ({
        id: entry.id,
        text: restoreFormatting(resultMap.get(entry.id) || chunk.find((item) => item.index === entry.id).cue.text, entry.tokens)
      }));
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export async function translateCues(cues, source, target) {
  if (source === target) return cues;
  const chunks = chunkCues(
    cues,
    Math.max(10, Number(process.env.MAX_CHUNK_CUES || 70)),
    Math.max(1000, Number(process.env.MAX_CHUNK_CHARS || 5500))
  );
  const translatedChunks = await pool(
    chunks,
    Math.max(1, Number(process.env.TRANSLATION_CONCURRENCY || 2)),
    (chunk) => translateChunk(chunk, source, target)
  );
  const texts = new Map(translatedChunks.flat().map((entry) => [entry.id, entry.text]));
  return cues.map((cue, index) => ({ ...cue, text: texts.get(index) || cue.text }));
}
