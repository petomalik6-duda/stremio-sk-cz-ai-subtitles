# Upgrade na 1.1.1 – automatická detekcia DeepL endpointu

- Pri `DEEPL_API_PLAN=auto` addon otestuje Free aj Pro endpoint.
- Hodnota `DEEPL_API_KEY` sa očistí od úvodzoviek a omylom vloženého prefixu `DEEPL_API_KEY=`.
- `/debug/deepl` ukazuje použitý endpoint a bezpečnú diagnostiku bez zobrazenia kľúča.
- Ak oba endpointy odmietnu kľúč, hlásenie upozorní, že musí ísť o predplatné DeepL API, nie iba DeepL Translator/DeepL Pro.

Odporúčané nastavenie:

```env
DEEPL_API_PLAN=auto
```
