import test from "node:test";
import assert from "node:assert/strict";
import { encodeConfig, decodeConfig, LANGUAGE_META } from "../src/config.js";
import { parseMediaId, parseExtra } from "../src/media.js";
import { parseSubtitle, toWebVtt, toSrt, chunkCues, protectFormatting, restoreFormatting } from "../src/subtitles.js";
import { signPayload, verifyPayload } from "../src/token.js";
import { cleanDeepLApiKey, resolveDeepLBaseUrl, resolveDeepLBaseUrls, toDeepLSource, toDeepLTarget, translateCues, translateSrtDocument } from "../src/deepl.js";

process.env.TOKEN_SECRET = "this-is-a-long-test-secret-1234567890";

test("config round-trip", () => {
  const token = encodeConfig({ targets: ["sk"], sources: ["en", "pl"], maxCandidates: 3 });
  assert.deepEqual(decodeConfig(token), { targets: ["sk"], sources: ["en", "pl"], maxCandidates: 3 });
});

test("series id parser", () => {
  const parsed = parseMediaId("series", "tt1234567:2:5");
  assert.equal(parsed.imdbId, "1234567");
  assert.equal(parsed.season, 2);
  assert.equal(parsed.episode, 5);
  assert.equal(parsed.stremioVideoId, "tt1234567:2:5");
});

test("extra parser", () => {
  assert.deepEqual(parseExtra("videoHash=abc&videoSize=123.json"), { videoHash: "abc", videoSize: "123" });
});

test("SRT parse and VTT output", () => {
  const cues = parseSubtitle("1\n00:00:01,000 --> 00:00:03,000\nHello!\n\n2\n00:00:04,500 --> 00:00:06,000\nWorld");
  assert.equal(cues.length, 2);
  const vtt = toWebVtt(cues);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.000/);
});

test("format protection", () => {
  const p = protectFormatting("<i>Hello</i> {\\an8}");
  assert.equal(restoreFormatting(p.protectedText, p.tokens), "<i>Hello</i> {\\an8}");
});

test("chunking", () => {
  const cues = Array.from({ length: 5 }, (_, i) => ({ text: `line-${i}` }));
  assert.equal(chunkCues(cues, 2, 100).length, 3);
});

test("signed payload", () => {
  const token = signPayload({ fileId: 1, target: "sk" }, 1);
  const decoded = verifyPayload(token);
  assert.equal(decoded.fileId, 1);
});

test("subtitle protocol hash with videoId extra", () => {
  assert.deepEqual(parseMediaId("movie", "0123456789abcdef", { videoId: "tt0133093", videoHash: "0123456789abcdef" }), {
    imdbId: "0133093",
    stremioVideoId: "tt0133093",
    season: null,
    episode: null,
    videoHash: "0123456789abcdef",
    videoSize: null,
    filename: null,
    query: null
  });
});

test("filename fallback query", () => {
  const parsed = parseMediaId("series", "unknown", { filename: "Example.Show.S02E03.1080p.WEB-DL.mkv" });
  assert.equal(parsed.season, 2);
  assert.equal(parsed.episode, 3);
  assert.match(parsed.query, /Example Show S02E03/i);
});


test("Stremio legacy ISO 639-2 language codes", () => {
  assert.equal(LANGUAGE_META.sk.stremio, "slo");
  assert.equal(LANGUAGE_META.cs.stremio, "cze");
});


test("SRT output uses comma timestamps and UTF-8 BOM", () => {
  const cues = parseSubtitle("1\n00:00:01,000 --> 00:00:03,000\nAhoj");
  const srt = toSrt(cues);
  assert.equal(srt.charCodeAt(0), 0xFEFF);
  assert.match(srt, /00:00:01,000 --> 00:00:03,000/);
  assert.match(srt, /Ahoj/);
});


test("DeepL key cleanup and endpoint candidates", () => {
  assert.equal(cleanDeepLApiKey(" DEEPL_API_KEY=\"abc:fx\" "), "abc:fx");
  assert.deepEqual(resolveDeepLBaseUrls("abc:fx", "auto").slice(0, 2), ["https://api-free.deepl.com", "https://api.deepl.com"]);
});

test("DeepL endpoint auto-detection and language mapping", () => {
  assert.equal(resolveDeepLBaseUrl("abc:fx", "auto"), "https://api-free.deepl.com");
  assert.equal(resolveDeepLBaseUrl("abc", "auto"), "https://api.deepl.com");
  assert.equal(resolveDeepLBaseUrl("abc", "free"), "https://api-free.deepl.com");
  assert.equal(toDeepLSource("eng"), "EN");
  assert.equal(toDeepLSource("de"), "DE");
  assert.equal(toDeepLTarget("sk"), "SK");
  assert.equal(toDeepLTarget("cs"), "CS");
});

test("DeepL text fallback preserves cue order", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.DEEPL_API_KEY;
  const previousPlan = process.env.DEEPL_API_PLAN;
  process.env.DEEPL_API_KEY = "test-key:fx";
  process.env.DEEPL_API_PLAN = "free";
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      translations: body.text.map((text) => ({ text: `SK:${text}` }))
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await translateCues([
      { start: "00:00:01.000", end: "00:00:02.000", text: "Hello" },
      { start: "00:00:03.000", end: "00:00:04.000", text: "World" }
    ], "en", "sk");
    assert.deepEqual(result.map((cue) => cue.text), ["SK:Hello", "SK:World"]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPL_API_KEY; else process.env.DEEPL_API_KEY = previousKey;
    if (previousPlan === undefined) delete process.env.DEEPL_API_PLAN; else process.env.DEEPL_API_PLAN = previousPlan;
  }
});

test("DeepL SRT document workflow uploads, polls, and downloads", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.DEEPL_API_KEY;
  const previousPlan = process.env.DEEPL_API_PLAN;
  process.env.DEEPL_API_KEY = "test-key:fx";
  process.env.DEEPL_API_PLAN = "free";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith("/v2/document")) {
      assert.equal(options.method, "POST");
      assert.ok(options.body instanceof FormData);
      return new Response(JSON.stringify({ document_id: "doc-1", document_key: "key-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).endsWith("/v2/document/doc-1")) {
      return new Response(JSON.stringify({ document_id: "doc-1", status: "done", billed_characters: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).endsWith("/v2/document/doc-1/result")) {
      return new Response("1\r\n00:00:01,000 --> 00:00:02,000\r\nAhoj\r\n", {
        status: 200,
        headers: { "content-type": "application/x-subrip" }
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const result = await translateSrtDocument("1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n", "en", "sk");
    assert.match(result, /Ahoj/);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPL_API_KEY; else process.env.DEEPL_API_KEY = previousKey;
    if (previousPlan === undefined) delete process.env.DEEPL_API_PLAN; else process.env.DEEPL_API_PLAN = previousPlan;
  }
});
