# מפת מטיילים

מפת עולם אינטראקטיבית למטיילים יהודים וישראלים: מדד סיכון לכל מדינה, מזג אוויר לפי תאריכים, חגים ואירועים עונתיים.

## הרצה מקומית

```bash
python -m http.server 8765
```

ואז לפתוח http://localhost:8765

## מקורות נתונים

| שכבה | מקור | עדכון |
|---|---|---|
| מדד סיכון | 60% אזהרות מסע של המל"ל + 40% ADL Global 100 (01/2025) | המל"ל: יומי (`scripts/update-nsc.mjs`) |
| מזג אוויר | Open-Meteo (תחזית 16 יום, ממוצע 3 שנים מעבר לכך) | חי |
| חגים | Nager.Date | חי |
| חיפוש | מדינות וערים מקומיות (Natural Earth) + Photon + Nominatim | חי |
| אירועים | `data/events.json` (ידני, תאריכים משוערים) | שנתי |
| בתי כנסת / כשר | OpenStreetMap (Overpass) | חי |

## עדכון אזהרות המל"ל

```bash
node scripts/update-nsc.mjs
```

ב־GitHub ה־workflow ב־`.github/workflows/update-data.yml` מריץ את זה כל יום.
