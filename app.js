/* מפת מטיילים — אב־טיפוס.
   מקורות: Natural Earth + mledoze/countries (גבולות ופרטי מדינה, data/*.json), Open-Meteo (מזג אוויר),
   Nager.Date (חגים), Nominatim (חיפוש כתובות), Overpass (בתי כנסת / כשר), data/*.json (מקומי). */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ---------- constants ----------
// ADL Global 100 (2025) buckets: share of adults holding antisemitic attitudes
const ANTI = [
  { label: 'נמוכה', range: '0–20%', color: '#2e9e5b' },
  { label: 'בינונית־נמוכה', range: '21–40%', color: '#fdc470' },
  { label: 'בינונית', range: '41–60%', color: '#f59a3e' },
  { label: 'גבוהה', range: '61–80%', color: '#e0592a' },
  { label: 'גבוהה מאוד', range: '81–100%', color: '#b3261e' },
];
// NSC travel-warning scale (המל"ל)
const NSC = {
  1: { label: 'ללא אזהרת מסע', advice: 'לנקוט באמצעי זהירות רגילים', color: '#2e9e5b' },
  2: { label: 'איום מזדמן', advice: 'לנקוט באמצעי זהירות מוגברים', color: '#f2c94c' },
  3: { label: 'איום בינוני', advice: 'להימנע מנסיעות שאינן חיוניות', color: '#f2994a' },
  4: { label: 'איום גבוה', advice: 'להימנע מהגעה', color: '#c0392b' },
};
// Combined risk index for Jewish / Israeli travellers (0–100):
//   60% current NSC travel warning + 40% ADL antisemitic attitudes (survey 01/2025).
//   NSC levels 1–4 map to 0–1; a "combined" warning counts as its lower level + 30% of the gap to its higher level.
//   ADL buckets map to their midpoints (0–20% -> 0.1 … 81–100% -> 0.9).
//   Floors: country-wide NSC level 4 -> at least 80; NSC level 3 (or 3/4) -> at least 60.
//   With only one source available, that source alone is used.
const W_NSC = 0.6, W_ADL = 0.4;
const ADL_MID = [0.1, 0.3, 0.5, 0.7, 0.9];
const RISK = [
  { max: 20, label: 'נמוך', color: '#2e9e5b' },
  { max: 40, label: 'נמוך־בינוני', color: '#fdc470' },
  { max: 60, label: 'בינוני', color: '#f59a3e' },
  { max: 80, label: 'גבוה', color: '#e0592a' },
  { max: 101, label: 'גבוה מאוד', color: '#b3261e' },
];
// Territories have no NSC entry of their own: use the sovereign country's warning
const SOVEREIGN = {
  GL: 'DK', FO: 'DK', PR: 'US', VI: 'US', GU: 'US', AS: 'US', MP: 'US',
  NC: 'FR', PF: 'FR', WF: 'FR', PM: 'FR', MF: 'FR', BL: 'FR', TF: 'FR', AW: 'NL', CW: 'NL', SX: 'NL',
  GG: 'GB', JE: 'GB', IM: 'GB', BM: 'GB', KY: 'GB', VG: 'GB', TC: 'GB', MS: 'GB', AI: 'GB', FK: 'GB', SH: 'GB', PN: 'GB', IO: 'GB', GS: 'GB',
  AX: 'FI', MO: 'CN', NU: 'NZ', CK: 'NZ', NF: 'AU', HM: 'AU', EH: 'MA',
};
function nscFor(code) {
  const own = state.nsc[code];
  if (own?.level) return own;
  const p = SOVEREIGN[code];
  return p && state.nsc[p]?.level ? { ...state.nsc[p], inheritedFrom: p } : null;
}
// map key of a feature: ISO code, or Natural Earth's A3 for areas without one (e.g. Somaliland)
const keyOf = p => p.iso2 || p.a3;

function riskOf(iso2) {
  const a = state.anti[iso2], w = nscFor(iso2);
  const adl = a ? ADL_MID[a.level] : null;
  const nsc = w ? ((w.mixed ? w.min + 0.3 * (w.level - w.min) : w.level) - 1) / 3 : null;
  if (adl == null && nsc == null) return null;
  let score = 100 * (adl == null ? nsc : nsc == null ? adl : W_NSC * nsc + W_ADL * adl);
  if (w?.level === 4 && !w.mixed) score = Math.max(score, 80);
  else if (w?.level >= 3 && !(w.mixed && w.min <= 2)) score = Math.max(score, 60);
  score = Math.round(score);
  const bucket = RISK.findIndex(b => score < b.max);
  return { score, bucket, ...RISK[bucket], partial: adl == null ? 'nsc' : nsc == null ? 'adl' : null };
}
const darkText = c => (c === '#fdc470' || c === '#f2c94c' ? '#8a6100' : c);
const NODATA = '#d5d8de';
const EVENT_ON = '#8b5cf6', EVENT_OFF = '#ece9f5';
const CAT_ICON = { music: '🎵', carnival: '🎭', festival: '🎉', film: '🎬', sport: '🏆', christmas: '🎄', nature: '🌸' };
const CAT_NAME = { music: 'מוזיקה', carnival: 'קרנבל', festival: 'פסטיבל', film: 'קולנוע', sport: 'ספורט', christmas: 'כריסמס', nature: 'טבע' };
const MAX_DAYS = 31;

const heNames = new Intl.DisplayNames(['he'], { type: 'region' });
const fmtNum = new Intl.NumberFormat('he-IL');
const fmtWeekday = new Intl.DateTimeFormat('he-IL', { weekday: 'short' });
const dmy = s => s.slice(0, 10).split('-').reverse().join('/');            // 2026-12-10 -> 10/12/2026
const dayLabel = s => `${fmtWeekday.format(parse(s))} ${s.slice(8, 10)}/${s.slice(5, 7)}`; // יום ה׳ 10/12
const dmyTime = isoStr => { const d = new Date(isoStr); return `${dmy(iso(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ---------- state ----------
const state = {
  layer: 'risk', riskMode: 'combined', from: null, to: null,
  selected: null,       // iso2
  point: null,          // {lat, lon, label} — where weather is shown in the panel
  features: {},         // iso2 -> GeoJSON feature
  info: {},             // iso2 -> data/country-info.json record
  anti: {}, antiMeta: {},
  nsc: {}, nscMeta: {},
  practical: {},        // data/practical.json: visa, emergency, plugs, voltage, driving side, missions
  practicalOpen: true,
  finder: null,         // destination-finder criteria while its panel is open
  ctemps: null,         // { key, temps } per-country temperature for the finder
  events: [],
  cities: [],           // [he, en, iso2, lat, lon, pop] — Natural Earth, for Hebrew search
};
const cache = new Map();

// ---------- date helpers ----------
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const shiftYears = (s, n) => { const d = parse(s); d.setFullYear(d.getFullYear() + n); return iso(d); };
const today = () => iso(new Date());

// ---------- fetch helpers ----------
async function getJSON(url, opts) {
  const key = url + (opts?.body || '');
  if (cache.has(key)) return cache.get(key);
  const p = fetch(url, opts).then(r => {
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const ltr = s => `<bdi dir="ltr">${s}</bdi>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- country helpers ----------
const AREA_NAMES = { GAZ: 'רצועת עזה' };
function nameHe(iso2, fallback) {
  if (AREA_NAMES[iso2]) return AREA_NAMES[iso2];
  try { const n = iso2 && heNames.of(iso2); if (n && n !== iso2) return n; } catch {}
  return fallback;
}
function centroid(feature) {
  // center of the bbox of the largest outer ring — good enough as a fallback point
  const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let best, bestArea = -1;
  for (const p of polys) {
    const xs = p[0].map(c => c[0]), ys = p[0].map(c => c[1]);
    const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const a = (b[2] - b[0]) * (b[3] - b[1]);
    if (a > bestArea) { bestArea = a; best = b; }
  }
  return { lat: (best[1] + best[3]) / 2, lon: (best[0] + best[2]) / 2 };
}
function repPoint(iso2) {
  const i = state.info[iso2];
  if (i?.cap) return { lat: i.cap[0], lon: i.cap[1], label: i.capital?.[0] };
  const f = state.features[iso2];
  return f ? { ...centroid(f), label: 'מרכז המדינה' } : null;
}

// ---------- events ----------
function eventsInRange(iso2, from = state.from, to = state.to) {
  const out = [];
  const y0 = parse(from).getFullYear() - 1, y1 = parse(to).getFullYear();
  for (const e of state.events) {
    if (iso2 && e.cc !== iso2) continue;
    for (let y = y0; y <= y1; y++) {
      const start = `${y}-${e.from}`;
      const end = e.to < e.from ? `${y + 1}-${e.to}` : `${y}-${e.to}`;
      if (start <= to && end >= from) { out.push({ ...e, start, end }); break; }
    }
  }
  return out;
}

// ---------- weather ----------
// Decide which Open-Meteo endpoint answers this date range.
function weatherPlan(from, to) {
  const t = today();
  if (from >= addDays(t, -60) && to <= addDays(t, 15)) return { kind: 'forecast', from, to };
  if (to <= addDays(t, -6)) return { kind: 'actual', from, to };
  // future beyond the forecast horizon -> same dates in previous years
  let n = -1;
  while (shiftYears(to, n) > addDays(t, -6)) n--;
  return { kind: 'estimate', shift: n, from, to };
}
function wxURL(kind, lats, lons, from, to, daily) {
  const base = kind === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  return `${base}?latitude=${lats}&longitude=${lons}&start_date=${from}&end_date=${to}&daily=${daily}&timezone=auto`;
}
const WX = c => c == null ? ['', ''] :
  c === 0 ? ['☀️', 'בהיר'] : c <= 2 ? ['🌤️', 'מעונן חלקית'] : c === 3 ? ['☁️', 'מעונן'] :
  c <= 48 ? ['🌫️', 'ערפל'] : c <= 57 ? ['🌦️', 'טפטוף'] : c <= 67 ? ['🌧️', 'גשם'] :
  c <= 77 ? ['🌨️', 'שלג'] : c <= 82 ? ['🌧️', 'ממטרים'] : c <= 86 ? ['🌨️', 'ממטרי שלג'] : ['⛈️', 'סופות רעמים'];
const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// daily max / min / rain for several points in one request; beyond the forecast horizon: 3-year average
async function wxSeries(points, daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum') {
  const plan = weatherPlan(state.from, state.to);
  const lats = points.map(p => p.lat.toFixed(2)).join(','), lons = points.map(p => p.lon.toFixed(2)).join(',');
  const asList = r => (Array.isArray(r) ? r : [r]);
  const runs = plan.kind === 'estimate'
    ? await Promise.all([plan.shift, plan.shift - 1, plan.shift - 2].map(n =>
        getJSON(wxURL('archive', lats, lons, shiftYears(plan.from, n), shiftYears(plan.to, n), daily)).then(asList)))
    : [asList(await getJSON(wxURL(plan.kind === 'forecast' ? 'forecast' : 'archive', lats, lons, plan.from, plan.to, daily)))];
  const len = daysBetween(plan.from, plan.to) + 1;
  return points.map((_, k) => {
    const days = [];
    for (let i = 0; i < len; i++) days.push({
      hi: avg(runs.map(r => r[k]?.daily?.temperature_2m_max?.[i])),
      lo: avg(runs.map(r => r[k]?.daily?.temperature_2m_min?.[i])),
      rain: avg(runs.map(r => r[k]?.daily?.precipitation_sum?.[i])),
    });
    return days;
  });
}

// biggest cities of a country, spread out so a large country shows several climates
const kmBetween = (a, b) => {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function spreadCities(iso2, max = 5) {
  const f = state.features[iso2]; if (!f) return [];
  const bb = L.geoJSON(f).getBounds();
  const diag = kmBetween({ lat: bb.getSouth(), lon: bb.getWest() }, { lat: bb.getNorth(), lon: bb.getEast() });
  const minKm = Math.min(600, Math.max(80, diag / 5));
  const out = [];
  for (const [he, en, cc, lat, lon] of state.cities) {
    if (cc !== iso2) continue;
    const c = { he, en, lat, lon };
    if (out.every(o => kmBetween(o, c) >= minKm)) out.push(c);
    if (out.length === max) break;
  }
  return out;
}
// province / state name (Hebrew if OSM has one, else English) followed by the country in Hebrew, e.g. "Mersin, טורקיה"
async function regionName(lat, lon, iso2) {
  try {
    const r = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=he,en&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,
      { signal: AbortSignal.timeout(2500) });
    const a = r?.address || {}, region = a.province || a.state || a.county || a.region;
    return region ? `${region}, ${nameHe(iso2, iso2)}` : null;
  } catch { return null; }
}
function nearestCity(lat, lon, maxKm = 60) {
  let best = null, bestKm = maxKm;
  for (const [he, , , clat, clon] of state.cities) {
    if (Math.abs(clat - lat) > 1 || Math.abs(clon - lon) > 1.5) continue;
    const km = kmBetween({ lat, lon }, { lat: clat, lon: clon });
    if (km < bestKm) { bestKm = km; best = he; }
  }
  return best;
}

async function countryWeather(pt) {
  const plan = weatherPlan(state.from, state.to);
  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,sunrise,sunset,daylight_duration';
  const lat = pt.lat.toFixed(3), lon = pt.lon.toFixed(3);
  if (plan.kind !== 'estimate') {
    const r = await getJSON(wxURL(plan.kind === 'forecast' ? 'forecast' : 'archive', lat, lon, plan.from, plan.to, daily));
    return { plan, tz: r.timezone, days: r.daily.time.map((t, i) => ({
      date: t, hi: r.daily.temperature_2m_max[i], lo: r.daily.temperature_2m_min[i],
      rain: r.daily.precipitation_sum[i], code: r.daily.weather_code[i],
      sunrise: r.daily.sunrise?.[i], sunset: r.daily.sunset?.[i], daylight: r.daily.daylight_duration?.[i] })) };
  }
  // estimate: average of the same dates over the last 3 available years
  const years = [plan.shift, plan.shift - 1, plan.shift - 2];
  const runs = await Promise.all(years.map(n =>
    getJSON(wxURL('archive', lat, lon, shiftYears(plan.from, n), shiftYears(plan.to, n), daily))));
  const len = daysBetween(plan.from, plan.to) + 1;
  const days = [];
  for (let i = 0; i < len; i++) {
    const hi = avg(runs.map(r => r?.daily?.temperature_2m_max?.[i]));
    const lo = avg(runs.map(r => r?.daily?.temperature_2m_min?.[i]));
    const rain = avg(runs.map(r => r?.daily?.precipitation_sum?.[i]));
    days.push({ date: addDays(plan.from, i), hi, lo, rain, code: rain >= 1 ? (lo < 1 ? 71 : 61) : 1,
      sunrise: runs[0]?.daily?.sunrise?.[i], sunset: runs[0]?.daily?.sunset?.[i], daylight: runs[0]?.daily?.daylight_duration?.[i] });
  }
  return { plan, tz: runs[0]?.timezone, days };
}

async function loadCitiesWx(iso2, token) {
  const cities = spreadCities(iso2);
  if (cities.length < 2) return;
  try {
    const series = await wxSeries(cities);
    if (token !== panelToken || !$('#citiesWx')) return;
    $('#citiesWx').innerHTML = `<h4 class="sub-h">ערים מרכזיות <small>· לחצו לפירוט יומי</small></h4>
      <table class="wx cities">${cities.map((c, k) => {
        const d = series[k], hi = avg(d.map(x => x.hi)), lo = avg(d.map(x => x.lo)), wet = d.filter(x => x.rain >= 1).length;
        return `<tr data-city="${k}"><td>${esc(c.he)}</td>
          <td><span class="tchip" style="background:${tempColor(hi)}">${Math.round(hi)}°</span></td>
          <td class="lo">${Math.round(lo)}°</td><td>${wet ? `🌧️ ${wet}` : '☀️'}</td></tr>`;
      }).join('')}</table>`;
    $('#citiesWx').onclick = e => {
      const k = e.target.closest('[data-city]')?.dataset.city; if (k == null) return;
      const c = cities[+k];
      selectCountry(iso2, { point: { lat: c.lat, lon: c.lon, label: c.he, clicked: true } });
    };
  } catch (e) { console.error(e); }
}

// ---------- holidays ----------
// Hebcal lists multi-day holidays one day at a time ("חנוכה: א׳ נר" … "חנוכה: יום ח׳"): merge consecutive days
const holidayBase = h => h.split(':')[0].replace(/\s+[א-ת]{1,2}׳.*$/, '').replace(/\s*\(.*\)$/, '').trim();
function mergeHolidays(list) {
  const out = [];
  for (const h of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
    const base = holidayBase(h.localName);
    // another holiday may fall in between (e.g. חג הבנות during Hanukkah), so look at every open group
    const g = out.find(o => o.base === base && daysBetween(o.end, h.date) <= 1);
    if (g) g.end = h.date;
    else out.push({ ...h, base, localName: base, name: h.name === h.localName ? base : h.name, end: h.date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function holidays(iso2) {
  // Nager.Date has no Israel: use Hebcal's Israeli holiday calendar (major + modern holidays)
  if (iso2 === 'IL') {
    const r = await getJSON(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&mod=on&i=on&lg=he&start=${state.from}&end=${state.to}`).catch(() => null);
    if (!r) return null;
    return mergeHolidays((r.items || []).filter(i => i.category === 'holiday').map(i => ({ date: i.date.slice(0, 10), localName: i.hebrew || i.title, name: i.hebrew || i.title })));
  }
  const y0 = parse(state.from).getFullYear(), y1 = parse(state.to).getFullYear();
  const lists = await Promise.all([...new Set([y0, y1])].map(y =>
    getJSON(`https://date.nager.at/api/v3/PublicHolidays/${y}/${iso2}`).catch(() => null)));
  if (lists.every(l => !l)) return null;
  return lists.flat().filter(h => h && h.date >= state.from && h.date <= state.to);
}

// ---------- map ----------
const map = L.map('map', {
  zoomControl: true, minZoom: 2, maxZoom: 18, worldCopyJump: false,
  maxBounds: [[-85, -220], [85, 220]], maxBoundsViscosity: 0.8, preferCanvas: true,
}).setView([30, 15], 2.5);
// Up to zoom 7 a label-free basemap with our own Hebrew labels on top; from zoom 8 OpenStreetMap,
// whose street and place names are needed for addresses (country names are not shown that close anyway)
const LABEL_MAX_ZOOM = 7;
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri', maxZoom: LABEL_MAX_ZOOM, className: 'base-terrain',
}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', minZoom: LABEL_MAX_ZOOM + 1, maxZoom: 19,
}).addTo(map);

// The Esri base paints inland water (Caspian, Great Lakes, Victoria…) white like the land:
// draw the big lakes in its sea colour, under the country fills and only while that base is shown
map.createPane('water');
map.getPane('water').style.zIndex = 250;
map.getPane('water').style.pointerEvents = 'none';
map.getPane('water').classList.add('base-terrain');   // same colour filter as the tiles
const waterLayer = L.layerGroup();
fetch('data/lakes.geojson').then(r => r.json()).then(g => {
  L.geoJSON(g, { pane: 'water', interactive: false, style: { stroke: false, fillColor: '#90ded8', fillOpacity: 1 } }).addTo(waterLayer);
  const sync = () => Math.round(map.getZoom()) <= LABEL_MAX_ZOOM ? waterLayer.addTo(map) : waterLayer.remove();
  map.on('zoomend', sync); sync();
}).catch(() => {});

// ---------- Hebrew labels ----------
map.createPane('labels');
map.getPane('labels').style.zIndex = 450;
map.getPane('labels').style.pointerEvents = 'none';
const labelLayer = L.layerGroup().addTo(map);
let labelFeatures = [];
const REGION_LABELS = [{ he: 'יהודה ושומרון', lat: 31.95, lon: 35.27, minz: 6 }];
function drawLabels() {
  labelLayer.clearLayers();
  const z = map.getZoom();
  if (z > LABEL_MAX_ZOOM || !labelFeatures.length) return;
  const view = map.getBounds().pad(0.15), placed = [];
  // greedy placement in priority order; a label is skipped if its box overlaps one already placed
  const place = (lat, lon, text, cls, px) => {
    if (!view.contains([lat, lon])) return;
    const p = map.latLngToContainerPoint([lat, lon]), w = text.length * px * 0.62 + 8, h = px + 6;
    // country names are centred on their point; city names sit to the left of the city dot
    const box = cls === 'city' ? [p.x - w, p.y - h / 2, p.x + 4, p.y + h / 2] : [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2];
    if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
    placed.push(box);
    L.marker([lat, lon], { pane: 'labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: `map-label ${cls}`, html: `<span style="font-size:${px}px">${esc(text)}</span>`, iconSize: [0, 0] }) }).addTo(labelLayer);
  };
  for (const f of labelFeatures) {
    const p = f.properties;
    if (p.minz > z + 1.5) continue;
    const px = Math.round(Math.max(10, Math.min(18, 9 + z * 1.2 - (p.rank - 2) * 1.1)));
    place(p.ly, p.lx, nameHe(p.iso2 || p.a3, p.he || p.en), p.iso2 ? 'country' : 'region', p.iso2 ? px : 11);
  }
  for (const r of REGION_LABELS) if (z >= r.minz) place(r.lat, r.lon, r.he, 'region', 11);
  const minPop = z <= 3 ? Infinity : z === 4 ? 5e6 : z === 5 ? 2e6 : z === 6 ? 7e5 : 2.5e5;
  for (const [he, , , lat, lon, pop] of state.cities) {
    if (pop < minPop) break;   // sorted by population
    place(lat, lon, he, 'city', z >= 6 ? 12 : 11);
  }
}
map.on('zoomend moveend', drawLabels);

// ---------- temperature heat map ----------
// Grid points regular in *screen* space (snapped to a lat/lon lattice so panning reuses cached values) are fetched
// from Open-Meteo for land only, painted one pixel per point into a tiny canvas, scaled up with smoothing
// (= bilinear interpolation) and clipped to the land polygons.
const TEMP_STOPS = [[-25, [44, 62, 145]], [-10, [59, 111, 216]], [0, [127, 178, 236]], [10, [198, 227, 214]],
  [18, [249, 221, 119]], [25, [245, 155, 76]], [32, [217, 74, 43]], [40, [139, 26, 26]]];
function tempRGB(t) {
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i], [t0, c0] = TEMP_STOPS[i - 1];
    if (t <= t1) { const k = (t - t0) / (t1 - t0); return c0.map((v, j) => Math.round(v + k * (c1[j] - v))); }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}
const tempColor = t => `rgb(${tempRGB(t).join(',')})`;

map.createPane('heat');
map.getPane('heat').style.zIndex = 350;
map.getPane('heat').style.pointerEvents = 'none';
const heatCanvas = L.DomUtil.create('canvas', 'heat-canvas', map.getPane('heat'));
const heat = { grid: null, cols: 0, rows: 0, w: 0, h: 0, origin: null, zoom: null, estimate: false, seq: 0 };
const tempCache = new Map();
const MAX_HEAT_POINTS = 220;   // Open-Meteo counts every location as one call (600/min on the free tier)
const pointMarker = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#1d2433', fillOpacity: 1 });

const niceStep = d => [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10].find(s => s >= d) || 10;
const snapTo = (v, step) => Math.round(v / step) * step;
const wrapLon = lon => ((lon + 540) % 360) - 180;
function isLand(lat, lon) {
  for (const f of landFeatures) {
    const b = f.bbox;
    if (lat < b[1] || lat > b[3] || lon < b[0] || lon > b[2]) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      let inside = false;
      for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
  }
  return false;
}

let heatTimer;
async function loadHeat() {
  if (state.layer !== 'temp' || !landFeatures.length) return;
  const seq = ++heat.seq, size = map.getSize();
  const cols = Math.max(8, Math.min(22, Math.round(size.x / 50))), rows = Math.max(6, Math.round(cols * size.y / size.x));
  // snap to half the grid spacing: panning still hits the cache, but a sample never drifts more than a quarter cell
  const b = map.getBounds(), step = niceStep(Math.min(360, b.getEast() - b.getWest()) / cols / 2);
  const plan = weatherPlan(state.from, state.to);
  const from = plan.kind === 'estimate' ? shiftYears(plan.from, plan.shift) : plan.from;
  const to = plan.kind === 'estimate' ? shiftYears(plan.to, plan.shift) : plan.to;
  const kind = plan.kind === 'forecast' ? 'forecast' : 'archive';

  const samples = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ll = map.containerPointToLatLng([(c + 0.5) * size.x / cols, (r + 0.5) * size.y / rows]);
    const rawLat = Math.max(-84, Math.min(84, ll.lat)), rawLon = wrapLon(ll.lng);
    const lat = +snapTo(rawLat, step).toFixed(2), lon = +snapTo(rawLon, step).toFixed(2);
    samples.push({ lat, lon, land: isLand(rawLat, rawLon) || isLand(lat, lon), key: `${kind}_${from}_${to}_${lat}_${lon}` });
  }
  const need = [...new Map(samples.filter(s => s.land && !tempCache.has(s.key)).map(s => [s.key, s])).values()].slice(0, MAX_HEAT_POINTS);
  if (need.length) toast('טוען טמפרטורות…', 8000);
  try {
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      let res = await getJSON(wxURL(kind, chunk.map(p => p.lat).join(','), chunk.map(p => p.lon).join(','), from, to, 'temperature_2m_max'));
      if (!Array.isArray(res)) res = [res];
      res.forEach((r, j) => tempCache.set(chunk[j].key, avg(r?.daily?.temperature_2m_max || [])));
    }
  } catch (e) {
    console.error(e);
    toast('לא הצלחנו לטעון טמפרטורות (ייתכן שחרגנו ממכסת Open-Meteo). נסו שוב בעוד דקה.');
  }
  if (seq !== heat.seq || state.layer !== 'temp') return;
  if (need.length) $('#toast').hidden = true;

  // ocean cells take the average of their land neighbours, so colours don't fade at the coast
  let grid = samples.map(s => (s.land ? tempCache.get(s.key) ?? null : null));
  for (let pass = 0; pass < 4 && grid.some(v => v == null); pass++) {
    grid = grid.map((v, i) => {
      if (v != null) return v;
      const r = Math.floor(i / cols), c = i % cols, near = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < rows && cc >= 0 && cc < cols && grid[rr * cols + cc] != null) near.push(grid[rr * cols + cc]);
      }
      return near.length ? avg(near) : null;
    });
  }
  Object.assign(heat, { grid, cols, rows, w: size.x, h: size.y, origin: map.containerPointToLayerPoint([0, 0]), zoom: map.getZoom(), estimate: plan.kind === 'estimate' });
  drawHeat();
  drawLegend();
}

function drawHeat() {
  const ctx = heatCanvas.getContext('2d');
  if (state.layer !== 'temp' || !heat.grid || heat.zoom !== map.getZoom()) { ctx.clearRect(0, 0, heatCanvas.width, heatCanvas.height); return; }
  const { grid, cols, rows, w, h } = heat;
  heatCanvas.width = w; heatCanvas.height = h;
  heatCanvas.style.width = w + 'px'; heatCanvas.style.height = h + 'px';
  L.DomUtil.setPosition(heatCanvas, heat.origin);
  heatCanvas.style.opacity = '';

  const small = document.createElement('canvas');
  small.width = cols; small.height = rows;
  const sctx = small.getContext('2d'), img = sctx.createImageData(cols, rows);
  grid.forEach((t, i) => { if (t != null) img.data.set([...tempRGB(t), 255], i * 4); });
  sctx.putImageData(img, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);

  // keep only land
  const view = map.getBounds().pad(0.1);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  for (const f of landFeatures) {
    const b = f.bbox;
    if (b[2] < view.getWest() || b[0] > view.getEast() || b[3] < view.getSouth() || b[1] > view.getNorth()) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) ring.forEach(([lon, lat], i) => {
      const p = map.latLngToLayerPoint([lat, lon]).subtract(heat.origin);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
  }
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = 'source-over';
}

// temperature under the cursor, bilinear on the grid
function tempAt(ll) {
  const { grid, cols, rows, w, h } = heat;
  if (!grid || heat.zoom !== map.getZoom()) return null;
  const p = map.latLngToLayerPoint(ll).subtract(heat.origin);
  const gx = Math.max(0, Math.min(cols - 1, p.x / w * cols - 0.5)), gy = Math.max(0, Math.min(rows - 1, p.y / h * rows - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
  const v = (x, y) => grid[y * cols + x];
  const q = [v(x0, y0), v(x1, y0), v(x0, y1), v(x1, y1)];
  if (q.some(x => x == null)) return avg(q);
  const fx = gx - x0, fy = gy - y0;
  return (q[0] * (1 - fx) + q[1] * fx) * (1 - fy) + (q[2] * (1 - fx) + q[3] * fx) * fy;
}

let landFeatures = [];
map.on('zoomstart', () => { heatCanvas.style.opacity = 0; });
map.on('moveend resize', () => {
  if (state.layer !== 'temp') return;
  drawHeat();
  clearTimeout(heatTimer);
  heatTimer = setTimeout(loadHeat, 350);
});

let countryLayer;
function fillFor(iso2) {
  if (!iso2) return NODATA;
  if (state.layer === 'risk') {
    if (state.riskMode === 'nsc') { const n = nscFor(iso2); return n ? NSC[n.min || n.level].color : NODATA; }
    if (state.riskMode === 'adl') { const a = state.anti[iso2]; return a ? ANTI[a.level].color : NODATA; }
    return riskOf(iso2)?.color || NODATA;
  }
  if (state.layer === 'temp') return '#000';
  return eventsInRange(iso2).length ? EVENT_ON : EVENT_OFF;
}
function styleFor(f) {
  const sel = f.properties.iso2 && f.properties.iso2 === state.selected;
  // fade the fill as the user zooms in so the street map stays readable
  const z = map.getZoom();
  const op = state.layer === 'temp' ? 0 : z >= 9 ? 0.12 : z >= 6 ? 0.35 : 0.72;
  // NSC "combined" warnings: fill = most of the country, dashed outline in the colour of the riskier regions
  const key = keyOf(f.properties), w = nscFor(key), fill = fillFor(key);
  if (state.finder) {
    const hit = finderMatches.has(key);
    return { fillColor: hit ? '#2f6fde' : '#c9ced8', fillOpacity: hit ? 0.6 : 0.45, color: sel ? '#1d2433' : '#fff', weight: sel ? 2.5 : 0.7, dashArray: null };
  }
  const mixed = state.layer === 'risk' && state.riskMode !== 'adl' && w?.mixed;
  if (sel) return { fillColor: fill, fillOpacity: op, color: '#1d2433', weight: 2.5, dashArray: null };
  if (mixed) return { fillColor: fill, fillOpacity: op, color: NSC[w.level].color, weight: 2, dashArray: '5 4' };
  return { fillColor: fill, fillOpacity: op, color: '#ffffff', weight: 0.7, dashArray: null };
}
function restyle() { countryLayer?.setStyle(styleFor); }
function tooltipFor(p) {
  const n = nameHe(p.iso2, p.he || p.en);
  let extra = '';
  if (state.layer === 'risk') {
    // the risk tab always shows both sources, whatever sub-view is coloured
    const key = keyOf(p), r = riskOf(key), w = nscFor(key), a = state.anti[key];
    const nscLine = !w ? 'אין אזהרה מפורסמת'
      : (w.mixed ? `רמה ${w.min}–${w.level} · ${NSC[w.min].label}, באזורים מסוימים ${NSC[w.level].label}` : `רמה ${w.level} · ${NSC[w.level].label}`)
        + (w.inheritedFrom ? ` (לפי ${nameHe(w.inheritedFrom, w.inheritedFrom)})` : '');
    const adlLine = a ? `${ANTI[a.level].label} · ${ltr(ANTI[a.level].range)}` : `לא נסקרה${w ? ' – המדד לפי המל״ל בלבד' : ''}`;
    return `<b>${esc(n)}</b>
      ${r ? `<div class="tt-score" style="color:${darkText(r.color)}">מדד סיכון: <b>${r.score}</b> · ${r.label}</div>` : ''}
      <div class="tt-row">🚨 מל״ל: ${nscLine}</div>
      <div class="tt-row">🛡️ אנטישמיות: ${adlLine}</div>`;
  }
  else if (state.layer === 'temp') {
    const t = state.mouseLL ? tempAt(state.mouseLL) : null;
    extra = t == null ? 'לחצו לפרטי מזג האוויר' : `🌡️ כאן: ${Math.round(t)}° <small>(ממוצע מקסימום יומי)</small>`;
  }
  else { const ev = eventsInRange(p.iso2); extra = ev.length ? ev.map(e => (CAT_ICON[e.cat] || '') + ' ' + e.name).join('<br>') : 'אין אירועים במאגר בתאריכים אלה'; }
  return `<b>${esc(n)}</b><br><span style="color:#6b7385">${extra}</span>`;
}

// event markers (visible on the events layer)
const eventLayer = L.layerGroup();
function drawEventMarkers(only = null) {
  eventLayer.clearLayers();
  for (const e of eventsInRange(null)) {
    if (only && !only.has(e.cc)) continue;
    L.marker([e.lat, e.lon], {
      icon: L.divIcon({ className: '', html: `<div style="font-size:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">${CAT_ICON[e.cat] || '📍'}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).bindPopup(`<b>${esc(e.name)}</b><br>${esc(e.city)}<br><small>${dmy(e.start)} – ${dmy(e.end)}${e.approx ? ' (משוער)' : ''}</small>`)
      .addTo(eventLayer);
  }
}

// ---------- legend ----------
function drawLegend() {
  const L_ = $('#legend');
  const rows = (items) => items.map(i => `<div class="row"><span class="sw" style="background:${i.color}"></span>${i.label}</div>`).join('');
  if (state.layer === 'risk') {
    const seg = `<div class="seg">${[['combined', 'משולב'], ['adl', 'אנטישמיות'], ['nsc', 'מל״ל']].map(([k, t]) =>
      `<button data-mode="${k}" class="${state.riskMode === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const dashed = `<div class="row"><span class="sw" style="background:#fff;border:2px dashed ${NSC[4].color}"></span>אזורים מסוימים ברמה גבוהה יותר</div>`;
    let body;
    if (state.riskMode === 'nsc') body = `${rows([1, 2, 3, 4].map(l => ({ color: NSC[l].color, label: `רמה ${l} · ${NSC[l].label}` })))}${rows([{ color: NODATA, label: 'אין מידע' }])}${dashed}
      <div class="sub">אזהרות מסע של המל״ל · עודכן ${state.nscMeta.updated ? dmyTime(state.nscMeta.updated) : '–'} · <a href="${esc(state.nscMeta.url)}" target="_blank" rel="noopener">gov.il</a></div>`;
    else if (state.riskMode === 'adl') body = `${rows(ANTI.map(a => ({ color: a.color, label: `${a.label} · ${ltr(a.range)}` })))}${rows([{ color: NODATA, label: 'לא נסקרה' }])}
      <div class="sub">אחוז המבוגרים עם עמדות אנטישמיות · <a href="${esc(state.antiMeta.url)}" target="_blank" rel="noopener">ADL Global 100</a>, סקר 01/2025</div>`;
    else body = `${rows(RISK.map((b, i) => ({ color: b.color, label: `${b.label} · ${ltr(`${i * 20}–${i === 4 ? 100 : i * 20 + 20}`)}` })))}${rows([{ color: NODATA, label: 'אין נתונים' }])}${dashed}
      <div class="sub">60% אזהרת המל״ל (עדכני) + 40% עמדות אנטישמיות (ADL 01/2025). אזהרת רמה 4 → לפחות 80, רמה 3 → לפחות 60.</div>`;
    L_.innerHTML = `<h4>מדד סיכון ליהודים וישראלים</h4>${seg}${body}`;
  } else if (state.layer === 'temp') {
    const ticks = [-20, -10, 0, 10, 20, 30, 40];
    L_.innerHTML = `<h4>טמפרטורה מקסימלית ממוצעת</h4>
      <div class="tbar" style="background:linear-gradient(to right, ${ticks.map(t => tempColor(t)).join(', ')})"></div>
      <div class="tticks">${ticks.map(t => `<span>${t}°</span>`).join('')}</div>
      <div class="sub">רשת נקודות לפי האזור שעל המסך – התקרבו לפירוט. לחיצה על מדינה מציגה מזג אוויר בנקודה.${heat.estimate ? '<br>הערכה לפי אותם תאריכים בשנה הקודמת (מעבר לטווח התחזית).' : ''}</div>`;
  } else {
    L_.innerHTML = `<h4>אירועים עונתיים בתאריכים שנבחרו</h4>${rows([{ color: EVENT_ON, label: 'יש אירועים' }, { color: EVENT_OFF, label: 'אין במאגר' }])}
      <div class="sub">${Object.keys(CAT_ICON).map(k => `${CAT_ICON[k]} ${CAT_NAME[k]}`).join(' · ')}</div>`;
  }
}

// phone: the filter rows can be collapsed (shown by default; the choice is remembered)
function setFiltersHidden(hidden) {
  document.body.classList.toggle('filters-hidden', hidden);
  $('#filtersToggle').textContent = hidden ? '▼' : '▲';
  $('#filtersToggle').setAttribute('aria-label', hidden ? 'הצגת הפילטרים' : 'הסתרת הפילטרים');
  try { localStorage.setItem('filtersHidden', hidden ? '1' : ''); } catch {}
  setTimeout(() => map.invalidateSize(), 50);
}
$('#filtersToggle').addEventListener('click', () => setFiltersHidden(!document.body.classList.contains('filters-hidden')));
try { if (localStorage.getItem('filtersHidden')) setFiltersHidden(true); } catch {}

$('#legend').addEventListener('click', e => {
  const mode = e.target.closest('[data-mode]')?.dataset.mode;
  if (mode) { state.riskMode = mode; restyle(); drawLegend(); saveHash(); return; }
  if (e.target.closest('h4')) $('#legend').classList.toggle('mini');
});
if (innerWidth <= 760) $('#legend').classList.add('mini');

// ---------- layer switching ----------
async function setLayer(layer) {
  state.layer = layer;
  $$('.layers button').forEach(b => b.classList.toggle('on', b.dataset.layer === layer));
  if (layer === 'events') { drawEventMarkers(); eventLayer.addTo(map); } else eventLayer.remove();
  restyle(); drawLegend(); saveHash();
  if (layer === 'temp') loadHeat(); else drawHeat();
}

// ---------- panel ----------
// Pinch-zoom stays allowed. To return to the screen's own scale when a country is opened or closed, the viewport
// is capped at 100% for a moment (the browser zooms back out) and then released again.
const VIEWPORT = 'width=device-width, initial-scale=1';
function resetPageZoom() {
  if (innerWidth > 760) return;
  if (window.visualViewport && visualViewport.scale <= 1.01) return;   // not zoomed – nothing to do
  const meta = document.querySelector('meta[name=viewport]');
  meta.setAttribute('content', `${VIEWPORT}, maximum-scale=1`);
  setTimeout(() => meta.setAttribute('content', VIEWPORT), 400);
}
async function selectCountry(iso2, { zoom = false, point = null } = {}) {
  const f = state.features[iso2];
  if (!f) return;
  if (iso2 !== state.selected) state.panelReset = true;   // applied once the panel is visible (see renderPanel)
  state.selected = iso2;
  state.point = point || repPoint(iso2);
  pointMarker.remove();
  if (point?.clicked) pointMarker.setLatLng([point.lat, point.lon]).addTo(map);
  restyle();
  if (zoom) fitCountry(iso2);
  saveHash();
  renderPanel();
}

// Bounds of the country's main landmass plus nearby islands – overseas parts
// (French Guiana, Alaska, Svalbard…) would otherwise zoom out to half the world.
function mainBounds(iso2) {
  const g = state.features[iso2].geometry;
  if (g.type !== 'MultiPolygon') return L.geoJSON(g).getBounds();
  const parts = g.coordinates.map(c => L.geoJSON({ type: 'Polygon', coordinates: c }).getBounds());
  const size = b => (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth());
  const main = parts.reduce((a, b) => size(b) > size(a) ? b : a);
  // grow from the main part, chaining through islands up to 3° away (keeps archipelagos whole)
  const out = L.latLngBounds(main.getSouthWest(), main.getNorthEast());
  let left = parts.filter(b => b !== main), grew = true;
  while (grew) {
    grew = false;
    const near = out.pad(0).extend([out.getSouth() - 3, out.getWest() - 3]).extend([out.getNorth() + 3, out.getEast() + 3]);
    left = left.filter(b => near.contains(b.getCenter()) ? (out.extend(b), grew = true, false) : true);
  }
  return out;
}

function fitCountry(iso2) {
  const wide = innerWidth > 760;
  // fractional zoom just for this fit, so the country fills the screen instead of
  // rounding down to the next whole level (flyToBounds reads zoomSnap synchronously)
  const snap = map.options.zoomSnap;
  map.options.zoomSnap = 0.25;
  map.flyToBounds(mainBounds(iso2), {   // left: zoom buttons · right (desktop): the country panel · bottom: legend
    paddingTopLeft: [55, 15], paddingBottomRight: wide ? [400, 15] : [10, 45], maxZoom: 9, duration: 0.8 });
  map.options.zoomSnap = snap;
}

function riskCard(iso2) {
  const r = riskOf(iso2), w = nscFor(iso2), a = state.anti[iso2];
  const head = '<h3>🧭 מדד סיכון ליהודים וישראלים</h3>';
  if (!r) return `<section class="card">${head}<div class="empty">${iso2 === 'IL' ? 'לא רלוונטי' : 'אין נתונים למדינה זו'}</div></section>`;
  const nscTxt = !w ? 'אין אזהרה' : w.mixed ? `רמה ${w.min}–${w.level} · משולבת` : `רמה ${w.level} · ${NSC[w.level].label}`;
  const adlTxt = a ? `${ANTI[a.level].label} · ${ltr(ANTI[a.level].range)}` : 'לא נסקרה';
  return `<section class="card">${head}
    <div class="risk-head">
      <div class="risk-score" style="color:${darkText(r.color)}">${r.score}<small>/100</small></div>
      <span class="badge" style="background:${r.color}26;color:${darkText(r.color)}">● ${r.label}</span>
    </div>
    <div class="risk-bar"><span style="right:${Math.min(r.score, 99)}%"></span></div>
    <div class="risk-parts">
      <div><span>🚨 אזהרת מל״ל <small>(${W_NSC * 100}%)</small></span><b style="color:${w ? darkText(NSC[w.level].color) : 'inherit'}">${nscTxt}</b></div>
      <div><span>🛡️ עמדות אנטישמיות <small>(${W_ADL * 100}% · ADL 01/2025)</small></span><b style="color:${a ? darkText(ANTI[a.level].color) : 'inherit'}">${adlTxt}</b></div>
    </div>
    ${r.partial ? `<div class="warn">מבוסס רק על ${r.partial === 'nsc' ? 'אזהרת המל״ל (המדינה לא נכללה בסקר ADL)' : 'סקר ADL (אין אזהרת מל״ל)'}</div>` : ''}
    ${w?.inheritedFrom ? `<div class="warn">טריטוריה ללא אזהרה נפרדת – לפי אזהרת המל״ל ל${esc(nameHe(w.inheritedFrom, w.inheritedFrom))}</div>` : ''}
    <details class="how"><summary>איך מחושב המדד?</summary>
      60% אזהרת המסע העדכנית של המל״ל ו־40% שיעור העמדות האנטישמיות לפי ADL.
      אזהרה משולבת נחשבת כרמה הנמוכה בתוספת 30% מהפער לרמה הגבוהה.
      אזהרת רמה 4 לכל המדינה מעלה את המדד ל־80 לפחות, ורמה 3 ל־60 לפחות.
    </details>
  </section>`;
}

function nscNote(iso2) {
  const w = nscFor(iso2);
  if (!w) return '';
  return `<aside class="note">
    <div class="note-title">📢 הערת המל״ל</div>
    <p class="details">${esc(w.details || NSC[w.level].advice)}</p>
    ${(w.regions || []).map(r => `<p class="details"><b>${esc(r.region)}:</b> ${esc(r.details)}</p>`).join('')}
    <div class="meta">עודכן ${dmyTime(state.nscMeta.updated)}${w.url ? ` · <a href="${esc(w.url)}" target="_blank" rel="noopener">לאזהרה המלאה ב־gov.il</a>` : ''}</div>
  </aside>`;
}

// ---------- practical info ----------
const VISA = {
  'visa free': ['פטור מוויזה', '#2e9e5b'], 'visa on arrival': ['ויזה בהגעה', '#8bb53c'], 'eta': ['אישור נסיעה אלקטרוני מראש (ETA / ESTA)', '#d9a400'],
  'e-visa': ['ויזה אלקטרונית מראש', '#f2994a'], 'visa required': ['נדרשת ויזה מראש בנציגות', '#e0592a'], 'no admission': ['כניסה אסורה לבעלי דרכון ישראלי', '#b3261e'],
};
const visaOk = v => v && ['visa free', 'visa on arrival', 'eta'].includes(v.type);
const ISRAELI_PLUG_FITS = ['C', 'E', 'F', 'H', 'J', 'K', 'L', 'N'];   // sockets that take a type C (Europlug) / H plug

function visaItem(iso2) {
  const v = state.practical[iso2]?.visa;
  if (iso2 === 'IL') return '';
  const [label, color] = v ? VISA[v.type] || [v.type, '#6b7385'] : ['אין מידע', '#6b7385'];
  return `<div class="pr-item"><h4>🛂 ויזה לדרכון ישראלי</h4>
    <span class="badge" style="background:${color}22;color:${darkText(color)}">● ${label}${v?.days ? ` · עד ${v.days} יום` : ''}</span>
    <div class="meta">Passport Index · יש לאמת מול נציגות המדינה לפני הטיסה</div></div>`;
}
function communityItem(iso2) {
  return `<div class="pr-item"><h4>🕍 קהילה יהודית</h4><div class="pr-line">בתי כנסת, בתי חב״ד ומסעדות כשרות לפי OpenStreetMap</div>
    <button class="linkbtn" data-act="jewish">הצג על המפה ←</button></div>`;
}
function emergencyItem(iso2) {
  const p = state.practical[iso2] || {};
  const nums = (p.emergency || []).map(n => `<a class="chip" href="tel:${n}" dir="ltr">${n}</a>`).join('');
  const missions = (p.missions || []).map(m => `<li>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}</a>` : esc(m.name)}${m.addr ? ` <small>${esc(m.addr)}</small>` : ''}</li>`).join('');
  return `<div class="pr-item"><h4>🆘 חירום ונציגות ישראל</h4>
    ${nums ? `<div class="pr-line">מספרי חירום מקומיים: ${nums}</div>` : '<div class="pr-line">אין מידע על מספרי חירום</div>'}
    ${missions ? `<ul class="list compact">${missions}</ul>` : ''}
    ${missionLink(iso2, p.mfaName)}</div>`;
}
// Foreign Ministry mission finder; it accepts the country as a URL filter, using its own spelling (mfaName)
const MFA_FINDER = 'https://www.gov.il/he/Departments/dynamiccollectors/israeli-consular-services';
function missionLink(iso2, mfaName) {
  return mfaName
    ? `<a class="linkbtn" href="${MFA_FINDER}?skip=0&shem_mdn=${encodeURIComponent(mfaName)}" target="_blank" rel="noopener">נציגות ישראל ב${esc(nameHe(iso2, iso2))} (משרד החוץ) ←</a>`
    : `<a class="linkbtn" href="${MFA_FINDER}" target="_blank" rel="noopener">חיפוש נציגויות ישראל בעולם (משרד החוץ) ←</a>`;
}

function powerItem(iso2) {
  const p = state.practical[iso2] || {};
  if (!p.plugs && !p.voltage && !p.drives) return '';
  const fits = p.plugs?.some(t => ISRAELI_PLUG_FITS.includes(t));
  return `<div class="pr-item"><h4>🔌 חשמל ונהיגה</h4>
    ${p.plugs ? `<div class="pr-line">שקעים: <b dir="ltr">${p.plugs.join(', ')}</b>${p.voltage ? ` · ${p.voltage}V` : ''}</div>
      <div class="pr-line">${fits ? '✅ תקע ישראלי / אירופי (C) נכנס' : '⚠️ צריך מתאם לתקע ישראלי'}${p.voltage && p.voltage < 150 ? ' · מתח נמוך: בדקו שהמכשיר תומך ב־110V' : ''}</div>` : ''}
    ${p.drives ? `<div class="pr-line">${p.drives === 'left' ? '🚗 <b>נוהגים בצד שמאל</b> – בניגוד לישראל' : '🚗 נוהגים בצד ימין, כמו בישראל'}</div>` : ''}
    <div class="meta">Wikidata</div></div>`;
}
function practicalSection(iso2) {
  return `<details class="card practical" ${state.practicalOpen ? 'open' : ''}>
    <summary><h3>🧳 מידע מעשי</h3></summary>
    <div class="pr-grid">
      <div class="pr-item" id="prShabbat"><h4>🕯️ שבת וחגים</h4><div class="spinner">טוען…</div></div>
      ${visaItem(iso2)}
      ${communityItem(iso2)}
      <div class="pr-item" id="prMoney"><h4>💱 מטבע</h4><div class="spinner">טוען…</div></div>
      ${emergencyItem(iso2)}
      <div class="pr-item" id="prDaylight"><h4>🌅 שעות אור</h4><div class="spinner">טוען…</div></div>
      ${powerItem(iso2)}
    </div>
  </details>`;
}
async function fillMoney(iso2, token) {
  const el = () => token === panelToken && $('#prMoney');
  const codes = Object.keys(state.info[iso2]?.currencies || {}).filter(c => c !== 'ILS');
  if (!codes.length) { if (el()) $('#prMoney').innerHTML = '<h4>💱 מטבע</h4><div class="pr-line">שקל חדש (₪)</div>'; return; }
  try {
    const r = await getJSON('https://open.er-api.com/v6/latest/ILS');
    if (!el()) return;
    const fmt = n => n >= 100 ? Math.round(n).toLocaleString('he-IL') : n.toLocaleString('he-IL', { maximumFractionDigits: n < 1 ? 3 : 2 });
    const lines = codes.filter(c => r.rates?.[c]).map(c => `<div class="pr-line"><b dir="ltr">100 ₪ ≈ ${fmt(100 * r.rates[c])} ${c}</b> · <span dir="ltr">1 ${c} ≈ ${fmt(1 / r.rates[c])} ₪</span></div>`);
    $('#prMoney').innerHTML = `<h4>💱 מטבע</h4>${lines.join('') || '<div class="pr-line">אין שער למטבע זה</div>'}
      <div class="meta">שער יומי · <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">ExchangeRate-API</a></div>`;
  } catch { if (el()) $('#prMoney').querySelector('.spinner').textContent = 'לא הצלחנו לטעון שער מטבע'; }
}
function fillDaylight(days, label, token) {
  if (token !== panelToken || !$('#prDaylight')) return;
  const withSun = days.filter(d => d.sunrise && d.sunset);
  const t = s => s.slice(11, 16), hrs = sec => `${Math.floor(sec / 3600)}:${String(Math.round(sec % 3600 / 60)).padStart(2, '0')}`;
  const line = d => `<div class="pr-line">${dayLabel(d.date)}: <b dir="ltr">${t(d.sunrise)}–${t(d.sunset)}</b>${d.daylight ? ` · ${hrs(d.daylight)} שעות אור` : ''}</div>`;
  $('#prDaylight').innerHTML = `<h4>🌅 שעות אור${label ? ` · ${esc(label)}` : ''}</h4>
    ${withSun.length ? line(withSun[0]) + (withSun.length > 1 ? line(withSun[withSun.length - 1]) : '') : '<div class="pr-line">אין נתונים</div>'}
    <div class="meta">זריחה ושקיעה בשעון המקומי</div>`;
}
async function fillShabbat(pt, tz, token) {
  const el = () => token === panelToken && $('#prShabbat');
  if (!pt || !tz) { if (el()) $('#prShabbat').querySelector('.spinner').textContent = 'אין נתונים'; return; }
  try {
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&s=on&c=on&M=on&lg=he&geo=pos&latitude=${pt.lat.toFixed(3)}&longitude=${pt.lon.toFixed(3)}&tzid=${encodeURIComponent(tz)}&start=${state.from}&end=${state.to}`;
    const r = await getJSON(url);
    if (!el()) return;
    const items = r.items || [];
    const time = i => i.date.slice(11, 16), day = i => i.date.slice(0, 10);
    // candle lighting = entry, havdalah = exit; pair each entry with the next exit
    const entries = items.filter(i => i.category === 'candles'), exits = items.filter(i => i.category === 'havdalah');
    const used = new Set(), rows = [];
    for (const c of entries) {
      const h = exits.find(x => !used.has(x) && x.date > c.date);
      if (h) used.add(h);
      rows.push({ start: c, end: h });
    }
    for (const h of exits) if (!used.has(h)) rows.push({ start: null, end: h });
    rows.sort((a, b) => (a.start || a.end).date.localeCompare((b.start || b.end).date));
    const rowHtml = ({ start, end }) => {
      const ref = start || end, shabbat = start ? parse(day(start)).getDay() === 5 : parse(day(end)).getDay() === 6;
      const parasha = shabbat && end ? items.find(i => i.category === 'parashat' && day(i) === day(end)) : null;
      const title = shabbat ? `שבת${parasha ? ` · ${esc(parasha.hebrew || parasha.title)}` : ''}`
        : esc(holidayBase(items.find(i => i.category === 'holiday' && day(i) >= day(ref))?.hebrew || 'חג'));
      return `<li><b>${title}</b>
        <div class="sh-times">${start ? `<span>כניסה <b dir="ltr">${time(start)}</b> <small>${dayLabel(day(start))}</small></span>` : ''}
        ${end ? `<span>יציאה <b dir="ltr">${time(end)}</b> <small>${dayLabel(day(end))}</small></span>` : ''}</div></li>`;
    };
    const hol = mergeHolidays(items.filter(i => i.category === 'holiday').map(i => ({ date: day(i), localName: i.hebrew || i.title, name: '' })));
    $('#prShabbat').innerHTML = `<h4>🕯️ שבת וחגים${pt.label ? ` · ${esc(pt.label)}` : ''}</h4>
      ${rows.length ? `<ul class="list compact">${rows.map(rowHtml).join('')}</ul>` : '<div class="pr-line">אין שבת בתאריכים שנבחרו</div>'}
      ${hol.length ? `<div class="pr-line">✡ ${hol.map(h => `${esc(h.localName)} <small>${h.end !== h.date ? `${dmy(h.date)}–${dmy(h.end)}` : dmy(h.date)}</small>`).join(' · ')}</div>` : ''}
      <div class="meta">כניסה: 18 דק׳ לפני השקיעה · יציאה: צאת הכוכבים · לפי <a href="https://www.hebcal.com" target="_blank" rel="noopener">Hebcal</a></div>`;
  } catch { if (el()) $('#prShabbat').querySelector('.spinner').textContent = 'לא הצלחנו לטעון זמני שבת'; }
}

// ---------- share / PDF ----------
async function shareCountry(iso2) {
  const name = nameHe(iso2, iso2), url = location.href;
  const text = `${name} · ${dmy(state.from)}–${dmy(state.to)} · מפת מטיילים`;
  if (navigator.share) {
    try { await navigator.share({ title: `מפת מטיילים – ${name}`, text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('הדפדפן לא תומך בשיתוף ישיר – הקישור הועתק'); }
  catch { prompt('העתיקו את הקישור:', url); }
}
// The browser's own "Save as PDF" keeps real text (selectable, searchable) and handles Hebrew/RTL correctly,
// unlike canvas-based PDF libraries.
async function exportPdf(iso2) {
  for (let i = 0; i < 25 && $('#panelBody .spinner'); i++) await new Promise(r => setTimeout(r, 300));   // let async sections finish
  document.querySelector('.print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.dir = 'rtl';
  sheet.innerHTML = `<div class="pdf-head"><div class="pdf-brand">🌍 מפת מטיילים</div>
      <div class="pdf-meta">${dmy(state.from)} – ${dmy(state.to)} · הופק ב־${dmy(today())}</div></div>
    ${$('#panelBody').innerHTML}
    <div class="pdf-foot" dir="ltr">${esc(location.href)}</div>`;
  sheet.querySelectorAll('.p-actions, button, details.how').forEach(n => n.remove());
  sheet.querySelectorAll('details').forEach(d => { d.open = true; });
  document.body.appendChild(sheet);
  const title = document.title;
  document.title = `${nameHe(iso2, iso2)} ${dmy(state.from)} – מפת מטיילים`;   // default PDF file name
  const done = () => { document.title = title; sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  toast('בחלון ההדפסה בחרו "שמירה כ־PDF"', 5000);
  setTimeout(() => window.print(), 50);
}

function factsCard(iso2) {
  const i = state.info[iso2];
  if (!i) return `<section class="card"><h3>ℹ️ פרטים כלליים</h3><div class="empty">אין נתונים</div></section>`;
  const langNames = new Intl.DisplayNames(['he'], { type: 'language' });
  const langs = Object.entries(i.languages || {}).map(([code, en]) => { try { const n = langNames.of(code); return n && n !== code ? n : en; } catch { return en; } });
  const cur = Object.entries(i.currencies || {}).map(([code, c]) => `${c.name} (${c.symbol || code})`);
  return `<section class="card"><h3>ℹ️ פרטים כלליים</h3><dl class="facts">
    ${i.capital?.length ? `<dt>בירה</dt><dd>${esc(i.capital.join(', '))}</dd>` : ''}
    ${i.pop ? `<dt>אוכלוסייה</dt><dd>${fmtNum.format(i.pop)} <small style="color:#6b7385">(${i.popYear})</small></dd>` : ''}
    ${langs.length ? `<dt>שפות</dt><dd>${esc(langs.join(', '))}</dd>` : ''}
    ${cur.length ? `<dt>מטבע</dt><dd>${esc(cur.join(', '))}</dd>` : ''}
    ${i.region ? `<dt>אזור</dt><dd>${esc(i.region)}</dd>` : ''}
    <dt>שעה מקומית</dt><dd id="localTime">–</dd>
  </dl></section>`;
}

function eventsCard(iso2) {
  const ev = eventsInRange(iso2);
  return `<section class="card"><h3>🎉 אירועים עונתיים</h3>${ev.length ? `<ul class="list">${ev.map(e =>
    `<li>${CAT_ICON[e.cat] || ''} ${esc(e.name)} <small>${CAT_NAME[e.cat] || ''} · ${esc(e.city)} · ${dmy(e.start)} – ${dmy(e.end)}${e.approx ? ' (תאריך משוער)' : ''}</small></li>`).join('')}</ul>`
    : '<div class="empty">אין אירועים במאגר בתאריכים אלה</div>'}
    <div class="meta">מאגר אירועים מקומי (data/events.json) · תאריכים משוערים יש לאמת באתר האירוע</div></section>`;
}

let panelToken = 0;
// ---------- trip: flights (Skyscanner) & hotels (Booking) to a city ----------
// Affiliate IDs go here once approved; with them empty the links are plain links.
const AFFILIATE = {
  bookingAid: '',     // Booking.com affiliate id (aid)
  skyscannerWrap: '', // tracking-link template from Skyscanner's partner programme, with {url} for the target
};
const yymmdd = d => d.slice(2).replace(/-/g, '');
// the country's biggest cities, plus the searched/clicked one; picks the destination
function tripCities(iso2) {
  const list = state.cities.filter(c => c[2] === iso2).slice(0, 8);
  const near = (lat, lon, km) => {
    let best = null, bestKm = km;
    for (const c of state.cities) {
      if (c[2] !== iso2 || Math.abs(c[3] - lat) > 1 || Math.abs(c[4] - lon) > 1.5) continue;
      const d = kmBetween({ lat, lon }, { lat: c[3], lon: c[4] });
      if (d < bestKm) { bestKm = d; best = c; }
    }
    return best;
  };
  const pt = state.point, cap = state.info[iso2]?.cap;
  let dest = state.trip?.iso2 === iso2 && state.trip.point === pt ? state.trip.city : null;
  dest ||= (pt && pt.label !== 'מרכז המדינה' && near(pt.lat, pt.lon, 60)) || (cap && near(cap[0], cap[1], 40)) || list[0];
  if (dest && !list.includes(dest)) list.unshift(dest);
  return { list, dest };
}
// the main airport of cities with several (or a small one closer than the main one)
const MAIN_AIRPORT = {
  Paris: 'CDG', Rome: 'FCO', 'Vatican City': 'FCO', Milan: 'MXP', Bangkok: 'BKK', Nicosia: 'LCA', 'New York City': 'JFK',
  Istanbul: 'IST', Moscow: 'SVO', Washington: 'IAD', Chicago: 'ORD', Stockholm: 'ARN', 'São Paulo': 'GRU',
  'Buenos Aires': 'EZE', 'Rio de Janeiro': 'GIG', 'Andorra la Vella': 'BCN', Seoul: 'ICN', Shanghai: 'PVG',
  Beijing: 'PEK', Osaka: 'KIX', Tokyo: 'NRT', Toronto: 'YYZ', Montreal: 'YUL', Dubai: 'DXB', Bucharest: 'OTP',
  Taipei: 'TPE', Jakarta: 'CGK', 'Kuala Lumpur': 'KUL', Houston: 'IAH', Bern: 'ZRH', Vaduz: 'ZRH',
  Pretoria: 'JNB', 'San Marino': 'BLQ',
};
const SKIP_AIRPORTS = new Set(['ECN']);   // Ercan, northern Cyprus – not reachable on a normal itinerary from Israel
// nearest airport with scheduled flights within 150 km (a large one unless a medium one is much closer),
// else the country's nearest airport at any distance
function nearestAirport(lat, lon, iso2) {
  let best = null, bestScore = Infinity, inCountry = null, inCountryKm = Infinity;
  for (const [iata, alat, alon, size, cc] of state.airports) {
    if (SKIP_AIRPORTS.has(iata) || (cc !== iso2 && (Math.abs(alat - lat) > 2 || Math.abs(alon - lon) > 3))) continue;
    const km = kmBetween({ lat, lon }, { lat: alat, lon: alon });
    const score = size === 2 ? km : km + 60;
    if (km <= 150 && score < bestScore) { bestScore = score; best = iata; }
    if (cc === iso2 && km < inCountryKm) { inCountryKm = km; inCountry = iata; }
  }
  return best || inCountry;
}
function tripLinks(iso2, city) {
  const from = state.from, to = state.to > state.from ? state.to : addDays(state.from, 1);
  const iata = city && (MAIN_AIRPORT[city[1]] || (state.airports && nearestAirport(city[3], city[4], iso2)));
  let flights = `https://www.skyscanner.co.il/transport/flights/tlv/${(iata || iso2).toLowerCase()}/${yymmdd(from)}/${yymmdd(state.to)}/`;
  if (AFFILIATE.skyscannerWrap) flights = AFFILIATE.skyscannerWrap.replace('{url}', encodeURIComponent(flights));
  const q = new URLSearchParams({ ss: city ? `${city[1]}, ${state.features[iso2].properties.en}` : state.features[iso2].properties.en,
    checkin: from, checkout: to, group_adults: 2, no_rooms: 1, group_children: 0 });
  if (AFFILIATE.bookingAid) q.set('aid', AFFILIATE.bookingAid);
  return { flights, hotels: `https://www.booking.com/searchresults.he.html?${q}`, iata };
}
function tripRow(iso2) {
  if (iso2 === 'IL' || !state.cities.length) return '';
  const { list, dest } = tripCities(iso2);
  state.trip = { iso2, point: state.point, city: dest, list };
  const l = tripLinks(iso2, dest);
  return `<div class="trip">
    <label>📍 חופשה ב־<select id="tripCity" aria-label="עיר יעד">${list.map((c, i) =>
      `<option value="${i}"${c === dest ? ' selected' : ''}>${esc(c[0])}</option>`).join('')}</select></label>
    <a id="tripFlights" href="${esc(l.flights)}" target="_blank" rel="noopener sponsored">✈️ טיסות</a>
    <a id="tripHotels" href="${esc(l.hotels)}" target="_blank" rel="noopener sponsored">🏨 מלונות</a>
    ${AFFILIATE.bookingAid || AFFILIATE.skyscannerWrap ? '<div class="meta">קישורי שותפים: ייתכן שנקבל עמלה, בלי עלות נוספת לכם</div>' : ''}
  </div>`;
}
// cities and airports load after the first paint: fill in a panel that is already open
function refreshTrip() {
  const iso2 = state.selected;
  if (!iso2 || $('#panel').hidden) return;
  if (!$('#tripCity')) return $('#panelBody .p-actions')?.insertAdjacentHTML('afterend', tripRow(iso2));
  const l = tripLinks(iso2, state.trip.city);
  $('#tripFlights').href = l.flights; $('#tripHotels').href = l.hotels;
}
$('#panelBody').addEventListener('change', e => {
  if (e.target.id !== 'tripCity' || !state.trip) return;
  state.trip.city = state.trip.list[+e.target.value];
  const l = tripLinks(state.trip.iso2, state.trip.city);
  $('#tripFlights').href = l.flights; $('#tripHotels').href = l.hotels;
});

async function renderPanel() {
  const iso2 = state.selected; if (!iso2) return;
  const token = ++panelToken;
  const p = state.features[iso2].properties;
  const i = state.info[iso2];
  const pt = state.point;
  $('#panel').hidden = false;
  if (state.panelReset) {
    // a newly opened country starts at the top and at the screen's own zoom; this must run after the panel is
    // shown, because a hidden element ignores scrollTop
    state.panelReset = false;
    resetPageZoom();
    const toTop = () => { $('#panel').scrollTop = 0; window.scrollTo(0, 0); };
    toTop();                          // the panel is displayed now, so this takes effect…
    requestAnimationFrame(toTop);     // …and again after the new content is laid out
  }
  $('#panelBody').innerHTML = `
    <div class="p-head">
      <img src="https://flagcdn.com/w160/${iso2.toLowerCase()}.png" alt="" onerror="this.remove()">
      <div><h2>${esc(nameHe(iso2, p.he || p.en))}</h2><div class="en">${esc(p.en)}</div></div>
    </div>
    <div class="p-actions">
      <button data-act="zoom">🔍 התקרבו למדינה</button>
      <button data-act="share">📤 שיתוף</button>
      <button data-act="pdf">📄 הורדה כ־PDF</button>
    </div>
    ${tripRow(iso2)}
    ${riskCard(iso2)}
    ${nscNote(iso2)}
    <div class="daterange">📆 ${dmy(state.from)} – ${dmy(state.to)}</div>
    <section class="card" id="holCard"><h3>📅 חגים רשמיים</h3><div class="spinner">טוען…</div></section>
    ${eventsCard(iso2)}
    ${practicalSection(iso2)}
    ${factsCard(iso2)}
    <section class="card" id="wxCard"><h3>🌤️ מזג אוויר${pt?.label ? ` · ${esc(pt.label)}` : ''}</h3><div class="spinner">טוען…</div></section>`;

  // weather
  fillMoney(iso2, token);
  $('#panelBody .practical')?.addEventListener('toggle', e => { state.practicalOpen = e.target.open; });
  if (!pt) { fillShabbat(null, null, token); fillDaylight([], '', token); }
  if (pt) countryWeather(pt).then(({ plan, tz, days }) => {
    if (token !== panelToken) return;
    fillShabbat(pt, tz, token);
    fillDaylight(days, pt.label, token);
    if (tz && $('#localTime')) try { $('#localTime').textContent = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); } catch {}
    const hi = avg(days.map(d => d.hi)), lo = avg(days.map(d => d.lo));
    const rainy = days.filter(d => d.rain >= 1).length;
    const note = plan.kind === 'estimate' ? 'הערכה: ממוצע של אותם תאריכים ב־3 השנים האחרונות (מעבר לטווח התחזית של 16 יום)'
      : plan.kind === 'actual' ? 'נתונים היסטוריים בפועל' : 'תחזית';
    $('#wxCard').innerHTML = `<h3>🌤️ מזג אוויר${pt.label ? ` · ${esc(pt.label)}` : ''}</h3>
      <div class="wxsum"><span>מקס׳ <b class="hi">${Math.round(hi)}°</b></span><span>מינ׳ <b class="lo">${Math.round(lo)}°</b></span><span>ימי גשם <b>${rainy}</b>/${days.length}</span></div>
      <div id="citiesWx"></div>
      <table class="wx"><tr><th>יום</th><th></th><th>מקס׳</th><th>מינ׳</th><th>משקעים</th></tr>
      ${days.map(d => { const [ic, t] = WX(d.code); return `<tr><td>${dayLabel(d.date)}</td><td title="${t}">${ic}</td>
        <td class="hi">${d.hi == null ? '–' : Math.round(d.hi) + '°'}</td><td class="lo">${d.lo == null ? '–' : Math.round(d.lo) + '°'}</td>
        <td>${d.rain == null ? '–' : d.rain.toFixed(1) + ' מ״מ'}</td></tr>`; }).join('')}</table>
      <div class="meta">${note} · Open-Meteo</div>`;
    loadCitiesWx(iso2, token);
  }).catch(e => { console.error(e); if (token === panelToken) $('#wxCard').querySelector('.spinner').textContent = 'לא הצלחנו לטעון מזג אוויר'; });

  // holidays
  holidays(iso2).then(list => {
    if (token !== panelToken) return;
    const body = list == null ? '<div class="empty">אין נתוני חגים למדינה זו במקור</div>'
      : list.length ? `<ul class="list">${list.map(h => {
        const when = h.end && h.end !== h.date ? `${dmy(h.date)} – ${dmy(h.end)}` : dmy(h.date);
        return `<li>${esc(h.localName)}${h.localName !== h.name ? ` <small>${esc(h.name)} · ${when}</small>` : ` <small>${when}</small>`}</li>`;
      }).join('')}</ul>`
      : '<div class="empty">אין חגים רשמיים בתאריכים אלה</div>';
    $('#holCard').innerHTML = `<h3>📅 חגים רשמיים</h3>${body}<div class="meta">${iso2 === 'IL' ? 'Hebcal' : 'Nager.Date'}</div>`;
  });
}

$('#panelBody').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'zoom') {
    // phone: the panel covers the whole map – close it first so the zoom is visible
    const iso2 = state.selected;
    if (innerWidth <= 760) closePanel();
    fitCountry(iso2);
  }
  if (act === 'jewish') showJewishFor(state.selected);
  if (act === 'share') shareCountry(state.selected);
  if (act === 'pdf') exportPdf(state.selected);
});
function closePanel() {
  $('#panel').hidden = true; state.selected = null; pointMarker.remove(); restyle(); saveHash();
  resetPageZoom();
}
$('#close').addEventListener('click', closePanel);

// ---------- search ----------
// While typing: countries (local) + Photon (built for search-as-you-type).
// On Enter: Nominatim as a broader second pass (its policy forbids autocomplete).
const q = $('#q'), results = $('#results');
let searchMarker, typeTimer, searchSeq = 0;
const wordStart = (s, t) => { s = s.toLowerCase(); return s.startsWith(t) || s.includes(' ' + t) || s.includes('-' + t); };
function localMatches(text) {
  // countries whose name starts with the text, then big cities, then countries that merely contain it
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const all = Object.entries(state.features)
    .map(([c, f]) => ({ c, he: nameHe(c, f.properties.he || f.properties.en), en: f.properties.en }))
    .filter(x => x.he.toLowerCase().includes(t) || x.en.toLowerCase().includes(t) || x.c.toLowerCase() === t)
    .map(x => ({ icon: '🏳️', title: x.he, sub: x.en, iso2: x.c, country: true, strong: wordStart(x.he, t) || wordStart(x.en, t) || x.c.toLowerCase() === t }));
  return [...all.filter(x => x.strong).slice(0, 4), ...cityMatches(t), ...all.filter(x => !x.strong).slice(0, 2)];
}
function cityMatches(text) {
  const t = text.trim().toLowerCase();
  if (t.length < 2) return [];
  // state.cities is sorted by population, so the first hits are the biggest cities
  return state.cities.filter(c => wordStart(c[0], t) || wordStart(c[1], t)).slice(0, 5).map(([he, en, iso2, lat, lon]) => ({
    icon: '🏙️', title: he, sub: `${en} · ${nameHe(iso2, iso2)}`, lat, lon, zoom: 11, iso2,
  }));
}
const fromPhoton = f => {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const sub = [p.street && `${p.street} ${p.housenumber || ''}`.trim(), p.city || p.county, p.state, p.country].filter((x, i, a) => x && x !== p.name && a.indexOf(x) === i).join(', ');
  return { icon: p.type === 'country' ? '🏳️' : p.type === 'city' ? '🏙️' : '📍', title: p.name || sub, sub, lat, lon,
    bounds: p.extent ? [[p.extent[3], p.extent[0]], [p.extent[1], p.extent[2]]] : null,
    iso2: p.countrycode?.toUpperCase(), country: p.type === 'country' };
};
const fromNominatim = r => ({
  icon: r.addresstype === 'country' ? '🏳️' : '📍', title: r.name || r.display_name.split(',')[0], sub: r.display_name,
  lat: +r.lat, lon: +r.lon, bounds: [[+r.boundingbox[0], +r.boundingbox[2]], [+r.boundingbox[1], +r.boundingbox[3]]],
  iso2: r.address?.country_code?.toUpperCase(), country: r.addresstype === 'country',
});
function merge(local, remote) {
  // drop remote countries that duplicate a local match, and exact duplicates
  const seen = new Set();
  return [...local, ...remote.filter(r => !(r.country && local.some(l => l.iso2 === r.iso2)))]
    .filter(r => { const k = r.title + '|' + r.sub; if (seen.has(k)) return false; seen.add(k); return true; });
}
function showResults(items) {
  results.innerHTML = items.map((it, i) => it.hint ? `<li class="hint">${it.hint}</li>`
    : `<li data-i="${i}">${it.icon} <span>${esc(it.title)}</span> <small>${esc(it.sub || '')}</small></li>`).join('');
  results.hidden = !items.length;
  results._items = items;
}
q.addEventListener('input', () => {
  if (!$('#panel').hidden) closePanel();   // a new search replaces the open country
  const text = q.value.trim(), local = localMatches(text), seq = ++searchSeq;
  clearTimeout(typeTimer);
  if (text.length < 3) return showResults(local);
  showResults([...local, { hint: 'מחפש כתובות…' }]);
  typeTimer = setTimeout(async () => {
    try {
      const res = await getJSON(`https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(text)}`);
      if (seq !== searchSeq) return;
      const items = merge(local, (res?.features || []).map(fromPhoton));
      showResults([...items, { hint: 'לא מצאתם? לחצו Enter לחיפוש מורחב' }]);
    } catch (e) { if (seq === searchSeq) showResults([...local, { hint: 'לחצו Enter לחיפוש כתובת' }]); }
  }, 350);
});
q.addEventListener('keydown', e => {
  const lis = [...results.querySelectorAll('li[data-i]')], cur = results.querySelector('li.active');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!lis.length) return;
    const i = lis.indexOf(cur), n = e.key === 'ArrowDown' ? (i + 1) % lis.length : (i - 1 + lis.length) % lis.length;
    cur?.classList.remove('active'); lis[n].classList.add('active'); lis[n].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') { e.preventDefault(); cur ? pick(results._items[+cur.dataset.i]) : geocode(q.value); }
  if (e.key === 'Escape') results.hidden = true;
});
q.addEventListener('focus', () => { if (results.children.length) results.hidden = false; });
$('#qbtn').addEventListener('click', () => geocode(q.value));
document.addEventListener('click', e => { if (!e.target.closest('.search')) results.hidden = true; });
results.addEventListener('click', e => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  pick(results._items[+li.dataset.i]);
});

async function geocode(text) {
  text = text.trim(); if (!text) return;
  clearTimeout(typeTimer);
  const local = localMatches(text), seq = ++searchSeq;
  showResults([...local, { hint: 'מחפש…' }]);
  try {
    const res = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=he&q=${encodeURIComponent(text)}`);
    if (seq !== searchSeq) return;
    const items = merge(local, (res || []).map(fromNominatim));
    if (items.length === 1) return pick(items[0]);
    showResults(items.length ? items : [{ hint: 'לא נמצאו תוצאות' }]);
  } catch (e) {
    console.error(e);
    showResults([...local, { hint: 'החיפוש נכשל' }]);
  }
}

function pick(it) {
  results.hidden = true;
  searchMarker?.remove();
  q.value = it.title;
  if (it.country) {
    if (state.features[it.iso2]) return selectCountry(it.iso2, { zoom: true });
    if (it.bounds) return map.flyToBounds(it.bounds, { maxZoom: 6 });
    return;
  }
  if (it.bounds) map.flyToBounds(it.bounds, { maxZoom: 16, duration: 1 });
  else map.flyTo([it.lat, it.lon], it.zoom || 15, { duration: 1 });
  searchMarker = L.marker([it.lat, it.lon]).addTo(map).bindPopup(`<b>${esc(it.title)}</b><br><small>${esc(it.sub)}</small>`).openPopup();
  if (state.features[it.iso2]) selectCountry(it.iso2, { point: { lat: it.lat, lon: it.lon, label: it.title } });
}

// ---------- dates ----------
function setDates(from, to, { silent = false } = {}) {
  if (to < from) to = from;
  if (daysBetween(from, to) > MAX_DAYS - 1) { to = addDays(from, MAX_DAYS - 1); if (!silent) toast(`טווח מקסימלי: ${MAX_DAYS} ימים`); }
  state.from = from; state.to = to;
  fp.setDate([parse(from), parse(to)], false);
}
async function datesChanged() {
  if (state.layer === 'temp') loadHeat();
  if (state.layer === 'events') drawEventMarkers();
  restyle(); drawLegend(); saveHash();
  runFinder();
  if (state.selected) renderPanel();
}
// one range picker, shown and typed as dd/mm/yyyy
const fp = flatpickr('#range', {
  mode: 'range', dateFormat: innerWidth > 760 ? 'd/m/Y' : 'd/m/y', allowInput: innerWidth > 760, disableMobile: true,
  static: true, // avoids flatpickr reading cross-origin stylesheets when positioning the popup
  showMonths: innerWidth > 760 ? 2 : 1, monthSelectorType: 'static',
  locale: { ...flatpickr.l10ns.he, rangeSeparator: ' – ' },
  onReady: (_, __, inst) => setupMonthPicker(inst),
  onClose: sel => {
    if (sel.length === 2) { setDates(iso(sel[0]), iso(sel[1])); datesChanged(); }
    else setDates(state.from, state.to, { silent: true });
  },
});
// Clicking a month title opens a month grid with a year switcher (replaces flatpickr's dropdown + number input)
function setupMonthPicker(inst) {
  const cal = inst.calendarContainer;
  const names = [...Array(12)].map((_, m) => new Intl.DateTimeFormat('he-IL', { month: 'long' }).format(new Date(2026, m, 1)));
  const panel = document.createElement('div');
  panel.className = 'mp-panel';
  cal.appendChild(panel);
  let year;
  const draw = () => {
    panel.innerHTML = `<div class="mp-year"><button data-y="-1" aria-label="שנה קודמת">›</button><b>${year}</b><button data-y="1" aria-label="שנה הבאה">‹</button></div>
      <div class="mp-grid">${names.map((n, m) => `<button data-m="${m}" class="${m === inst.currentMonth && year === inst.currentYear ? 'cur' : ''}${m === new Date().getMonth() && year === new Date().getFullYear() ? ' today' : ''}">${n}</button>`).join('')}</div>
      <button class="mp-today">היום</button>`;
  };
  const open = () => { year = inst.currentYear; draw(); panel.classList.add('open'); };
  cal.querySelectorAll('.flatpickr-current-month').forEach(el => {
    el.setAttribute('role', 'button'); el.title = 'בחירת חודש ושנה';
    el.addEventListener('click', e => { e.preventDefault(); open(); });
  });
  panel.addEventListener('click', e => {
    e.stopPropagation();
    const y = e.target.closest('[data-y]'), m = e.target.closest('[data-m]');
    if (y) { year += +y.dataset.y; draw(); }
    if (m) { inst.jumpToDate(new Date(year, +m.dataset.m, 1)); panel.classList.remove('open'); }
    if (e.target.closest('.mp-today')) { inst.jumpToDate(new Date()); panel.classList.remove('open'); }
  });
  inst.config.onClose.push(() => panel.classList.remove('open'));
}
$$('.presets button').forEach(b => b.addEventListener('click', () => {
  const t = new Date();
  if (b.dataset.preset === 'week') setDates(today(), addDays(today(), 6));
  if (b.dataset.preset === 'nextmonth') {
    const s = new Date(t.getFullYear(), t.getMonth() + 1, 1), e = new Date(t.getFullYear(), t.getMonth() + 2, 0);
    setDates(iso(s), iso(e));
  }
  if (b.dataset.preset === 'december') {
    const y = t.getMonth() === 11 && t.getDate() > 24 ? t.getFullYear() + 1 : t.getFullYear();
    setDates(`${y}-12-01`, `${y}-12-31`);
  }
  datesChanged();
}));
$$('.layers button').forEach(b => b.addEventListener('click', () => setLayer(b.dataset.layer)));

// ---------- map buttons ----------
$('#home').addEventListener('click', () => map.flyTo([30, 15], 2.5));
$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('הדפדפן לא תומך באיתור מיקום');
  navigator.geolocation.getCurrentPosition(
    p => map.flyTo([p.coords.latitude, p.coords.longitude], 12),
    () => toast('לא ניתן לקבל את המיקום'));
});

// Jewish community layer: synagogues + kosher food from OpenStreetMap (Overpass)
const jewishLayer = L.layerGroup();
let jewishOn = false, jewishTimer;
$('#jewish').addEventListener('click', () => setJewish(!jewishOn));
map.on('moveend', () => { if (jewishOn) { clearTimeout(jewishTimer); jewishTimer = setTimeout(loadJewish, 700); } });
// the public Overpass servers are often busy — try a few mirrors in turn
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      return await getJSON(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000) });
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function setJewish(on) {
  jewishOn = on;
  $('#jewish').classList.toggle('on', on);
  if (on) { jewishLayer.addTo(map); loadJewish(); } else jewishLayer.remove();
}
function showJewishFor(iso2) {
  if (state.point) map.flyTo([state.point.lat, state.point.lon], 12, { duration: 0.8 });
  setJewish(true);
}
async function loadJewish() {
  if (map.getZoom() < 10) { toast('🕍 התקרבו לעיר (זום 10 ומעלה) כדי לראות בתי כנסת ומסעדות כשרות'); return; }
  const b = map.getBounds();
  const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => n.toFixed(3)).join(',');
  const query = `[out:json][timeout:25];(
    nwr["amenity"="place_of_worship"]["religion"="jewish"](${bbox});
    nwr["diet:kosher"~"yes|only"](${bbox});
  );out center 300;`;
  try {
    const res = await overpass(query);
    jewishLayer.clearLayers();
    for (const el of res?.elements || []) {
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      const syn = el.tags?.religion === 'jewish';
      L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: syn ? '#2f6fde' : '#16a34a', fillOpacity: 1 })
        .bindPopup(`<b>${syn ? '🕍' : '🍽️'} ${esc(el.tags?.name || (syn ? 'בית כנסת' : 'כשר'))}</b><br>
          <small>${syn ? 'בית כנסת' : 'אוכל כשר'}${el.tags?.['addr:street'] ? ' · ' + esc(el.tags['addr:street'] + ' ' + (el.tags['addr:housenumber'] || '')) : ''}</small><br>
          <a href="https://www.openstreetmap.org/${el.type}/${el.id}" target="_blank" rel="noopener">פתיחה ב־OpenStreetMap</a>`)
        .addTo(jewishLayer);
    }
    toast(`🕍 נמצאו ${res?.elements?.length || 0} מקומות באזור`);
  } catch (e) { console.error(e); toast('טעינת המקומות נכשלה (Overpass עמוס). נסו שוב.'); }
}

// ---------- destination finder ----------
let finderMatches = new Set();
async function loadCountryTemps() {
  const key = `${state.from}_${state.to}`;
  if (state.ctemps?.key === key) return state.ctemps.temps;
  const plan = weatherPlan(state.from, state.to);
  const kind = plan.kind === 'forecast' ? 'forecast' : 'archive';
  const from = plan.kind === 'estimate' ? shiftYears(plan.from, plan.shift) : plan.from;
  const to = plan.kind === 'estimate' ? shiftYears(plan.to, plan.shift) : plan.to;
  const pts = Object.keys(state.features).map(c => ({ c, p: repPoint(c) })).filter(x => x.p);
  const temps = {};
  for (let i = 0; i < pts.length; i += 80) {
    const chunk = pts.slice(i, i + 80);
    let res = await getJSON(wxURL(kind, chunk.map(x => x.p.lat.toFixed(2)).join(','), chunk.map(x => x.p.lon.toFixed(2)).join(','), from, to, 'temperature_2m_max'));
    if (!Array.isArray(res)) res = [res];
    res.forEach((r, j) => { temps[chunk[j].c] = avg(r?.daily?.temperature_2m_max || []); });
  }
  state.ctemps = { key, temps };
  return temps;
}
function readFinder() {
  return {
    tempOn: $('#fTempOn').checked, tmin: +$('#fTmin').value, tmax: +$('#fTmax').value, risk: +$('#fRisk').value,
    visa: $('#fVisa').checked, events: $('#fEvents').checked,
  };
}
let finderSeq = 0;
async function runFinder() {
  if (!state.finder) return;
  const f = state.finder = readFinder(), seq = ++finderSeq;
  let temps = null;
  if (f.tempOn) {
    $('#fResults').innerHTML = '<div class="spinner">טוען טמפרטורות לכל המדינות…</div>';
    try { temps = await loadCountryTemps(); }
    catch { $('#fResults').innerHTML = '<div class="empty">לא הצלחנו לטעון טמפרטורות. נסו שוב בעוד דקה.</div>'; return; }
    if (seq !== finderSeq || !state.finder) return;
  }
  // first failing criterion per country, so we can explain why countries with events were left out
  const REASON = { risk: 'מדד סיכון', temp: 'טמפרטורה', visa: 'ויזה' };
  const failOf = (iso2, r, t) => {
    if (!r || r.score >= f.risk) return 'risk';
    if (f.tempOn && (t == null || t < f.tmin || t > f.tmax)) return 'temp';
    if (f.visa && !visaOk(state.practical[iso2]?.visa)) return 'visa';
    return null;
  };
  const hits = [], eventFails = {};
  let withEvents = 0;
  for (const iso2 of Object.keys(state.features)) {
    if (iso2 === 'IL' || iso2 === 'AQ') continue;
    const r = riskOf(iso2), t = temps?.[iso2], ev = eventsInRange(iso2);
    if (f.events && !ev.length) continue;
    if (f.events) withEvents++;
    const fail = failOf(iso2, r, t);
    if (fail) { if (f.events) eventFails[fail] = (eventFails[fail] || 0) + 1; continue; }
    hits.push({ iso2, r, t, ev });
  }
  // same risk level: bigger countries first (otherwise dozens of micro-states with a 0 score lead the list)
  hits.sort((a, b) => a.r.bucket - b.r.bucket || (state.info[b.iso2]?.pop || 0) - (state.info[a.iso2]?.pop || 0));
  finderMatches = new Set(hits.map(h => h.iso2));
  restyle();
  // with the events filter on, show the matching countries' event markers on the map
  if (f.events) { drawEventMarkers(finderMatches); eventLayer.addTo(map); }
  else if (state.layer !== 'events') eventLayer.remove();
  else drawEventMarkers();
  const why = f.events && withEvents > hits.length
    ? `<div class="f-why">מתוך ${withEvents} מדינות עם אירועים בתאריכים, נפסלו: ${Object.entries(eventFails).map(([k, n]) => `${n} בגלל ${REASON[k]}`).join(' · ')}</div>` : '';
  $('#fResults').innerHTML = `<div class="f-count">${hits.length ? `נמצאו <b>${hits.length}</b> יעדים` : 'לא נמצאו יעדים – נסו להרחיב את הסינון'}</div>${why}
    <ul class="f-list">${hits.map(h => `<li data-iso="${h.iso2}">
      <span>${esc(nameHe(h.iso2, h.iso2))}${f.events ? `<small class="f-ev">${h.ev.map(e => `${CAT_ICON[e.cat] || ''} ${esc(e.name)}`).join(' · ')}</small>` : ''}</span>
      ${h.t != null ? `<span class="tchip" style="background:${tempColor(h.t)}">${Math.round(h.t)}°</span>` : ''}
      <span class="rchip" style="background:${h.r.color}33;color:${darkText(h.r.color)}">${h.r.score}</span></li>`).join('')}</ul>`;
}
function openFinder(open) {
  $('#finder').hidden = !open;
  document.body.classList.toggle('finder-open', open);
  $('#finderBtn').classList.toggle('on', open);
  if (open) {
    if (state.layer === 'temp') setLayer('risk');
    state.finder = readFinder();
    runFinder();
  } else {
    state.finder = null; finderMatches = new Set(); restyle();
    if (state.layer === 'events') drawEventMarkers(); else eventLayer.remove();
  }
}
$('#finderBtn').addEventListener('click', () => {
  if (state.finder && $('#finder').hidden) { $('#finder').hidden = false; document.body.classList.add('finder-open'); }  // minimised → show again
  else openFinder($('#finder').hidden);
});
$('#fMap').addEventListener('click', () => { $('#finder').hidden = true; document.body.classList.remove('finder-open'); });
$('#fClose').addEventListener('click', () => openFinder(false));
$('#finder').addEventListener('change', runFinder);
// number fields update the results while typing, not only when the field loses focus
let finderTimer;
$('#finder').addEventListener('input', e => {
  if (e.target.type !== 'number') return;
  clearTimeout(finderTimer); finderTimer = setTimeout(runFinder, 350);
});
$('#fResults').addEventListener('click', e => {
  const iso = e.target.closest('[data-iso]')?.dataset.iso;
  if (iso) selectCountry(iso, { zoom: true });
});

// ---------- URL hash (shareable state) ----------
function saveHash() {
  const h = new URLSearchParams({ layer: state.layer, from: state.from, to: state.to });
  if (state.layer === 'risk' && state.riskMode !== 'combined') h.set('mode', state.riskMode);
  if (state.selected) h.set('c', state.selected);
  history.replaceState(null, '', '#' + h);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { layer: h.get('layer'), mode: h.get('mode'), from: h.get('from'), to: h.get('to'), c: h.get('c') };
}

// ---------- boot ----------
(async function init() {
  const h = readHash();
  setDates(h.from || today(), h.to || addDays(h.from || today(), 6), { silent: true });

  const [geo, anti, events, info, nsc, practical] = await Promise.all([
    fetch('data/countries.geojson').then(r => r.json()),
    fetch('data/antisemitism.json').then(r => r.json()),
    fetch('data/events.json').then(r => r.json()),
    fetch('data/country-info.json').then(r => r.json()),
    fetch('data/nsc-warnings.json').then(r => r.json()),
    fetch('data/practical.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  state.practical = practical?.countries || {};
  state.nsc = nsc.countries; state.nscMeta = nsc._meta || {};
  state.info = info;
  state.anti = anti.countries; state.antiMeta = anti._meta || {};
  state.events = events.events;
  fetch('data/cities.json').then(r => r.json()).then(c => { state.cities = c; drawLabels(); refreshTrip(); }).catch(() => {});
  fetch('data/airports.json').then(r => r.json()).then(a => { state.airports = a.airports; refreshTrip(); }).catch(() => {});
  for (const f of geo.features) if (f.properties.iso2 && !state.features[f.properties.iso2]) state.features[f.properties.iso2] = f;
  labelFeatures = geo.features.filter(f => (f.properties.iso2 || AREA_NAMES[f.properties.a3]) && f.properties.lx != null)
    .sort((a, b) => a.properties.rank - b.properties.rank || a.properties.minz - b.properties.minz);
  landFeatures = geo.features.filter(f => f.properties.iso2 !== 'AQ').map(f => {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { geometry: f.geometry, bbox: [x0, y0, x1, y1] };
  });

  countryLayer = L.geoJSON(geo, {
    style: styleFor,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(() => tooltipFor(f.properties), { sticky: true, direction: 'top', opacity: 0.95 });
      layer.on({
        mouseover: () => layer.setStyle({ weight: 2, color: '#1d2433' }),
        mouseout: () => countryLayer.resetStyle(layer),
        mousemove: e => { state.mouseLL = e.latlng; if (state.layer === 'temp') layer.getTooltip()?.update(); },
        click: async e => {
          const iso2 = f.properties.iso2;
          if (!iso2) return;
          const { lat, lng } = e.latlng, city = nearestCity(lat, lng);
          // label the clicked point: nearest big city, else the region (reverse geocoding), else the country
          const label = city ? `ליד ${city}` : (await regionName(lat, lng, iso2)) || nameHe(iso2, iso2);
          selectCountry(iso2, { point: { lat, lon: lng, clicked: true, label } });
        },
      });
    },
  }).addTo(map);
  map.on('zoomend', restyle);
  drawLabels();

  // old links used separate nsc / anti layers
  if (h.layer === 'nsc' || h.layer === 'anti') { h.mode = h.layer === 'anti' ? 'adl' : 'nsc'; h.layer = 'risk'; }
  if (['combined', 'adl', 'nsc'].includes(h.mode)) state.riskMode = h.mode;
  await setLayer(['risk', 'temp', 'events'].includes(h.layer) ? h.layer : 'risk');
  if (h.c && state.features[h.c]) selectCountry(h.c, { zoom: true });
})();
