# SK/CZ DeepL titulky pre Stremio 1.1.0

Samostatný Stremio addon, ktorý nájde zdrojové titulky cez OpenSubtitles a online ich preloží do slovenčiny alebo češtiny cez DeepL API.

## Ako preklad funguje

1. Stremio požiada addon o titulky pre film alebo epizódu.
2. Addon nájde anglický, nemecký alebo iný zvolený zdroj na OpenSubtitles.
3. DeepL ako prvú voľbu preloží priamo celý SRT dokument a zachová časovanie.
4. Pri príliš veľkom alebo nekompatibilnom SRT sa použije textový dávkový fallback.
5. Hotový SRT sa uloží do cache.

Pri prvom otvorení sa môže zobraziť informačná stopa. Po dokončení znovu otvor menu titulkov a vyber rovnaký jazyk.

## Povinné Render premenné

```env
DEEPL_API_KEY=tvoj_deepl_api_kluc
OPENSUBTITLES_API_KEY=tvoj_opensubtitles_api_kluc
OPENSUBTITLES_USERNAME=tvoje_meno
OPENSUBTITLES_PASSWORD=tvoje_heslo
TOKEN_SECRET=nahodny_retazec_aspon_24_znakov
PUBLIC_URL=https://tvoj-addon.onrender.com
```

Odporúčané:

```env
DEEPL_API_PLAN=auto
DEEPL_TRANSLATION_MODE=document
DEEPL_TEXT_FALLBACK=true
DEEPL_MODEL_TYPE=prefer_quality_optimized
DEEPL_RETRIES=4
DEEPL_CONCURRENCY=1
```

`DEEPL_API_PLAN=auto` rozpozná Free kľúč podľa koncovky `:fx`. Pri Pro kľúči použije Pro endpoint.

## Diagnostika

- `/health` – konfigurácia addonu
- `/debug/deepl` – overenie DeepL kľúča a aktuálnej kvóty
- `/debug/recent-requests` – posledné subtitle požiadavky zo Stremia
- `/debug/job/JOB_ID` – stav konkrétneho prekladu
- `/test.srt` – test zobrazenia SRT

## Limity

DeepL API Free obsahuje mesačný limit znakov. Preklad celého filmu môže spotrebovať desiatky tisíc znakov. Addon preto hotové preklady cacheuje.
