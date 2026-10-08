// Builds data/climate.json: the average daily high for every month on a 1° land grid, from NASA POWER's
// climatology (MERRA-2, 2001–2020). Daily high ≈ mean temperature (T2M) + half the mean daily range (T2M_RANGE).
// The heat map, the destination finder and the panel's "normal" line read this file, so they need no live
// weather requests and always agree. Run once (or yearly): node scripts/build-climate.mjs   (~10–15 min)
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/climate.json', import.meta.url);
const NORTH = 84, SOUTH = -56, STEP = 1;
const ROWS = (NORTH - SOUTH) / STEP + 1, COLS = 360;
const UA = 'travel-map-updater/0.1 (https://github.com/roysadeh520/travel-map)';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// land mask from the map's own country polygons (a node counts if it or a point half a degree away is land)
const geo = JSON.parse(await readFile(new URL('../data/countries.geojson', import.meta.url), 'utf8'));
const shapes = geo.features.filter(f => f.properties.iso2 !== 'AQ').map(f => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.map(p => {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { p, b: [x0, y0, x1, y1] };
  });
}).flat();
function isLand(lat, lon) {
  for (const { p, b } of shapes) {
    if (lat < b[1] || lat > b[3] || lon < b[0] || lon > b[2]) continue;
    let inside = false;
    for (const ring of p) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
const wrap = lon => ((lon + 540) % 360) - 180;
const land = new Uint8Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const lat = NORTH - r * STEP, lon = -180 + c * STEP;
  if ([[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].some(([dy, dx]) => isLand(lat + dy, wrap(lon + dx)))) land[r * COLS + c] = 1;
}
// keep land plus one ring of sea nodes, so the map can interpolate up to the coast
const keep = new Uint8Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  if (!land[r * COLS + c]) continue;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = (c + dc + COLS) % COLS;
    if (rr >= 0 && rr < ROWS) keep[rr * COLS + cc] = 1;
  }
}
console.log(`${keep.reduce((s, x) => s + x, 0)} grid nodes to fill`);

// POWER's regional climatology covers up to 10°×10° per request on its native 0.5°×0.625° grid;
// each native point is averaged into the nearest 1° node
const sum = new Float64Array(ROWS * COLS * 12), cnt = new Uint16Array(ROWS * COLS);
let boxes = 0, failed = 0;
for (let lat = SOUTH - 1; lat < NORTH; lat += 10) for (let lon = -180; lon < 180; lon += 10) {
  const r0 = Math.max(0, Math.floor((NORTH - Math.min(lat + 10, 90)) / STEP)), r1 = Math.min(ROWS - 1, Math.ceil((NORTH - lat) / STEP));
  let any = false;
  for (let r = r0; r <= r1 && !any; r++) for (let c = lon + 180; c < lon + 190 && !any; c++) any = keep[r * COLS + (c % COLS)];
  if (!any) continue;
  boxes++;
  // the regional endpoint takes one parameter per request
  const get = async param => {
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=${param}&community=RE`
      + `&latitude-min=${lat}&latitude-max=${Math.min(lat + 10, 90)}&longitude-min=${lon}&longitude-max=${lon + 10}&format=json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
        return (await res.json()).features;
      } catch (e) { console.warn(`
box ${lat},${lon} ${param}: ${e.message}`); await sleep(4000 * (attempt + 1)); }
    }
    return null;
  };
  const tF = await get('T2M'), rF = await get('T2M_RANGE');
  if (!tF || !rF) { failed++; continue; }
  const rangeAt = new Map(rF.map(f => [f.geometry.coordinates.slice(0, 2).join(','), f.properties.parameter.T2M_RANGE]));
  const data = { features: tF.map(f => ({ geometry: f.geometry, properties: { parameter: {
    T2M: f.properties.parameter.T2M, T2M_RANGE: rangeAt.get(f.geometry.coordinates.slice(0, 2).join(',')) || {} } } })) };
  for (const f of data.features) {
    const [plon, plat] = f.geometry.coordinates, t = f.properties.parameter.T2M, rg = f.properties.parameter.T2M_RANGE;
    const r = Math.round((NORTH - plat) / STEP), c = ((Math.round(plon + 180) % COLS) + COLS) % COLS;
    if (r < 0 || r >= ROWS || !keep[r * COLS + c]) continue;
    const i = r * COLS + c;
    if (MONTHS.some(m => t[m] == null || t[m] < -900 || rg[m] == null || rg[m] < -900)) continue;
    MONTHS.forEach((m, k) => { sum[i * 12 + k] += t[m] + rg[m] / 2; });
    cnt[i]++;
  }
  process.stdout.write(`\rboxes ${boxes} (failed ${failed})`);
  await sleep(300);
}
console.log();

// compact output: node indexes and, per node, 12 monthly highs rounded to 0.5°C (stored ×2 as integers)
const idx = [], vals = [];
for (let i = 0; i < ROWS * COLS; i++) {
  if (!cnt[i]) continue;
  idx.push(i);
  for (let k = 0; k < 12; k++) vals.push(Math.round(sum[i * 12 + k] / cnt[i] * 2));
}
if (failed > boxes / 10) { console.error(`${failed}/${boxes} boxes failed – not writing`); process.exit(1); }
await writeFile(OUT, JSON.stringify({
  _meta: { source: 'NASA POWER climatology (MERRA-2, 2001–2020) – average daily high = T2M + T2M_RANGE/2',
    built: new Date().toISOString().slice(0, 10), north: NORTH, west: -180, step: STEP, rows: ROWS, cols: COLS, scale: 2 },
  i: idx, v: vals,
}));
console.log(`${idx.length} nodes written`);
