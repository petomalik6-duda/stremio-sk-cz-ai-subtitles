# Aktualizácia 1.0.6 – viditeľný preklad v Stremiu

Táto verzia opravuje stav, keď Stremio zobrazilo slovenskú/českú stopu, ale hotový preklad sa neobjavil.

## Hlavné zmeny

- výstup je SRT namiesto WebVTT,
- preklad preferovanej varianty sa spustí už pri načítaní zoznamu titulkov,
- URL sa počas spracovania mení každých 15 sekúnd a po dokončení dostane `ready` revíziu,
- Stremio preto nepoužije starú informačnú odpoveď z cache,
- Gemini používa stabilné `models.generateContent` API,
- chybová aj informačná stopa zostáva viditeľná počas celého filmu,
- nový manifest ID zabráni použitiu starej cache addonu.

## Nasadenie

1. Prepíš obsah repozitára súbormi z tohto balíka.
2. Render: **Manual Deploy → Clear build cache & deploy**.
3. Over `/health`; verzia musí byť `1.0.6`.
4. Odinštaluj starý addon zo Stremia.
5. Reštartuj Stremio.
6. Vytvor nový odkaz cez `/configure` a nainštaluj verziu 1.0.6.

## Použitie

Po spustení filmu počkaj približne 20–60 sekúnd. Potom znovu otvor menu titulkov a vyber slovenskú alebo českú AI stopu. Znovuotvorenie menu je dôležité, pretože Stremio musí dostať novú `ready` URL.

## Diagnostika

Z URL titulkov skopíruj 32-znakové ID a otvor:

`/debug/job/ID`

- `status: pending` – preklad ešte beží,
- `status: done`, `ready: true` – hotový SRT je pripravený,
- `status: error` – pole `error` ukáže presnú chybu.
