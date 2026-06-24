import test from "node:test";
import assert from "node:assert/strict";
import { encodeConfig, decodeConfig } from "../src/config.js";
import { parseMediaId, parseExtra } from "../src/media.js";
import { parseSubtitle, toWebVtt, chunkCues, protectFormatting, restoreFormatting } from "../src/subtitles.js";
import { signPayload, verifyPayload } from "../src/token.js";

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
