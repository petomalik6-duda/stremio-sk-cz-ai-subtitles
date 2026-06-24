# Stremio SK/CZ AI Subtitles v1.0.5


Samostatný Stremio addon, ktorý vyhľadá zdrojové titulky cez OpenSubtitles a **online pri výbere** ich preloží cez Gemini do slovenčiny alebo češtiny. Preložený WebVTT súbor sa uloží do cache, takže ďalšie prehratie je okamžité.

## Ako to funguje

1. Stremio požiada addon o titulky pre IMDb film alebo epizódu.
2. Addon vyhľadá najlepšie zdrojové titulky v OpenSubtitles.
3. V ponuke titulkov sa zobrazí slovenčina/čeština.
4. Až po vybraní titulkov Stremio otvorí podpísanú URL addonu.
5. Addon stiahne originál, preloží text po dávkach cez Gemini, zachová časovanie a vráti `.vtt`.
6. Výsledok sa uloží do cache.

Nejde o preklad zvuku po jednotlivých vetách. Je to „Arvio-like“ preklad titulkov na požiadanie: pri prvom výbere sa pripraví celý súbor, potom sa používa cache.

## Potrebné kľúče

- `GEMINI_API_KEY` – z Google AI Studio.
- `OPENSUBTITLES_API_KEY` – z profilu OpenSubtitles API Consumers.
- OpenSubtitles účet je odporúčaný: `OPENSUBTITLES_USERNAME` + `OPENSUBTITLES_PASSWORD`, prípadne `OPENSUBTITLES_TOKEN`.
- `TOKEN_SECRET` – náhodný tajný reťazec aspoň 24 znakov.

OpenSubtitles obmedzuje počet stiahnutí za 24 hodín. Cache znižuje spotrebu. Pri Render free službe je disk dočasný; pre trvalú cache použi Persistent Disk a nastav napr. `CACHE_DIR=/var/data/subtitle-cache`.

## Lokálne spustenie

```bash
cp .env.example .env
# vyplň premenné a exportuj ich, alebo použi svoj env loader
npm ci --no-audit --no-fund
npm test
npm start
```

Otvor `http://localhost:7000/configure`.

## Render

1. Nahraj projekt na GitHub.
2. V Renderi vytvor Web Service z repozitára alebo použi `render.yaml`.
3. Build command: `npm ci --no-audit --no-fund`
4. Start command: `npm start`
5. Nastav environment variables podľa `.env.example`.
6. Otvor `https://tvoja-sluzba.onrender.com/configure`.
7. Vyber SK/CZ a klikni na inštalačný odkaz.

Odporúčané prostredie:

```env
GEMINI_MODEL=gemini-2.5-flash-lite
MAX_SOURCE_CANDIDATES=2
TRANSLATION_CONCURRENCY=2
CACHE_DIR=./data/cache
```

## Kontrola

- `/health` – overí, či sú kľúče nakonfigurované.
- `/manifest.json` – predvolený SK+CZ manifest.
- `/configure` – konfigurátor.

Príklad titulkového endpointu:

```text
/subtitles/movie/tt0133093.json
/subtitles/series/tt0903747:1:1.json
```

## Poznámky pre Google TV

Prvý online preklad celovečerného filmu môže trvať desiatky sekúnd podľa dĺžky titulkov a limitov Gemini. Nechaj prehrávač titulky načítať. Po úspešnom preklade je ďalšie prehratie z cache výrazne rýchlejšie.

Ak sa zobrazí iba chybový titulok, otvor Render log. Addon zámerne vracia chybu ako krátky WebVTT titulok, aby bolo vidno dôvod priamo v prehrávači.

## Bezpečnosť

- API kľúče nikdy nevkladaj do GitHubu ani do konfiguračnej URL.
- Kľúče sú iba v serverových environment variables.
- URL pre preklad sú podpísané HMAC a časovo obmedzené.
- Addon má jednoduchý hodinový rate limit pre online preklady.


## Diagnostika v1.0.5

- `/debug/recent-requests` ukáže, či Stremio volá subtitle endpoint.
- `/test.vtt` je krátky testovací WebVTT súbor.
- Subtitle URL sú krátke kvôli kompatibilite s Android TV/Google TV.


## Online preklad bez timeoutu (v1.0.5)

Pri prvom výbere titulkov server okamžite vráti informačnú stopu a preklad pokračuje na pozadí. Po 30–60 sekundách vyber tú istú titulkovú stopu znova. Po dokončení je ďalšie načítanie okamžité z cache.
