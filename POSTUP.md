# Nasadenie SK/CZ DeepL titulkov 1.1.0

## 1. DeepL API kľúč

V účte DeepL otvor sekciu API Keys a vytvor kľúč pre DeepL API Free alebo Pro. Free kľúč má zvyčajne koncovku `:fx`.

## 2. OpenSubtitles

V OpenSubtitles.com vytvor API Consumer a skopíruj API Key. Prihlasovacie meno a heslo pridaj kvôli vyššej kvóte sťahovania titulkov.

## 3. GitHub

Rozbaľ ZIP a nahraj celý obsah do repozitára. Dôležité je prepísať aj celý priečinok `src` a súbory `package.json` a `package-lock.json`.

## 4. Render

Použi:

```text
Build Command: npm ci --no-audit --no-fund
Start Command: npm start
```

Nastav:

```env
DEEPL_API_KEY=...
DEEPL_API_PLAN=auto
DEEPL_TRANSLATION_MODE=document
DEEPL_TEXT_FALLBACK=true
DEEPL_MODEL_TYPE=prefer_quality_optimized
DEEPL_RETRIES=4
DEEPL_CONCURRENCY=1

OPENSUBTITLES_API_KEY=...
OPENSUBTITLES_USERNAME=...
OPENSUBTITLES_PASSWORD=...
TOKEN_SECRET=dlhy_nahodny_retazec
PUBLIC_URL=https://tvoj-addon.onrender.com
```

Premennú `GEMINI_API_KEY` môžeš odstrániť; verzia 1.1.0 ju nepoužíva.

Spusti `Manual Deploy → Clear build cache & deploy`.

## 5. Overenie

Otvor:

```text
https://tvoj-addon.onrender.com/health
```

Musí obsahovať:

```json
{
  "version": "1.1.0",
  "provider": "deepl",
  "deeplConfigured": true
}
```

Potom otvor:

```text
https://tvoj-addon.onrender.com/debug/deepl
```

Pri správnom kľúči bude `ok: true` a zobrazí sa spotreba/limit znakov. API kľúč sa vo výstupe nezobrazuje.

## 6. Stremio

1. Odinštaluj všetky staré Gemini verzie SK/CZ addonu.
2. Úplne reštartuj Stremio.
3. Otvor `https://tvoj-addon.onrender.com/configure`.
4. Vyber jazyky a vytvor nový inštalačný odkaz.
5. Nainštaluj addon `SK/CZ DeepL titulky v1.1.0`.

Pri prvom filme počkaj na dokončenie prekladu a potom znovu otvor menu titulkov.
