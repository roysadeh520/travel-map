// Builds the link-preview image (og.png, 1200×630) and the PNG icons (favicon-48.png, apple-touch-icon.png) from
// favicon.svg and the site's own data: the world map in the risk index's colours, as the site shows it.
// Renders with the installed Microsoft Edge in headless mode (Windows). Run after the data or the icon changes:
//   node scripts/build-images.mjs
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const json = async f => JSON.parse(await readFile(join(root, 'data', f), 'utf8'));
const [geo, nscFile, antiFile] = await Promise.all([json('countries.geojson'), json('nsc-warnings.json'), json('antisemitism.json')]);
const icon = await readFile(join(root, 'favicon.svg'), 'utf8');

// the risk index, as in app.js (riskOf): 60% NSC + 40% ADL, with the level 3 / 4 floors
const RISK = [[20, '#2e9e5b'], [40, '#fdc470'], [60, '#f59a3e'], [80, '#e0592a'], [101, '#b3261e']];
const ADL_MID = [0.1, 0.3, 0.5, 0.7, 0.9];
function riskColor(code) {
  const a = antiFile.countries[code], w = nscFile.countries[code]?.level ? nscFile.countries[code] : null;
  const adl = a ? ADL_MID[a.level] : null;
  const nsc = w ? ((w.mixed ? w.min + 0.3 * (w.level - w.min) : w.level) - 1) / 3 : null;
  if (adl == null && nsc == null) return '#d5d8de';
  let score = 100 * (adl == null ? nsc : nsc == null ? adl : 0.6 * nsc + 0.4 * adl);
  if (w?.level === 4 && !w.mixed) score = Math.max(score, 80);
  else if (w?.level >= 3 && !(w.mixed && w.min <= 2)) score = Math.max(score, 60);
  return RISK.find(([max]) => Math.round(score) < max)[1];
}

// the world (without Antarctica) in Mercator, cropped to 75°N–56°S, fitted into the map box
const W = 600, H = 470, LON0 = -170, LON1 = 190, LAT0 = 75, LAT1 = -56;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const yTop = merc(LAT0), yBot = merc(LAT1);
const px = (lon, lat) => [((Math.max(LON0, lon) - LON0) / (LON1 - LON0)) * W, ((yTop - merc(Math.max(-85, Math.min(85, lat)))) / (yTop - yBot)) * H];
// rings at the far west edge (Chukotka, the western Aleutians, Fiji's eastern islands) move whole to the east side,
// so no shape is split across the map
const placeRing = ring => {
  const mean = ring.reduce((s, [lon]) => s + lon, 0) / ring.length;
  return mean < LON0 + 5 ? ring.map(([lon, lat]) => [lon + 360, lat]) : ring;
};
const paths = geo.features.filter(f => f.properties.iso2 !== 'AQ').map(f => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const d = polys.map(poly => poly.map(ring => placeRing(ring).map(([lon, lat], i) => {
    const [x, y] = px(lon, lat);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('') + 'Z').join('')).join('');
  return `<path d="${d}" fill="${riskColor(f.properties.iso2 || f.properties.a3)}"/>`;
}).join('');

// Heebo (the site's font) embedded as data, so the headless render does not fall back to another font
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' };
let fontCss = await (await fetch('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=block', { headers: UA })).text();
for (const url of new Set(fontCss.match(/https:[^)]+.woff2/g) || [])) {
  const b64 = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
  fontCss = fontCss.split(url).join(`data:font/woff2;base64,${b64}`);
}
const og = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>${fontCss}</style>
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: #1d2433; color: #fff; font-family: Heebo, Arial, sans-serif; display: flex; align-items: center; }
  .text { width: 540px; padding: 0 56px 0 10px; box-sizing: content-box; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { width: 84px; height: 84px; }
  h1 { font-size: 70px; margin: 0; line-height: 1; font-weight: 700; white-space: nowrap; }
  p { font-size: 33px; line-height: 1.35; margin: 26px 0 30px; color: #dfe5f1; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chips span { background: rgba(255,255,255,.1); border-radius: 12px; padding: 6px 14px; font-size: 23px; }
  .map { width: 560px; height: 439px; margin-left: 34px; background: #dcebf3; border-radius: 22px; overflow: hidden; }
  .map svg { width: 560px; height: 439px; }
  .map path { stroke: #fff; stroke-width: .6; }
</style></head><body>
  <div class="text">
    <div class="brand">${icon}<h1>מפת מטיילים</h1></div>
    <p>כמה בטוח, כמה חם ומה קורה – בכל מדינה, לתאריכים שלכם</p>
    <div class="chips"><span>🧭 מדד סיכון</span><span>🌤️ מזג אוויר</span><span>🛂 ויזה</span><span>🕯️ שבת וחגים</span><span>🎯 מאתר יעדים</span></div>
  </div>
  <div class="map"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths}</svg></div>
</body></html>`;

const iconPage = (size, pad, bg) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: ${bg}; }
  svg { display: block; width: ${size - 2 * pad}px; height: ${size - 2 * pad}px; margin: ${pad}px; }
</style></head><body>${icon}</body></html>`;

const dir = await mkdtemp(join(tmpdir(), 'tm-images-'));
async function shot(html, w, h, out) {
  const file = join(dir, `${out}.html`);
  await writeFile(file, html);
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(dir, 'profile-' + out)}`, `--window-size=${w},${h}`,
    '--virtual-time-budget=8000', `--screenshot=${join(root, out)}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log(`${out} ${w}×${h}`);
}
await shot(og, 1200, 630, 'og.png');
await shot(iconPage(48, 0, 'transparent'), 48, 48, 'favicon-48.png');
// iPhone home screen: a full square (iOS rounds the corners itself) on white
await shot(iconPage(180, 18, '#ffffff'), 180, 180, 'apple-touch-icon.png');
