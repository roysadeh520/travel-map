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
| חיפוש | מדינות וערים מקומיות (Natural Earth) + Photon + Nominatim | חי |
| אירועים | `data/events.json` (ידני, תאריכים משוערים) | שנתי |
| בתי כנסת / כשר | OpenStreetMap (Overpass) | חי |

## עדכון אזהרות המל"ל

```bash
node scripts/update-nsc.mjs
```

gov.il חוסם את השרתים של GitHub, ולכן המל"ל מתעדכן מהמחשב המקומי: משימה מתוזמנת ב־Windows (נרשמת עם `scripts/register-nsc-task.ps1`) מריצה כל יום ב־08:00 את `scripts/update-nsc-local.ps1`, שמעדכן, עושה commit ודוחף. לוג: `%LOCALAPPDATA%	ravel-map-nsc.log`.

ב־GitHub ה־workflow ב־`.github/workflows/update-data.yml` מריץ את `update-practical.mjs` כל יום ראשון (או ידנית מלשונית Actions).
