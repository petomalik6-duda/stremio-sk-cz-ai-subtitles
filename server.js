import express from "express";
import crypto from "node:crypto";
import { decodeConfig, encodeConfig, normalizeConfig } from "./src/config.js";
import { parseExtra } from "./src/media.js";
import { verifyPayload } from "./src/token.js";
import { ensureCacheDirs, cleanupCache, readJob } from "./src/cache.js";
import { listTranslationOptions, buildTranslatedSubtitle, describeLookup, startTranslationJob, getTranslationJobState, waitForTranslationJob } from "./src/service.js";

const app = express();
const PORT = Number(process.env.PORT || 7000);
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});


const recentSubtitleRequests = [];
function rememberSubtitleRequest(req, details) {
  recentSubtitleRequests.unshift({
    at: new Date().toISOString(),
    path: req.originalUrl,
    userAgent: req.get("user-agent") || "",
    ...details
  });
  recentSubtitleRequests.splice(25);
}

const rateBuckets = new Map();
function allowTranslation(req) {
  const limit = Math.max(1, Number(process.env.TRANSLATION_RATE_LIMIT_PER_HOUR || 30));
  const key = req.ip || "unknown";
  const hour = Math.floor(Date.now() / 3_600_000);
  const bucketKey = `${key}:${hour}`;
  const count = (rateBuckets.get(bucketKey) || 0) + 1;
  rateBuckets.set(bucketKey, count);
  return count <= limit;
}

function manifest(configToken) {
  const config = decodeConfig(configToken);
  const targetLabel = config.targets.map((value) => value.toUpperCase()).join("+");
  return {
    id: "com.petomalik.stremio.skcz.ai.subtitles.v105",
    version: "1.0.5",
    name: `SK/CZ AI titulky v1.0.5 (${targetLabel})`,
    description: "Online preklad titulkov do slovenčiny a češtiny cez OpenSubtitles a Gemini.",
    resources: [{ name: "subtitles", types: ["movie", "series"] }],
    types: ["movie", "series"],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

function errorVtt(message) {
  const safe = String(message || "Neznáma chyba").replace(/[\r\n]+/g, " ").slice(0, 240);
  return `WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nPreklad titulkov zlyhal: ${safe}\n`;
}

function configPage(req) {
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;
  const status = {
    Gemini: Boolean(process.env.GEMINI_API_KEY),
    OpenSubtitles: Boolean(process.env.OPENSUBTITLES_API_KEY),
    "OpenSubtitles účet": Boolean(process.env.OPENSUBTITLES_TOKEN || (process.env.OPENSUBTITLES_USERNAME && process.env.OPENSUBTITLES_PASSWORD)),
    "TOKEN_SECRET": Boolean(process.env.TOKEN_SECRET && process.env.TOKEN_SECRET.length >= 24)
  };
  return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SK/CZ AI titulky</title><style>body{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 18px;line-height:1.5}fieldset{margin:18px 0;padding:16px;border-radius:10px}button,a.button{display:inline-block;padding:12px 16px;border-radius:9px;border:0;background:#1769aa;color:white;text-decoration:none;cursor:pointer}code{background:#eee;padding:2px 5px;border-radius:4px}.ok{color:#087b35}.bad{color:#b00020}.url{word-break:break-all;padding:12px;background:#f4f4f4;border-radius:8px}</style></head><body><h1>SK/CZ AI titulky pre Stremio</h1><p>Preklad sa spustí online až po vybraní titulkov. Prvý preklad môže trvať dlhšie; ďalšie prehratie použije cache.</p><h2>Stav servera</h2><ul>${Object.entries(status).map(([k,v])=>`<li class="${v?'ok':'bad'}">${v?'✓':'✗'} ${k}</li>`).join('')}</ul><form id="form"><fieldset><legend>Cieľové jazyky</legend><label><input type="checkbox" name="target" value="sk" checked> Slovenčina</label><br><label><input type="checkbox" name="target" value="cs" checked> Čeština</label></fieldset><fieldset><legend>Zdrojové titulky</legend><label><input type="checkbox" name="source" value="en" checked> Angličtina</label><br><label><input type="checkbox" name="source" value="de"> Nemčina</label><br><label><input type="checkbox" name="source" value="pl"> Poľština</label></fieldset><fieldset><legend>Počet zdrojových variantov</legend><select name="maxCandidates"><option value="1">1 – najrýchlejšie</option><option value="2" selected>2 – odporúčané</option><option value="3">3 – viac možností</option></select></fieldset><button type="submit" id="createLink">Vytvoriť inštalačný odkaz</button></form><div id="result" hidden><h2>Inštalácia</h2><p class="url" id="manifest"></p><p><a class="button" id="install">Otvoriť v Stremio</a></p></div><p id="formError" class="bad" hidden></p><script>const origin=${JSON.stringify(origin)};const form=document.getElementById('form');const button=document.getElementById('createLink');const errorBox=document.getElementById('formError');form.addEventListener('submit',async e=>{e.preventDefault();errorBox.hidden=true;button.disabled=true;button.textContent='Vytváram odkaz…';try{const f=new FormData(form);const cfg={targets:f.getAll('target'),sources:f.getAll('source'),maxCandidates:Number(f.get('maxCandidates'))};const r=await fetch(origin+'/api/config-token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(cfg)});if(!r.ok)throw new Error('Server vrátil HTTP '+r.status);const j=await r.json();if(!j.token)throw new Error('Server nevrátil konfiguračný token');const url=origin+'/'+j.token+'/manifest.json';const installUrl=url.startsWith('https://')?'stremio://'+url.slice(8):url.startsWith('http://')?'stremio://'+url.slice(7):url;document.getElementById('manifest').textContent=url;const install=document.getElementById('install');install.href=installUrl;document.getElementById('result').hidden=false;}catch(error){errorBox.textContent='Odkaz sa nepodarilo vytvoriť: '+error.message;errorBox.hidden=false;}finally{button.disabled=false;button.textContent='Vytvoriť inštalačný odkaz';}});</script></body></html>`;
}

app.get(["/", "/configure"], (req, res) => res.type("html").send(configPage(req)));
app.post("/api/config-token", (req, res) => res.json({ token: encodeConfig(normalizeConfig(req.body)) }));
app.get("/manifest.json", (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(manifest(null)); });
app.get("/:config/manifest.json", (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(manifest(req.params.config)); });
app.get("/health", (req, res) => res.json({
  ok: true,
  version: "1.0.5",
  geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
  openSubtitlesConfigured: Boolean(process.env.OPENSUBTITLES_API_KEY),
  openSubtitlesAuthenticated: Boolean(process.env.OPENSUBTITLES_TOKEN || (process.env.OPENSUBTITLES_USERNAME && process.env.OPENSUBTITLES_PASSWORD)),
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  requestId: crypto.randomUUID()
}));

app.get(["/debug/subtitles/:type/:id.json", "/:config/debug/subtitles/:type/:id.json"], async (req, res) => {
  try {
    const config = decodeConfig(req.params.config);
    const extra = parseExtra("", req.query);
    const lookup = describeLookup({ type: req.params.type, id: req.params.id, extra, config });
    return res.json({ ok: true, lookup, exampleRequest: req.originalUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/debug/recent-requests", (req, res) => res.json({ ok: true, version: "1.0.5", requests: recentSubtitleRequests }));

app.get("/test.vtt", (req, res) => {
  res.type("text/vtt; charset=utf-8").send("WEBVTT\n\n00:00:00.000 --> 00:00:08.000\nSK/CZ AI subtitle addon je pripojený.\n");
});

async function subtitleHandler(req, res) {
  try {
    const config = decodeConfig(req.params.config);
    const extra = parseExtra(req.params.extra, req.query);
    const subtitles = await listTranslationOptions({ req, config, type: req.params.type, id: req.params.id, extra });
    const details = { type: req.params.type, id: req.params.id, extra, count: subtitles.length };
    rememberSubtitleRequest(req, details);
    console.log("[subtitles]", details);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ subtitles });
  } catch (error) {
    rememberSubtitleRequest(req, { type: req.params.type, id: req.params.id, error: error.message, count: 0 });
    console.error("[subtitles]", error);
    return res.json({ subtitles: [] });
  }
}
app.get("/subtitles/:type/:id.json", subtitleHandler);
app.get("/subtitles/:type/:id/:extra.json", subtitleHandler);
app.get("/:config/subtitles/:type/:id.json", subtitleHandler);
app.get("/:config/subtitles/:type/:id/:extra.json", subtitleHandler);
// Compatibility aliases for clients or integrations using the old singular path.
app.get("/subtitle/:type/:id.json", subtitleHandler);
app.get("/subtitle/:type/:id/:extra.json", subtitleHandler);
app.get("/:config/subtitle/:type/:id.json", subtitleHandler);
app.get("/:config/subtitle/:type/:id/:extra.json", subtitleHandler);

function loadingVtt(target, status = "pending") {
  const language = target === "cs" ? "českých" : "slovenských";
  const detail = status === "pending"
    ? `Online preklad ${language} titulkov prebieha. O 30–60 sekúnd znova vyber rovnaké titulky.`
    : `Online preklad ${language} titulkov sa pripravuje. Znova vyber rovnaké titulky.`;
  return `WEBVTT\n\n00:00:00.000 --> 04:00:00.000\n${detail}\n`;
}

app.get("/debug/job/:jobId", (req, res) => {
  const state = getTranslationJobState(req.params.jobId);
  return res.json({ ok: true, version: "1.0.5", state });
});

app.get("/t/:jobId.vtt", async (req, res) => {
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  if (!allowTranslation(req)) return res.status(429).send(errorVtt("Bol prekročený hodinový limit prekladov."));
  try {
    const payload = await readJob(req.params.jobId);
    if (!payload) throw new Error("Prekladová úloha už nie je dostupná. Znovu otvor titulky v prehrávači.");
    if (!payload.exp || Date.now() > Number(payload.exp)) throw new Error("Prekladová úloha vypršala. Znovu otvor titulky v prehrávači.");

    const state = startTranslationJob(req.params.jobId, payload);
    const ready = await waitForTranslationJob(state, Number(process.env.FIRST_RESPONSE_WAIT_MS || 2500));
    if (ready?.vtt) {
      res.setHeader("X-Translation-State", "ready");
      res.setHeader("X-Translation-Cache", ready.cached ? "HIT" : "MISS");
      return res.send(ready.vtt);
    }

    const current = getTranslationJobState(req.params.jobId);
    if (current?.status === "error") throw new Error(current.error || "Preklad zlyhal");
    res.setHeader("X-Translation-State", "pending");
    return res.send(loadingVtt(payload.target, current?.status || "pending"));
  } catch (error) {
    console.error("[translate-job]", error);
    res.setHeader("X-Translation-State", "error");
    return res.status(200).send(errorVtt(error.message));
  }
});

app.get("/translated/:token.vtt", async (req, res) => {
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-if-error=604800");
  if (!allowTranslation(req)) return res.status(429).send(errorVtt("Bol prekročený hodinový limit prekladov."));
  try {
    const payload = verifyPayload(req.params.token);
    const { vtt, cached } = await buildTranslatedSubtitle(payload);
    res.setHeader("X-Translation-Cache", cached ? "HIT" : "MISS");
    return res.send(vtt);
  } catch (error) {
    console.error("[translate]", error);
    return res.status(500).send(errorVtt(error.message));
  }
});

await ensureCacheDirs();
await cleanupCache().catch((error) => console.warn("Cache cleanup failed:", error.message));
setInterval(() => cleanupCache().catch(() => {}), 24 * 60 * 60 * 1000).unref();
app.listen(PORT, () => console.log(`SK/CZ AI subtitle addon listening on port ${PORT}`));
