# v1.0.3 – Stremio subtitle visibility fix

- Removes restrictive `idPrefixes` from the subtitle resource so Stremio can request subtitles by video hash as well as IMDb video ID.
- Supports `videoId` supplied in subtitle request extras.
- Returns lazy SK/CZ translation tracks immediately; OpenSubtitles search and Gemini translation start only after selecting a track.
- Adds filename/movie-hash fallback lookup.
- Uses the widely compatible Stremio language codes `slo` and `cze`.
- Adds `/debug/subtitles/:type/:id.json` diagnostics.
