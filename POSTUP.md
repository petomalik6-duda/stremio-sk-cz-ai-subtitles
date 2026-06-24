# Presný postup nasadenia

## 1. OpenSubtitles

1. Vytvor si účet na OpenSubtitles.com.
2. V profile otvor **API Consumers** a vytvor API consumer.
3. Skopíruj API key.
4. Priprav si používateľské meno a heslo OpenSubtitles. Prihlásený účet má vyšší limit sťahovania než anonymný prístup.

## 2. Gemini

1. V Google AI Studio vytvor Gemini API key.
2. Kľúč nikam nevkladaj do GitHub súborov.

## 3. GitHub

1. Vytvor nový prázdny repozitár.
2. Nahraj doň celý obsah ZIP balíka.
3. Priečinok `node_modules` nenahrávaj.

## 4. Render

1. **New → Web Service** a vyber GitHub repozitár.
2. Runtime: Node.
3. Build command:
   ```text
   npm ci --no-audit --no-fund
   ```
4. Start command:
   ```text
   npm start
   ```
5. V Environment pridaj:

   ```text
   GEMINI_API_KEY=...
   OPENSUBTITLES_API_KEY=...
   OPENSUBTITLES_USERNAME=...
   OPENSUBTITLES_PASSWORD=...
   TOKEN_SECRET=dlhy-nahodny-retazec-aspon-24-znakov
   GEMINI_MODEL=gemini-2.5-flash-lite
   CACHE_DIR=./data/cache
   ```

6. Deployni službu.

## 5. Inštalácia do Stremia

1. Otvor:
   ```text
   https://NAZOV-SLUZBY.onrender.com/configure
   ```
2. Vyber slovenčinu, češtinu alebo oba jazyky.
3. Klikni **Vytvoriť inštalačný odkaz**.
4. Klikni **Otvoriť v Stremio**.

## 6. Použitie

Pri filme alebo epizóde otvor ponuku titulkov. Mali by sa ukázať slovenské a/alebo české AI titulky. Po prvom výbere addon online stiahne zdrojové titulky a preloží ich. Prvé načítanie môže trvať dlhšie. Druhé použitie toho istého prekladu pôjde z cache.

## 7. Overenie

Otvor:

```text
https://NAZOV-SLUZBY.onrender.com/health
```

Všetky potrebné hodnoty by mali byť `true`, okrem autentifikácie OpenSubtitles, ak zámerne používaš anonymný limit.

## 8. Trvalá cache

Na bezplatnom Render pláne môže cache po redeployi zmiznúť. S Persistent Disk nastav:

```text
CACHE_DIR=/var/data/subtitle-cache
```

Bez persistentného disku addon stále funguje, ale po deployi môže rovnaké titulky znovu stiahnuť a preložiť.


## Použitie verzie 1.0.5

1. Spusť film alebo epizódu.
2. Vyber Slovak/Czech AI titulky.
3. Zobrazí sa informácia, že online preklad prebieha.
4. Po 30–60 sekundách otvor menu titulkov a vyber rovnakú stopu znova.
5. Hotový preklad sa načíta a uloží do cache.
