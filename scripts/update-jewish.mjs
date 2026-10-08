// Builds data/jewish-places.json: synagogues, Chabad houses and kosher food worldwide from OpenStreetMap,
// with per-country counts. Run weekly: node scripts/update-jewish.mjs
// The world is queried in 15°×15° land tiles (one global query is too heavy for the public Overpass servers);
// a tile that fails is split into quarters once.
// If too many tiles fail the previous file is kept.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const OUT = new URL('../data/jewish-places.json', import.meta.url);
const UA = 'travel-map-updater/0.1 (https://github.com/roysadeh520/travel-map)';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const run = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(bbox) {
  const q = `[out:json][timeout:90];(nwr["amenity"="place_of_worship"]["religion"="jewish"](${bbox});nwr["diet:kosher"~"^(yes|only)$"](${bbox}););out center tags qt;`;
  for (let attempt = 0; attempt < 2; attempt++) for (const url of MIRRORS) {
    try {
      const { stdout } = await run('curl', ['-s', '--fail', '-m', '110', '-A', UA, '--data-urlencode', `data=${q}`, url], { maxBuffer: 100e6, encoding: 'utf8' });
      return JSON.parse(stdout).elements;
    } catch { await sleep(5000 * (attempt + 1)); }
  }
  throw new Error(`tile ${bbox} failed`);
}

// country polygons for point-in-polygon
const geo = JSON.parse(await readFile(new URL('../data/countries.geojson', import.meta.url), 'utf8'));
const shapes = geo.features.filter(f => f.properties.iso2).map(f => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { iso2: f.properties.iso2, polys, bbox: [x0, y0, x1, y1] };
});
function countryAt(lat, lon) {
  for (const s of shapes) {
    const b = s.bbox;
    if (lat < b[1] || lat > b[3] || lon < b[0] || lon > b[2]) continue;
    for (const poly of s.polys) {
      let inside = false;
      for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return s.iso2;
    }
  }
  return null;
}

const CHABAD = /chabad|lubavitch|חב"ד|חב״ד|хабад/i;
const seen = new Set(), places = [], counts = {};
let failed = 0, tiles = 0;
function add(elements) {
  for (const el of elements) {
    const id = `${el.type}${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon, t = el.tags || {};
    if (la == null) continue;
    const kind = t.religion === 'jewish' ? (CHABAD.test(`${t.name || ''} ${t.operator || ''} ${t.denomination || ''}`) ? 'c' : 's') : 'k';
    const iso2 = countryAt(la, lo);
    places.push([+la.toFixed(5), +lo.toFixed(5), kind, t['name:he'] || t.name || '', iso2 || '', `${el.type[0]}${el.id}`]);
    if (iso2) { const c = (counts[iso2] ||= { s: 0, c: 0, k: 0 }); c[kind]++; }
  }
}
const hasLand = (s, w, n, e) => shapes.some(({ bbox: b }) => b[0] < e && b[2] > w && b[1] < n && b[3] > s);
const STEP = 15;
for (let lat = -60; lat < 75; lat += STEP) for (let lon = -180; lon < 180; lon += STEP) {
  const n = Math.min(lat + STEP, 85), e = lon + STEP;
  if (!hasLand(lat, lon, n, e)) continue;
  tiles++;
  try { add(await overpass(`${lat},${lon},${n},${e}`)); }
  catch {
    // split the tile into quarters and try those
    const h = STEP / 2;
    for (const [s, w] of [[lat, lon], [lat, lon + h], [lat + h, lon], [lat + h, lon + h]]) {
      try { add(await overpass(`${s},${w},${Math.min(s + h, 85)},${w + h}`)); }
      catch (err) { failed += 0.25; console.warn(err.message); }
      await sleep(1500);
    }
  }
  console.log(`tile ${tiles} (${lat},${lon}) · ${places.length} places`);
  await sleep(1500);
}

if (failed > tiles / 4) {
  console.error(`${failed}/${tiles} tiles failed – keeping the previous file`);
  process.exit(1);
}
await writeFile(OUT, JSON.stringify({ _meta: { updated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL)', failedTiles: failed }, counts, places }));
console.log(`${places.length} places in ${Object.keys(counts).length} countries (${failed}/${tiles} tiles failed)`);
