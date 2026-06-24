import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.CACHE_DIR || "./data/cache");
const SOURCE_DIR = path.join(ROOT, "source");
const TRANSLATED_DIR = path.join(ROOT, "translated");
const JOB_DIR = path.join(ROOT, "jobs");
const JOB_OUTPUT_DIR = path.join(ROOT, "job-output");

export async function ensureCacheDirs() {
  await Promise.all([
    fs.mkdir(SOURCE_DIR, { recursive: true }),
    fs.mkdir(TRANSLATED_DIR, { recursive: true }),
    fs.mkdir(JOB_DIR, { recursive: true }),
    fs.mkdir(JOB_OUTPUT_DIR, { recursive: true })
  ]);
}

export function cacheKey(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

export function sourcePath(fileId) {
  return path.join(SOURCE_DIR, `${cacheKey(fileId)}.txt`);
}

export function translatedPath(key) {
  return path.join(TRANSLATED_DIR, `${cacheKey(key)}.srt`);
}

export function jobPath(jobId) {
  return path.join(JOB_DIR, `${String(jobId).replace(/[^a-f0-9]/gi, "")}.json`);
}

export function jobOutputPath(jobId) {
  return path.join(JOB_OUTPUT_DIR, `${String(jobId).replace(/[^a-f0-9]/gi, "")}.srt`);
}

export async function writeJob(jobId, payload) {
  await writeAtomic(jobPath(jobId), JSON.stringify(payload));
}

export async function readJob(jobId) {
  const raw = await readIfExists(jobPath(jobId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
  for (const dir of [SOURCE_DIR, TRANSLATED_DIR, JOB_DIR, JOB_OUTPUT_DIR]) {
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
