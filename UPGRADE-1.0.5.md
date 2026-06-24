# Verzia 1.0.5 – okamžité zobrazenie a neblokujúci preklad

Táto verzia opravuje problém, keď endpoint titulkov vracal správny JSON, ale Stremio titulky nezobrazilo alebo ich zahodilo pre timeout pri načítavaní `.vtt`.

## Zmeny

- Preklad sa spustí na pozadí pri prvom výbere titulkov.
- `.vtt` odpovie najneskôr približne do 2,5 sekundy informačnými titulkami.
- Po 30–60 sekundách znova vyber rovnakú titulkovú stopu; hotový preklad sa načíta z cache.
- Pre `.vtt` je nastavené `Cache-Control: no-store`, aby Stremio nezachovalo starú informačnú odpoveď.
- Jazykové kódy sú `slo` a `cze`, ktoré sú kompatibilné so Stremio výberom jazyka.
- Manifest používa explicitný subtitles resource a nové addon ID `...v105`, aby sa nepoužila stará cache manifestu.
- Diagnostika prekladu: `/debug/job/JOB_ID`.

## Po aktualizácii

1. Clear build cache & deploy na Renderi.
2. Odinštalovať starú verziu addonu zo Stremia.
3. Reštartovať Stremio a nainštalovať novú verziu cez `/configure`.
4. V Stremio nastavení vypnúť „Show only preferred language“ alebo nastaviť preferovaný jazyk na slovenčinu/češtinu.
