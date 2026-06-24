# SK/CZ AI titulky pre Stremio 1.0.6

Samostatný Stremio addon pre online preklad titulkov do slovenčiny a češtiny. Zdrojové titulky vyhľadáva cez OpenSubtitles a prekladá cez Gemini.

## Ako funguje

1. Stremio požiada addon o titulkové stopy.
2. Addon okamžite spustí preklad najlepšej zdrojovej varianty.
3. Počas spracovania môže zobraziť informačný SRT titulok.
4. Po 20–60 sekundách znovu otvor menu titulkov a vyber rovnaký jazyk.
5. Stremio dostane novú `ready` URL a načíta hotový SRT preklad.
6. Ďalšie prehratie použije cache.

## Render

Build command:

`npm ci --no-audit --no-fund`

Start command:

`npm start`

Povinné premenné:

- `GEMINI_API_KEY`
- `OPENSUBTITLES_API_KEY`
- `OPENSUBTITLES_USERNAME`
- `OPENSUBTITLES_PASSWORD`
- `TOKEN_SECRET`
- `PUBLIC_URL`

Odporúčaný model:

`GEMINI_MODEL=gemini-2.5-flash-lite`
