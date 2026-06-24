import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.CACHE_DIR || "./data/cache");
const SOURCE_DIR = path.join(ROOT, "source");
const TRANSLATED_DIR = path.join(ROOT, "translated");

export async function ensureCacheDirs() {
  await fs.mkdir(SOURCE_DIR, { recursive: true });
  await fs.mkdir(TRANSLATED_DIR, { recursive: true });
}

export function cacheKey(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

export function sourcePath(fileId) {
  return path.join(SOURCE_DIR, `${cacheKey(fileId)}.txt`);
}

export function translatedPath(key) {
  return path.join(TRANSLATED_DIR, `${cacheKey(key)}.vtt`);
}

export async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, file);
}

export async function cleanupCache() {
  const maxAgeDays = Math.max(1, Number(process.env.CACHE_MAX_AGE_DAYS || 30));
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const dir of [SOURCE_DIR, TRANSLATED_DIR]) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    await Promise.all(entries.filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const file = path.join(dir, entry.name);
        const stat = await fs.stat(file);
        if (stat.mtimeMs < cutoff) await fs.unlink(file).catch(() => {});
      }));
  }
}
