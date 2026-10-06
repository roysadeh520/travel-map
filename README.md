# מפת מטיילים

מפת עולם אינטראקטיבית למטיילים יהודים וישראלים: מדד סיכון לכל מדינה, מזג אוויר לפי תאריכים, חגים ואירועים עונתיים.

**🌍 לאפליקציה:** https://roysadeh520.github.io/travel-map/

## הרצה מקומית

```bash
python -m http.server 8765
```

ואז לפתוח http://localhost:8765

## מקורות נתונים

| שכבה | מקור | עדכון |
|---|---|---|
| מדד סיכון | 60% אזהרות מסע של המל"ל + 40% ADL Global 100 (01/2025) | המל"ל: יומי (`scripts/update-nsc.mjs`) |
| מזג אוויר | Open-Meteo: מפת חום לפי רשת נקודות על המסך, מזג אוויר בנקודה שנלחצה וערים מרכזיות בכל מדינה (תחזית 16 יום, ממוצע 3 שנים מעבר לכך) | חי |
| חגים | Nager.Date | חי |
| מפת בסיס | עד זום 7: Esri World Terrain (בלי תוויות) עם שמות מדינות וערים בעברית מ־Natural Earth; מזום 8: OpenStreetMap | – |
| מאתר יעדים | סינון לפי טמפרטורה (בירות), מדד סיכון, ויזה, אירועים וקהילה יהודית | – |
| שבת וחגים | Hebcal (זמני הדלקת נרות והבדלה לנקודה שנבחרה) | חי |
| ויזה לדרכון ישראלי | Passport Index dataset | שבועי (`scripts/update-practical.mjs`) |
| חירום, שקעים, מתח, צד נהיגה, נציגויות | Wikidata | שבועי (`scripts/update-practical.mjs`) |
| שער מטבע | ExchangeRate-API (open.er-api.com) | יומי, חי |
| שעות אור | Open-Meteo (זריחה ושקיעה) | חי |
| קהילה יהודית | OpenStreetMap: בתי כנסת, בתי חב״ד, כשר | שבועי (`scripts/update-jewish.mjs`), גיבוי חי דרך Overpass |
| חיפוש | מדינות וערים מקומיות (Natural Earth) + Photon + Nominatim | חי |
| אירועים | `data/events.json` (ידני, תאריכים משוערים) | שנתי |
| בתי כנסת / כשר | OpenStreetMap (Overpass) | חי |

## עדכון אזהרות המל"ל

```bash
node scripts/update-nsc.mjs
```

ב־GitHub ה־workflow ב־`.github/workflows/update-data.yml` מריץ את המל"ל כל יום, ואת `update-practical.mjs` ו־`update-jewish.mjs` כל יום ראשון (או ידנית מלשונית Actions).
