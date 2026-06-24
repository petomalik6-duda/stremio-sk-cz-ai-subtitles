const SOURCE_CODES = Object.freeze({
  en: "EN", eng: "EN",
  de: "DE", deu: "DE", ger: "DE",
  pl: "PL", pol: "PL",
  es: "ES", spa: "ES",
  fr: "FR", fra: "FR", fre: "FR",
  it: "IT", ita: "IT",
  pt: "PT", por: "PT",
  uk: "UK", ukr: "UK",
  ru: "RU", rus: "RU",
  cs: "CS", ces: "CS", cze: "CS",
  sk: "SK", slk: "SK", slo: "SK"
});

const TARGET_CODES = Object.freeze({ sk: "SK", cs: "CS" });
const FREE_BASE_URL = "https://api-free.deepl.com";
const PRO_BASE_URL = "https://api.deepl.com";
let lastWorkingBaseUrl = null;

export function cleanDeepLApiKey(raw = process.env.DEEPL_API_KEY || "") {
  let value = String(raw || "").trim();
  value = value.replace(/^DEEPL_API_KEY\s*=\s*/i, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/[\r\n\t ]+/g, "");
}

function requiredApiKey() {
  const value = cleanDeepLApiKey();
  if (!value) throw new Error("DEEPL_API_KEY nie je nastavený");
  return value;
}

export function resolveDeepLBaseUrls(apiKey = process.env.DEEPL_API_KEY || "", plan = process.env.DEEPL_API_PLAN || "auto") {
  const override = String(process.env.DEEPL_API_URL || "").trim().replace(/\/$/, "");
  if (override) return [override];
  const normalized = String(plan || "auto").trim().toLowerCase();
  if (normalized === "free") return [FREE_BASE_URL];
  if (normalized === "pro") return [PRO_BASE_URL];
  const key = cleanDeepLApiKey(apiKey);
  const preferred = key.endsWith(":fx") ? FREE_BASE_URL : PRO_BASE_URL;
  const alternate = preferred === FREE_BASE_URL ? PRO_BASE_URL : FREE_BASE_URL;
  const bases = lastWorkingBaseUrl ? [lastWorkingBaseUrl, preferred, alternate] : [preferred, alternate];
  return [...new Set(bases)];
}

export function resolveDeepLBaseUrl(apiKey = process.env.DEEPL_API_KEY || "", plan = process.env.DEEPL_API_PLAN || "auto") {
  return resolveDeepLBaseUrls(apiKey, plan)[0];
}

export function deepLSettings() {
  const key = cleanDeepLApiKey();
  const candidates = resolveDeepLBaseUrls(key);
  const baseUrl = candidates[0];
  return {
    configured: Boolean(key),
    plan: String(process.env.DEEPL_API_PLAN || "auto").trim().toLowerCase(),
    detectedPlan: baseUrl.includes("api-free.") ? "free" : "pro",
    baseUrl,
    endpointCandidates: candidates,
    keyEndsWithFx: key.endsWith(":fx"),
    keyLength: key.length,
    translationMode: String(process.env.DEEPL_TRANSLATION_MODE || "document").trim().toLowerCase(),
    textModelType: String(process.env.DEEPL_MODEL_TYPE || "prefer_quality_optimized").trim()
  };
}

export function toDeepLSource(language) {
  const key = String(language || "").trim().toLowerCase();
  return SOURCE_CODES[key] || null;
}

export function toDeepLTarget(language) {
  const key = String(language || "").trim().toLowerCase();
  const value = TARGET_CODES[key];
  if (!value) throw new Error(`DeepL nepodporovaný cieľový jazyk: ${language}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  const base = Math.max(500, Number(process.env.DEEPL_RETRY_BASE_MS || 1500));
  const cap = Math.max(base, Number(process.env.DEEPL_RETRY_MAX_MS || 20000));
  const exponential = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(750, Math.max(100, exponential * 0.2)));
  return exponential + jitter;
}

function isRetryableStatus(status) {
  return [408, 409, 429, 500, 502, 503, 504, 529].includes(Number(status));
}

function friendlyMessage(status, detail) {
  const raw = String(detail || "").trim();
  if (status === 403) return raw || "DeepL API kľúč bol odmietnutý.";
  if (status === 456) return "DeepL mesačný limit preložených znakov bol vyčerpaný.";
  if (status === 413) return "Titulkový súbor je pre DeepL príliš veľký.";
  if (status === 429) return "DeepL dočasne obmedzilo počet požiadaviek.";
  return raw || `DeepL HTTP ${status}`;
}

async function responseError(response) {
  const raw = await response.text();
  let detail = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    detail = parsed?.message || parsed?.detail || parsed?.error || raw;
  } catch {}
  const error = new Error(friendlyMessage(response.status, detail));
  error.status = response.status;
  error.detail = raw;
  return error;
}

async function fetchWithRetry(factory, label) {
  const retries = Math.max(0, Number(process.env.DEEPL_RETRIES || 4));
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await factory();
      if (response.ok) return response;
      const error = await responseError(response);
      lastError = error;
      if (!isRetryableStatus(error.status) || attempt >= retries) throw error;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryableNetwork = !status && /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(String(error?.message || error));
      if ((!isRetryableStatus(status) && !retryableNetwork) || attempt >= retries) throw error;
    }
    const waitMs = retryDelayMs(attempt);
    console.warn(`[deepl] ${label} pokus ${attempt + 1} zlyhal; opakujem o ${waitMs} ms`);
    await sleep(waitMs);
  }
  throw lastError || new Error(`DeepL ${label} zlyhalo`);
}

async function fetchWithEndpointFallback(factory, label) {
  const candidates = resolveDeepLBaseUrls(requiredApiKey());
  const attempts = [];
  let lastError = null;
  for (const baseUrl of candidates) {
    try {
      const response = await fetchWithRetry(() => factory(baseUrl), `${label} (${baseUrl})`);
      lastWorkingBaseUrl = baseUrl;
      return { response, baseUrl, attempts };
    } catch (error) {
      lastError = error;
      attempts.push({ baseUrl, status: error?.status || null, message: error?.message || String(error) });
      const plan = String(process.env.DEEPL_API_PLAN || "auto").trim().toLowerCase();
      const canTryAlternate = plan === "auto" && [401, 403, 404].includes(Number(error?.status || 0));
      if (!canTryAlternate) break;
    }
  }
  if (attempts.length > 1 && attempts.every((entry) => [401, 403, 404].includes(Number(entry.status)))) {
    const error = new Error(
      "DeepL odmietlo kľúč na Free aj Pro API endpointoch. Skontroluj, že ide o kľúč z predplatného DeepL API (nie iba DeepL Translator/DeepL Pro), a v Renderi je vložený iba samotný kľúč bez názvu premennej a úvodzoviek."
    );
    error.status = lastError?.status || 403;
    error.endpointAttempts = attempts;
    throw error;
  }
  if (lastError) lastError.endpointAttempts = attempts;
  throw lastError || new Error(`DeepL ${label} zlyhalo`);
}

function authHeaders(extra = {}) {
  return {
    Authorization: `DeepL-Auth-Key ${requiredApiKey()}`,
    "User-Agent": process.env.DEEPL_USER_AGENT || "Stremio-SK-CZ-Subtitles/1.1.1",
    ...extra
  };
}

function formBody(documentKey) {
  return new URLSearchParams({ document_key: documentKey }).toString();
}

export async function translateSrtDocument(srt, source, target) {
  const maxBytes = Math.max(1024, Number(process.env.DEEPL_SRT_MAX_BYTES || 145000));
  const size = Buffer.byteLength(String(srt), "utf8");
  if (size > maxBytes) {
    const error = new Error(`SRT má ${size} bajtov, limit pre dokumentový režim je ${maxBytes}.`);
    error.status = 413;
    throw error;
  }

  const targetLang = toDeepLTarget(target);
  const sourceLang = toDeepLSource(source);

  const { response: uploadResponse, baseUrl } = await fetchWithEndpointFallback((candidateBaseUrl) => {
    const form = new FormData();
    form.append("file", new Blob([String(srt)], { type: "application/x-subrip" }), "subtitles.srt");
    form.append("target_lang", targetLang);
    if (sourceLang) form.append("source_lang", sourceLang);
    form.append("output_format", "srt");
    return fetch(`${candidateBaseUrl}/v2/document`, {
      method: "POST",
      headers: authHeaders(),
      body: form
    });
  }, "upload SRT");

  const upload = await uploadResponse.json();
  const documentId = upload?.document_id;
  const documentKey = upload?.document_key;
  if (!documentId || !documentKey) throw new Error("DeepL nevrátil document_id/document_key.");

  const timeoutMs = Math.max(30000, Number(process.env.DEEPL_DOCUMENT_TIMEOUT_MS || 600000));
  const deadline = Date.now() + timeoutMs;
  let status = null;
  while (Date.now() < deadline) {
    const statusResponse = await fetchWithRetry(() => fetch(`${baseUrl}/v2/document/${encodeURIComponent(documentId)}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: formBody(documentKey)
    }), "stav dokumentu");
    status = await statusResponse.json();
    if (status?.status === "done") break;
    if (status?.status === "error") throw new Error(`DeepL dokumentový preklad zlyhal: ${status.error_message || "neznáma chyba"}`);
    const suggested = Math.max(2, Math.min(10, Number(status?.seconds_remaining || 3)));
    await sleep(suggested * 1000);
  }
  if (status?.status !== "done") throw new Error("DeepL dokumentový preklad prekročil časový limit.");

  const resultResponse = await fetchWithRetry(() => fetch(`${baseUrl}/v2/document/${encodeURIComponent(documentId)}/result`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: formBody(documentKey)
  }), "stiahnutie dokumentu");
  const buffer = Buffer.from(await resultResponse.arrayBuffer());
  if (!buffer.length) throw new Error("DeepL vrátil prázdny preložený SRT súbor.");
  return buffer.toString("utf8");
}

function chunkTexts(items) {
  const maxTexts = Math.min(50, Math.max(1, Number(process.env.DEEPL_MAX_BATCH_TEXTS || 50)));
  const maxChars = Math.max(1000, Number(process.env.DEEPL_MAX_BATCH_CHARS || 24000));
  const batches = [];
  let batch = [];
  let chars = 0;
  for (const item of items) {
    const size = String(item.text || "").length;
    if (batch.length && (batch.length >= maxTexts || chars + size > maxChars)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(item);
    chars += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function translateTextBatch(entries, source, target) {
  const texts = entries.map((entry) => String(entry.text || ""));
  const body = {
    text: texts,
    target_lang: toDeepLTarget(target),
    preserve_formatting: true,
    split_sentences: "0",
    show_billed_characters: true
  };
  const sourceLang = toDeepLSource(source);
  if (sourceLang) body.source_lang = sourceLang;
  const modelType = String(process.env.DEEPL_MODEL_TYPE || "prefer_quality_optimized").trim();
  if (modelType) body.model_type = modelType;
  const contextChars = Math.max(0, Number(process.env.DEEPL_CONTEXT_CHARS || 2500));
  if (contextChars) body.context = texts.join(" ").slice(0, contextChars);

  let result;
  try {
    result = await fetchWithEndpointFallback((baseUrl) => fetch(`${baseUrl}/v2/translate`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    }), "textový preklad");
  } catch (error) {
    if (error?.status !== 400 || !body.model_type) throw error;
    delete body.model_type;
    result = await fetchWithEndpointFallback((baseUrl) => fetch(`${baseUrl}/v2/translate`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    }), "textový preklad bez model_type");
  }

  const data = await result.response.json();
  const translations = Array.isArray(data?.translations) ? data.translations : [];
  if (translations.length !== entries.length) {
    throw new Error(`DeepL vrátil ${translations.length} prekladov namiesto ${entries.length}.`);
  }
  return entries.map((entry, index) => ({ ...entry, text: String(translations[index]?.text ?? entry.text) }));
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
  if (String(source).toLowerCase() === String(target).toLowerCase()) return cues;
  const entries = cues.map((cue, index) => ({ index, text: cue.text }));
  const batches = chunkTexts(entries);
  const translatedBatches = await pool(
    batches,
    Math.max(1, Number(process.env.DEEPL_CONCURRENCY || 1)),
    (batch) => translateTextBatch(batch, source, target)
  );
  const translated = new Map(translatedBatches.flat().map((entry) => [entry.index, entry.text]));
  return cues.map((cue, index) => ({ ...cue, text: translated.get(index) ?? cue.text }));
}

export async function getDeepLUsage() {
  const { response, baseUrl, attempts } = await fetchWithEndpointFallback((candidateBaseUrl) => fetch(`${candidateBaseUrl}/v2/usage`, {
    method: "GET",
    headers: authHeaders({ Accept: "application/json" })
  }), "kontrola kvóty");
  const usage = await response.json();
  return {
    ...usage,
    endpoint: baseUrl,
    detectedPlan: baseUrl.includes("api-free.") ? "free" : "pro",
    endpointAttempts: attempts
  };
}
