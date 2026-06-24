# Upgrade na 1.1.0 – DeepL

- Gemini bol úplne odstránený z prekladovej vrstvy.
- Hlavný režim prekladá celý SRT dokument cez DeepL Document API.
- Pri veľkom alebo nekompatibilnom súbore sa automaticky použije DeepL Text API.
- Pridané retry s exponenciálnym odstupom pre 429/5xx/529.
- Pridaný `/debug/deepl` na overenie kľúča a kvóty.
- Zmenené ID addonu, aby Stremio nepoužilo starý manifest/cache.

Po nasadení odstráň `GEMINI_API_KEY` a nastav `DEEPL_API_KEY`.
