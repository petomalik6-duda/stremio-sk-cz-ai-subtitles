# Aktualizácia na v1.0.4

Táto verzia používa nové ID addonu, aby Stremio nepoužilo starý manifest z cache.

Zmeny:
- krátke titulkové URL `/t/<job>.vtt` pre Google TV/Android TV,
- jazykové kódy `slk` a `ces`,
- jednoduchý manifest `resources: ["subtitles"]`,
- kompatibilné `/subtitles` aj `/subtitle` trasy,
- diagnostika `/debug/recent-requests`,
- nový addon ID `com.petomalik.stremio.skcz.ai.subtitles.v104`.

Po deployi odstráň starý addon, reštartuj Stremio a nainštaluj nový odkaz z `/configure`.
