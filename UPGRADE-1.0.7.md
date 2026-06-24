# Upgrade na 1.0.7 – oprava štartu na Renderi

Táto verzia odstraňuje povinný named import `getReadyJobOutput`. Server používa namespace import a kompatibilný fallback, takže naštartuje aj v prípade, že Render/GitHub ponechal starší `src/service.js`.

## Dôležité
Nahraj celý obsah ZIPu vrátane priečinka `src`. Nestačí prepísať iba `server.js`.

Po deployi musí `/health` ukazovať verziu `1.0.7`.
