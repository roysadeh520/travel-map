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
  areas: {},            // map areas without an ISO code, by Natural Earth A3 code
  pdates: null,         // the country panel's own date range ({from, to}); null = the map's dates
  folds: {},            // panel sections closed by the viewer; reset whenever a country is opened
  finder: null,         // destination-finder criteria while its panel is open
  ctemps: null,         // { key, temps } per-country temperature for the finder
  events: [],
  cities: [],           // [he, en, iso2, lat, lon, pop] — Natural Earth, for Hebrew search
  dests: [],            // [he, en, iso2, lat, lon, iata] — hand-picked tourist spots (islands, resorts…)
};
const cache = new Map(), quotaOut = new Map();

// ---------- usage analytics (PostHog, loaded by index.html) ----------
// events wait in a queue until the SDK has loaded; if it never loads (an ad blocker), nothing breaks
const trackQueue = [];
function track(event, props = {}) {
  // the Hebrew name next to the code, for readable charts (the code stays for the world map)
  if (props.country && !props.country_name) props = { ...props, country_name: nameHe(props.country, state.features[props.country]?.properties.en || props.country) };
  if (window.posthog?.capture) window.posthog.capture(event, props);
  else trackQueue.push([event, props]);
}
window.addEventListener('posthog-ready', () => { for (const [e, p] of trackQueue.splice(0)) window.posthog.capture(e, p); });

// ---------- date helpers ----------
// dates the country panel shows: its own range if the viewer changed it there, else the map's
const pd = () => state.pdates || { from: state.from, to: state.to };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const shiftYears = (s, n) => { const d = parse(s); d.setFullYear(d.getFullYear() + n); return iso(d); };
const today = () => iso(new Date());

// ---------- fetch helpers ----------
// opts.keep (ms): also keep the answer in this browser for that long, so reopening a country costs no request
// (weather: Open-Meteo's free quota is per connection)
const kept = (key, ms) => { try { const e = JSON.parse(localStorage.getItem('c:' + key)); return e && Date.now() - e.t < ms ? e.v : undefined; } catch { return undefined; } };
function keep(key, v) {
  const put = () => localStorage.setItem('c:' + key, JSON.stringify({ t: Date.now(), v }));
  try { put(); } catch {
    // storage full: drop the kept answers and try once more
    try { Object.keys(localStorage).filter(k => k.startsWith('c:')).forEach(k => localStorage.removeItem(k)); put(); } catch {}
  }
}
async function getJSON(url, opts) {
  const key = url + (opts?.body || '');
  if (cache.has(key)) return cache.get(key);
  if (opts?.keep) { const v = kept(key, opts.keep); if (v !== undefined) return v; }
  // a timeout so nothing waits forever, and two more tries on a rate limit or a network error (a 429 without
  // CORS headers reaches us as a network error)
  // an hourly or daily quota that ran out is not retried, and that service is skipped for 10 minutes
  const host = new URL(url).host;
  if (Date.now() - (quotaOut.get(host) || 0) < 6e5) return Promise.reject(new Error(`quota ${host}`));
  const p = (async () => {
    for (let n = 0; ; n++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
        if (r.status === 204 || r.status === 404) return null;
        if (r.status === 429) {
          const why = (await r.json().catch(() => ({}))).reason || '';
          if (/daily|hourly/i.test(why)) { quotaOut.set(host, Date.now()); throw new Error(`429 ${why}`); }
          if (n < 2) throw new TypeError('429');
        }
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        const v = await r.json();
        if (opts?.keep) keep(key, v);
        return v;
      } catch (e) {
        if (!(e instanceof TypeError) || n >= 2) throw e;
        await new Promise(res => setTimeout(res, 1500 * (n + 1)));
      }
    }
  })();
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
const CAPITAL_HE = { SS: "ג'ובה", EH: 'אל־עיון' };   // capitals missing from the cities list
// the capitals' Hebrew names: the country data has them in English only, the cities list has Hebrew
function capitalsHe(iso2) {
  const i = state.info[iso2], names = i?.capital || [];
  return names.map((en, k) => state.cities.find(c => c[2] === iso2 && c[1] === en)?.[0]
    || (k === 0 && i.cap && (nearestCity(i.cap[0], i.cap[1], 30, iso2) || CAPITAL_HE[iso2])) || en);
}
const REGION_HE = {
  'Caribbean': 'הקריביים', 'Southern Asia': 'דרום אסיה', 'Middle Africa': 'מרכז אפריקה', 'Northern Europe': 'צפון אירופה',
  'Southeast Europe': 'דרום־מזרח אירופה', 'Southern Europe': 'דרום אירופה', 'Western Asia': 'מערב אסיה',
  'South America': 'דרום אמריקה', 'Polynesia': 'פולינזיה', 'Antarctic': 'אנטארקטיקה', 'Australia and New Zealand': 'אוסטרליה וניו זילנד',
  'Central Europe': 'מרכז אירופה', 'Eastern Africa': 'מזרח אפריקה', 'Western Europe': 'מערב אירופה', 'Western Africa': 'מערב אפריקה',
  'Eastern Europe': 'מזרח אירופה', 'Central America': 'מרכז אמריקה', 'North America': 'צפון אמריקה',
  'South-Eastern Asia': 'דרום־מזרח אסיה', 'Southern Africa': 'דרום אפריקה (אזור)', 'Eastern Asia': 'מזרח אסיה',
  'Northern Africa': 'צפון אפריקה', 'Melanesia': 'מלנזיה', 'Micronesia': 'מיקרונזיה', 'Central Asia': 'מרכז אסיה',
};
function repPoint(iso2) {
  const i = state.info[iso2];
  if (i?.cap) return { lat: i.cap[0], lon: i.cap[1], label: capitalsHe(iso2)[0] };
  const f = state.features[iso2] || state.areas[iso2];
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
// how long a weather answer is kept: a forecast 2 hours, past data a month
const wxKeep = kind => ({ keep: kind === 'forecast' ? 72e5 : 2592e6 });
function wxURL(kind, lats, lons, from, to, daily) {
  const base = kind === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  return `${base}?latitude=${lats}&longitude=${lons}&start_date=${from}&end_date=${to}&daily=${daily}&timezone=auto`;
}
const WX = c => c == null ? ['', ''] :
  c === 0 ? ['☀️', 'בהיר'] : c <= 2 ? ['🌤️', 'מעונן חלקית'] : c === 3 ? ['☁️', 'מעונן'] :
  c <= 48 ? ['🌫️', 'ערפל'] : c <= 57 ? ['🌦️', 'טפטוף'] : c <= 67 ? ['🌧️', 'גשם'] :
  c <= 77 ? ['🌨️', 'שלג'] : c <= 82 ? ['🌧️', 'ממטרים'] : c <= 86 ? ['🌨️', 'ממטרי שלג'] : ['⛈️', 'סופות רעמים'];
const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// daily max / min / rain for several points in one request; beyond the forecast horizon: the same dates last year
// (the panel, the finder and the heat map all use this, so their numbers agree; a multi-year average would
// triple the calls and break Open-Meteo's free limit of 600 locations a minute for the finder)
async function wxSeries(points, daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum', range = state) {
  const plan = weatherPlan(range.from, range.to);
  const lats = points.map(p => p.lat.toFixed(2)).join(','), lons = points.map(p => p.lon.toFixed(2)).join(',');
  const asList = r => (Array.isArray(r) ? r : [r]);
  const from = plan.kind === 'estimate' ? shiftYears(plan.from, plan.shift) : plan.from;
  const to = plan.kind === 'estimate' ? shiftYears(plan.to, plan.shift) : plan.to;
  const runs = [asList(await getJSON(wxURL(plan.kind === 'forecast' ? 'forecast' : 'archive', lats, lons, from, to, daily), wxKeep(plan.kind)))];
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
  const f = state.features[iso2] || state.areas[iso2]; if (!f) return [];
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
    // only a Hebrew name; otherwise the caller falls back to the nearest city with a Hebrew name
    return region && /[֐-׿]/.test(region) ? `${region}, ${nameHe(iso2, iso2)}` : null;
  } catch { return null; }
}
function nearestCity(lat, lon, maxKm = 60, iso2 = null) {
  let best = null, bestKm = maxKm;
  const dLat = maxKm / 111 + 0.1, dLon = maxKm / (111 * Math.max(0.1, Math.cos(lat * Math.PI / 180))) + 0.1;
  for (const [he, , cc, clat, clon] of state.cities) {
    if (Math.abs(clat - lat) > dLat || Math.abs(clon - lon) > dLon || (iso2 && cc !== iso2)) continue;
    const km = kmBetween({ lat, lon }, { lat: clat, lon: clon });
    if (km < bestKm) { bestKm = km; best = he; }
  }
  return best;
}

// time zone of a point: the nearest IANA zone of that country (zone.tab gives each zone's main city), so it needs
// no request and does not depend on the weather service
function tzFor(iso2, lat, lon) {
  const all = state.zones || [], own = all.filter(z => z[0] === iso2);
  let best = null, bestKm = Infinity;
  for (const z of own.length ? own : all) {
    const km = kmBetween({ lat, lon }, { lat: z[1], lon: z[2] });
    if (km < bestKm) { bestKm = km; best = z[3]; }
  }
  return best;
}
// sunrise and sunset (the sunrise equation, ±1–2 minutes) as UTC timestamps; null = polar day or night
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, [y, m, d] = date.split('-').map(Number);
  // days since J2000 at the local solar noon
  const j = Date.UTC(y, m - 1, d, 12) / 864e5 + 2440587.5 - 2451545 - lon / 360;
  const sun = t => {   // solar transit near day t and the sun's declination at t
    const M = (357.5291 + 0.98560028 * t) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const L = (M + C + 282.9372) % 360;
    return { transit: t + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad), dec: Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad)) };
  };
  const halfDay = dec => (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  const { transit, dec } = sun(j), cosW = halfDay(dec);
  if (Math.abs(cosW) > 1) return { polar: cosW > 1 ? 'night' : 'day' };
  const w = Math.acos(cosW) / rad / 360, ms = t => (t + 2451545 - 2440587.5) * 864e5;
  // once more with the declination at the event itself (it moves up to 0.4° a day around the equinoxes)
  const at = t => { const c = halfDay(sun(t).dec); return Math.abs(c) > 1 ? w : Math.acos(c) / rad / 360; };
  return { rise: ms(transit - at(transit - w)), set: ms(transit + at(transit + w)) };
}

async function countryWeather(pt) {
  const plan = weatherPlan(pd().from, pd().to);
  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,sunrise,sunset,daylight_duration';
  const lat = pt.lat.toFixed(3), lon = pt.lon.toFixed(3);
  if (plan.kind !== 'estimate') {
    const r = await getJSON(wxURL(plan.kind === 'forecast' ? 'forecast' : 'archive', lat, lon, plan.from, plan.to, daily), wxKeep(plan.kind));
    return { plan, tz: r.timezone, days: r.daily.time.map((t, i) => ({
      date: t, hi: r.daily.temperature_2m_max[i], lo: r.daily.temperature_2m_min[i],
      rain: r.daily.precipitation_sum[i], code: r.daily.weather_code[i],
      sunrise: r.daily.sunrise?.[i], sunset: r.daily.sunset?.[i], daylight: r.daily.daylight_duration?.[i] })) };
  }
  // estimate: the same dates last year (as in wxSeries)
  const years = [plan.shift];
  const runs = await Promise.all(years.map(n =>
    getJSON(wxURL('archive', lat, lon, shiftYears(plan.from, n), shiftYears(plan.to, n), daily), wxKeep('archive'))));
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

// rainy days of a city; for multi-year normals (they carry a typical sky code) every day has the average rain,
// so a count would mislead: the typical sky's icon instead
function rainCell(d, wet) {
  if (!d.some(x => x.rain != null)) return '';
  if (d[0]?.code !== undefined) { const [ic, t] = WX(d[0].code); return `<span title="${t} (ממוצע)">${ic}</span>`; }
  return wet ? `🌧️ ${wet}` : '☀️';
}
async function loadCitiesWx(iso2, token) {
  const cities = spreadCities(iso2);
  if (cities.length < 2) return;
  try {
    const series = await wxSeries(cities, undefined, pd())
      .catch(async e => { console.error(e); return (await normalWeather(cities, pd())).map(d => d || []); });
    if (token !== panelToken || !$('#citiesWx')) return;
    $('#citiesWx').innerHTML = `<h4 class="sub-h">ערים מרכזיות <small>· לחצו לפירוט יומי</small></h4>
      <table class="wx cities">${cities.map((c, k) => {
        const d = series[k], hi = avg(d.map(x => x.hi)), lo = avg(d.map(x => x.lo)), wet = d.filter(x => x.rain >= 1).length;
        // the city whose information the panel shows (chosen above, clicked here, or the capital)
        const shown = state.point && kmBetween(c, state.point) < 10;
        return `<tr data-city="${k}"${shown ? ' class="sel"' : ''}><td>${esc(c.he)}</td>
          <td><span class="tchip" style="background:${tempColor(hi)}">${Math.round(hi)}°</span></td>
          <td>${lo == null ? '–' : `<span class="tchip tchip-lo" style="${tempChipLo(lo)}">${Math.round(lo)}°</span>`}</td><td>${rainCell(d, wet)}</td></tr>`;
      }).join('')}</table>`;
    $('#citiesWx').onclick = e => {
      const k = e.target.closest('[data-city]')?.dataset.city; if (k == null) return;
      const c = cities[+k];
      showPoint({ lat: c.lat, lon: c.lon, label: c.he, clicked: true });   // the trip row above moves to it too
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
  const { from, to } = pd();
  if (iso2 === 'IL') {
    const r = await getJSON(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&mod=on&i=on&lg=he&start=${from}&end=${to}`);   // a failure shows as an error, not as "no data"
    if (!r) return null;
    return mergeHolidays((r.items || []).filter(i => i.category === 'holiday').map(i => ({ date: i.date.slice(0, 10), localName: i.hebrew || i.title, name: i.hebrew || i.title })));
  }
  const y0 = parse(from).getFullYear(), y1 = parse(to).getFullYear();
  const lists = await Promise.all([...new Set([y0, y1])].map(y =>
    getJSON(`https://date.nager.at/api/v3/PublicHolidays/${y}/${iso2}`)));   // 404 = country not covered (null)
  if (lists.every(l => !l)) return null;
  return lists.flat().filter(h => h && h.date >= from && h.date <= to);
}

// ---------- map ----------
const map = L.map('map', {
  zoomControl: true, minZoom: 2, maxZoom: 18, worldCopyJump: false,
  maxBounds: [[-85, -220], [85, 220]], maxBoundsViscosity: 0.8, preferCanvas: true,
}).setView([30, 15], 2.5);
// about & privacy and feedback links in the map's credits corner: always there, takes no room on a phone
map.attributionControl.setPrefix('<a href="#" data-open="about">אודות ופרטיות</a> · <a href="#" data-open="feedback" data-from="corner">משוב</a> · '
  + '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
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

// ---------- climate normals & temperature heat map ----------
// data/climate.json (scripts/build-climate.mjs): the average daily high of every month on a 1° land grid, from
// NASA POWER (2001–2020). Each day's normal is interpolated between the mid-month values, so a date range has a
// normal high for every one of its days. The heat map, the finder and the panel's "normal" line all read it:
// no live requests, nothing changes while panning, and all three agree.
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
// the minimum's chip: a pale version of the same colour, with text in a dark shade of it
const tempChipLo = t => { const c = tempRGB(t);
  return `background:rgb(${c.map(v => Math.round(v * 0.45 + 140)).join(',')});color:rgb(${c.map(v => Math.round(v * 0.45)).join(',')})`; };
const wrapLon = lon => ((lon + 540) % 360) - 180;

let climate = null;   // { north, west, step, rows, cols, v: Float32Array(rows * cols * 12), NaN where there is no data }
const climateReady = fetch('data/climate.json').then(r => r.json()).then(j => {
  const { north, west, step, rows, cols, scale } = j._meta, v = new Float32Array(rows * cols * 12).fill(NaN);
  j.i.forEach((node, k) => { for (let m = 0; m < 12; m++) v[node * 12 + m] = j.v[k * 12 + m] / scale; });
  climate = { north, west, step, rows, cols, v, nodes: j.i };
}).catch(e => console.error('climate data', e));
// normal lows and rain (data/climate-extra.json, same nodes): only for the panel when the weather service fails,
// so loaded on first use
let climateExtra = null;
const loadClimateExtra = () => climateExtra ||= climateReady.then(() => fetch('data/climate-extra.json')).then(r => r.json()).then(j => {
  const n = climate.rows * climate.cols * 12, lo = new Float32Array(n).fill(NaN), rain = new Float32Array(n).fill(NaN);
  climate.nodes.forEach((node, k) => { for (let m = 0; m < 12; m++) {
    lo[node * 12 + m] = j.lo[k * 12 + m] / j._meta.loScale; rain[node * 12 + m] = j.rain[k * 12 + m] / j._meta.rainScale; } });
  return { lo, rain };
}).catch(e => { climateExtra = null; throw e; });   // a failed load is tried again next time

// for each day of a range: the two months it lies between and the weight of the second (mid-month anchors)
function dayWeights(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const t = parse(d), dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    const x = t.getMonth() + (t.getDate() - 0.5) / dim - 0.5, m0 = Math.floor(x);
    out.push([(m0 + 12) % 12, (m0 + 13) % 12, x - m0]);
  }
  return out;
}
// the 12 monthly normals at a point, bilinear between the four surrounding grid nodes (missing nodes skipped)
function monthlyAt(lat, lon, v = climate?.v) {
  if (!climate) return null;
  const { north, west, step, rows, cols } = climate;
  const gy = (north - lat) / step, gx = (wrapLon(lon) - west) / step;
  if (gy < 0 || gy > rows - 1) return null;
  const y0 = Math.floor(gy), x0 = Math.floor(gx), fy = gy - y0, fx = gx - x0;
  const out = new Array(12).fill(0);
  let wsum = 0;
  for (const [dy, dx, w] of [[0, 0, (1 - fy) * (1 - fx)], [0, 1, (1 - fy) * fx], [1, 0, fy * (1 - fx)], [1, 1, fy * fx]]) {
    const r = Math.min(rows - 1, y0 + dy), c = (x0 + dx + cols) % cols, i = (r * cols + c) * 12;
    if (w === 0 || Number.isNaN(v[i])) continue;
    for (let m = 0; m < 12; m++) out[m] += v[i + m] * w;
    wsum += w;
  }
  return wsum ? out.map(x => x / wsum) : null;
}
// normal daily highs at a point for every day of a range
function normalDays(lat, lon, from, to, v) {
  const mo = monthlyAt(lat, lon, v);
  return mo && dayWeights(from, to).map(([a, b, f]) => mo[a] * (1 - f) + mo[b] * f);
}
// the panel's fallback when the weather service is unavailable: a normal day (high, low, rain) for every date,
// in the same shape as the service's days; null where there is no climate data (open sea)
async function normalWeather(points, { from, to }) {
  await climateReady;
  // the highs are the map's own file; lows and rain come from a second file, and without it the highs alone
  const ex = await loadClimateExtra().catch(e => { console.error(e); return null; });
  const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return points.map(p => {
    const hi = normalDays(p.lat, p.lon, from, to);
    if (!hi) return null;
    const lo = ex && normalDays(p.lat, p.lon, from, to, ex.lo), rain = ex && normalDays(p.lat, p.lon, from, to, ex.rain);
    // a typical day's sky from its average rain (mm a day)
    return dates.map((date, i) => ({ date, hi: hi[i], lo: lo?.[i] ?? null, rain: rain?.[i] ?? null,
      code: rain == null ? null : rain[i] >= 4 ? (lo[i] < 0 ? 71 : 61) : rain[i] >= 1.5 ? (lo[i] < 0 ? 71 : 51) : rain[i] >= 0.5 ? 2 : 0 }));
  });
}

map.createPane('heat');
map.getPane('heat').style.zIndex = 350;
map.getPane('heat').style.pointerEvents = 'none';
const heatCanvas = L.DomUtil.create('canvas', 'heat-canvas leaflet-zoom-animated', map.getPane('heat'));
const heat = { key: null, grid: null, nw: null, seq: 0 };   // grid: per node, the average normal high of the dates
const pointMarker = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#1d2433', fillOpacity: 1 });

async function loadHeat() {
  if (state.layer !== 'temp' || !landFeatures.length) return;
  await climateReady;
  if (!climate || state.layer !== 'temp') return;
  const key = `${state.from}_${state.to}`;
  if (heat.key !== key) {
    // one weight per month for the whole range, then a single pass over the grid
    const w = new Array(12).fill(0), days = dayWeights(state.from, state.to);
    for (const [a, b, f] of days) { w[a] += (1 - f) / days.length; w[b] += f / days.length; }
    const { v, rows, cols } = climate, grid = new Float32Array(rows * cols);
    for (let n = 0; n < rows * cols; n++) {
      if (Number.isNaN(v[n * 12])) { grid[n] = NaN; continue; }
      let s = 0;
      for (let m = 0; m < 12; m++) if (w[m]) s += v[n * 12 + m] * w[m];
      grid[n] = s;
    }
    Object.assign(heat, { key, grid });
  }
  drawHeat();
  drawLegend();
}

// value of the dates' grid at a map position (bilinear; missing nodes skipped) – runs for every pixel, so no allocations
function latticeAt(lat, lon) {
  const { north, west, step, rows, cols } = climate, grid = heat.grid;
  const gy = (north - lat) / step, gx = (wrapLon(lon) - west) / step;
  if (gy < 0 || gy > rows - 1) return null;
  const y0 = Math.floor(gy), x0 = Math.floor(gx), fy = gy - y0, fx = gx - x0;
  const r0 = y0 * cols, r1 = Math.min(rows - 1, y0 + 1) * cols, c0 = (x0 + cols) % cols, c1 = (x0 + 1 + cols) % cols;
  let s = 0, ws = 0, t, w;
  w = (1 - fy) * (1 - fx); t = grid[r0 + c0]; if (w && t === t) { s += t * w; ws += w; }   // t === t: not NaN
  w = (1 - fy) * fx;       t = grid[r0 + c1]; if (w && t === t) { s += t * w; ws += w; }
  w = fy * (1 - fx);       t = grid[r1 + c0]; if (w && t === t) { s += t * w; ws += w; }
  w = fy * fx;             t = grid[r1 + c1]; if (w && t === t) { s += t * w; ws += w; }
  return ws ? s / ws : null;
}

// Paints the grid in geographic space: a quarter-resolution image computed pixel by pixel (Mercator is
// separable, so each column has one longitude and each row one latitude), scaled up smoothly and clipped to land.
// a polygon ring clipped to a rectangle (Sutherland–Hodgman: one pass per edge of the rectangle)
function clipRing(pts, [x0, y0, x1, y1]) {
  const edges = [[p => p.x >= x0, (a, b) => cut(a, b, 'x', x0)], [p => p.x <= x1, (a, b) => cut(a, b, 'x', x1)],
    [p => p.y >= y0, (a, b) => cut(a, b, 'y', y0)], [p => p.y <= y1, (a, b) => cut(a, b, 'y', y1)]];
  function cut(a, b, k, v) {
    const t = (v - a[k]) / (b[k] - a[k]);
    return k === 'x' ? { x: v, y: a.y + t * (b.y - a.y) } : { x: a.x + t * (b.x - a.x), y: v };
  }
  for (const [inside, cross] of edges) {
    if (!pts.length) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur));
    }
    pts = out;
  }
  return pts;
}
// the heat map fades out at street level, where its 1° grid says nothing and the streets matter
const heatOpacity = z => (z <= 7 ? 0.8 : z <= 9 ? 0.55 : z <= 11 ? 0.35 : 0);
function drawHeat() {
  const ctx = heatCanvas.getContext('2d');
  const size = map.getSize();
  if (state.layer !== 'temp' || !heat.grid || !size.x || !size.y) { ctx.clearRect(0, 0, heatCanvas.width, heatCanvas.height); return; }
  heatCanvas.style.opacity = heatOpacity(map.getZoom());
  if (!heatOpacity(map.getZoom())) return;
  const q = 4, W = Math.ceil(size.x / q), H = Math.ceil(size.y / q);
  const origin = map.containerPointToLayerPoint([0, 0]);
  heat.nw = map.containerPointToLatLng([0, 0]); heat.zoom = map.getZoom();   // for the zoom animation
  heatCanvas.width = size.x; heatCanvas.height = size.y;
  heatCanvas.style.width = size.x + 'px'; heatCanvas.style.height = size.y + 'px';
  L.DomUtil.setPosition(heatCanvas, origin);

  const lons = Array.from({ length: W }, (_, x) => map.containerPointToLatLng([(x + 0.5) * q, 0]).lng);
  const lats = Array.from({ length: H }, (_, y) => map.containerPointToLatLng([0, (y + 0.5) * q]).lat);
  const small = document.createElement('canvas');
  small.width = W; small.height = H;
  const sctx = small.getContext('2d'), img = sctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = latticeAt(lats[y], lons[x]);
    if (t == null) continue;
    const c = tempRGB(t), o = (y * W + x) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.clearRect(0, 0, size.x, size.y);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W * q, H * q);

  // keep only land
  const view = map.getBounds().pad(0.1);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  // each ring is clipped to (a margin around) the screen first: zoomed in, a country's outline lies hundreds of
  // thousands of pixels away, and the canvas then fills it wrongly (part of the screen left uncovered)
  const box = [-50, -50, size.x + 50, size.y + 50];
  for (const f of landFeatures) {
    const bb = f.bbox;
    if (bb[2] < view.getWest() || bb[0] > view.getEast() || bb[3] < view.getSouth() || bb[1] > view.getNorth()) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      const pts = clipRing(ring.map(([lon, lat]) => map.latLngToLayerPoint([lat, lon]).subtract(origin)), box);
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    }
  }
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = 'source-over';
}

// temperature under the cursor
function tempAt(ll) {
  return heat.grid ? latticeAt(ll.lat, ll.lng) : null;
}

let landFeatures = [];
// while zooming, scale the existing picture with the map (as Leaflet does for images) instead of blanking it
map.on('zoomanim', e => {
  if (!heat.nw || state.layer !== 'temp') return;
  L.DomUtil.setTransform(heatCanvas, map._latLngToNewLayerPoint(heat.nw, e.zoom, e.center), map.getZoomScale(e.zoom, heat.zoom));
});
// a pinch on a phone zooms step by step with 'zoom' events (no zoomanim): follow each step, as the country
// shapes do, so the picture does not slide away from them
map.on('zoom', () => {
  if (!heat.nw || state.layer !== 'temp') return;
  L.DomUtil.setTransform(heatCanvas, map.latLngToLayerPoint(heat.nw), map.getZoomScale(map.getZoom(), heat.zoom));
});
map.on('moveend resize', () => { if (state.layer === 'temp') drawHeat(); });

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
    // on the temperature layer the heat map shows through the matches and the rest is greyed out
    if (state.layer === 'temp') return hit
      ? { fillColor: '#2f6fde', fillOpacity: 0, color: sel ? '#1d2433' : '#2f6fde', weight: sel ? 2.5 : 1.6, dashArray: null }
      : { fillColor: '#c9ced8', fillOpacity: 0.85, color: '#fff', weight: 0.7, dashArray: null };
    return { fillColor: hit ? '#2f6fde' : '#c9ced8', fillOpacity: hit ? 0.6 : 0.45, color: sel ? '#1d2433' : '#fff', weight: sel ? 2.5 : 0.7, dashArray: null };
  }
  const mixed = state.layer === 'risk' && state.riskMode !== 'adl' && w?.mixed;
  if (sel) return { fillColor: fill, fillOpacity: op, color: '#1d2433', weight: 2.5, dashArray: null };
  if (mixed) return { fillColor: fill, fillOpacity: op, color: NSC[w.level].color, weight: 2, dashArray: '5 4' };
  return { fillColor: fill, fillOpacity: op, color: '#ffffff', weight: 0.7, dashArray: null };
}
function restyle() { countryLayer?.setStyle(styleFor); }
// every country tooltip says there is more behind a click
const TT_CTA = '<div class="tt-cta">👆 לחצו לכל פרטי המדינה</div>';
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
      <div class="tt-row">🛡️ אנטישמיות: ${adlLine}</div>${TT_CTA}`;
  }
  else if (state.layer === 'temp') {
    const t = state.mouseLL ? tempAt(state.mouseLL) : null;
    extra = t == null ? '' : `🌡️ כאן: ${Math.round(t)}° <small>(ממוצע רב־שנתי ביום)</small>`;
  }
  else { const ev = eventsInRange(p.iso2); extra = ev.length ? ev.map(e => (CAT_ICON[e.cat] || '') + ' ' + e.name).join('<br>') : 'אין אירועים במאגר בתאריכים אלה'; }
  return `<b>${esc(n)}</b>${extra ? `<br><span style="color:#6b7385">${extra}</span>` : ''}${TT_CTA}`;
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
      <div class="sub">60% אזהרת המל״ל (עדכני) + 40% עמדות אנטישמיות (ADL 01/2025). אזהרת רמה 4 → לפחות 80, רמה 3 → לפחות 60.</div>
      <div class="sub legend-note">מדד שלנו, לא ייעוץ · <button class="linkbtn" data-open="about">פרטים</button></div>`;
    L_.innerHTML = `<h4>מדד סיכון ליהודים וישראלים</h4>${seg}${body}`;
  } else if (state.layer === 'temp') {
    const ticks = [-20, -10, 0, 10, 20, 30, 40];
    L_.innerHTML = `<h4>🌡️ כמה חם ביום?</h4>
      <div class="sub" style="margin:0 0 4px">הצבע מראה את הטמפ׳ המקסימלית (בשעות היום) הרגילה בתאריכים שנבחרו:</div>
      <div class="tbar" style="background:linear-gradient(to right, ${ticks.map(t => tempColor(t)).join(', ')})"></div>
      <div class="tticks">${ticks.map(t => `<span>${t}°</span>`).join('')}</div>
      <div class="sub">ממוצע רב־שנתי לתאריכים האלה (NASA POWER, 2001–2020) – לא תחזית. לחיצה על מדינה מציגה גם תחזית או נתוני אמת.</div>`;
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
async function selectCountry(iso2, { zoom = false, point = null, source = 'map' } = {}) {
  const f = state.features[iso2];
  if (!f) return;
  if (iso2 !== state.selected) track('country_open', { country: iso2, source });
  hideIntro();
  state.folds = {};
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
  const g = (state.features[iso2] || state.areas[iso2]).geometry;
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
  if (!map.getSize().x) return;   // a page opened in a background tab has no size yet; flying would throw
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
    <div class="disclaimer">ℹ️ מדד שלנו לפי אזהרות המל״ל ונתוני ADL – לא ייעוץ ולא תחליף לאזהרה הרשמית ·
      <a href="${esc(w?.url || state.nscMeta.url || 'https://www.gov.il/he/departments/news/travel-warnings')}" target="_blank" rel="noopener">לאתר המל״ל</a></div>
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
  return fold('practical', '🧳 מידע מעשי', `<div class="pr-grid">
      ${visaItem(iso2)}
      ${factsItem(iso2)}
      <div class="pr-item" id="prMoney"><h4>💱 מטבע</h4><div class="spinner">טוען…</div></div>
      ${emergencyItem(iso2)}
      <div class="pr-item" id="prDaylight"><h4>🌅 שעות אור</h4><div class="spinner">טוען…</div></div>
      <div class="pr-item" id="prShabbat"><h4>🕯️ שבת וחגים</h4><div class="spinner">טוען…</div></div>
      ${communityItem(iso2)}
      ${powerItem(iso2)}
    </div>
  </div>`);
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
// computed here, not fetched: first and last day of the range
function fillDaylight(pt, tz, token) {
  if (token !== panelToken || !$('#prDaylight')) return;
  if (!pt || !tz) { $('#prDaylight').querySelector('.spinner').textContent = 'אין נתונים'; return; }
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  const hrs = ms => { const min = Math.round(ms / 6e4); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; };
  const line = date => {
    const s = sunTimes(date, pt.lat, pt.lon);
    const body = s.polar ? (s.polar === 'day' ? 'השמש לא שוקעת' : 'השמש לא זורחת')
      : `<b dir="ltr">${clock.format(s.rise)}–${clock.format(s.set)}</b> · ${hrs(s.set - s.rise)} שעות אור`;
    return `<div class="pr-line">${dayLabel(date)}: ${body}</div>`;
  };
  const { from, to } = pd();
  $('#prDaylight').innerHTML = `<h4>🌅 שעות אור${pt.label ? ` · ${esc(pt.label)}` : ''}</h4>
    ${line(from)}${to !== from ? line(to) : ''}
    <div class="meta">זריחה ושקיעה בשעון המקומי</div>`;
}
async function fillShabbat(pt, tz, token) {
  const el = () => token === panelToken && $('#prShabbat');
  if (!pt || !tz) { if (el()) $('#prShabbat').querySelector('.spinner').textContent = 'אין נתונים'; return; }
  try {
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&s=on&c=on&M=on&lg=he&geo=pos&latitude=${pt.lat.toFixed(3)}&longitude=${pt.lon.toFixed(3)}&tzid=${encodeURIComponent(tz)}&start=${pd().from}&end=${pd().to}`;
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
// the system's own share symbol: Apple's box with an arrow on iPhone / iPad / Mac, the three linked dots elsewhere
const SHARE_ICON = `<svg class="share-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
  /iPhone|iPad|Macintosh/.test(navigator.userAgent)
    ? '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1"/>'
    : '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 13.3l7.4 4.4M15.7 6.3l-7.4 4.4"/>'}</svg>`;
$('#fShare').innerHTML = SHARE_ICON;
async function shareCountry(iso2) {
  // the country only: an open finder's search is not part of it
  const h = new URLSearchParams(location.hash.slice(1));
  for (const k of ['ft', 'fd', 'fr', 'fv', 'fe']) h.delete(k);
  h.set('from', pd().from); h.set('to', pd().to);   // the dates shown in the panel, even when changed there only
  const name = nameHe(iso2, iso2), url = `${location.origin}${location.pathname}#${h}`;
  const text = `${name} · ${dmy(pd().from)}–${dmy(pd().to)} · מפת מטיילים`;
  if (navigator.share) {
    try { await navigator.share({ title: `מפת מטיילים – ${name}`, text, url }); track('share_country', { country: iso2, method: 'native' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('הדפדפן לא תומך בשיתוף ישיר – הקישור הועתק'); track('share_country', { country: iso2, method: 'copy' }); }
  catch { prompt('העתיקו את הקישור:', url); }
}
// The browser's own "Save as PDF" keeps real text (selectable, searchable) and handles Hebrew/RTL correctly,
// unlike canvas-based PDF libraries.
async function exportPdf(iso2) {
  track('pdf_download', { country: iso2 });
  for (let i = 0; i < 25 && $('#panelBody .spinner'); i++) await new Promise(r => setTimeout(r, 300));   // let async sections finish
  document.querySelector('.print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.dir = 'rtl';
  sheet.innerHTML = `<div class="pdf-head"><div class="pdf-brand">🌍 מפת מטיילים</div>
      <div class="pdf-meta">${dmy(pd().from)} – ${dmy(pd().to)} · הופק ב־${dmy(today())}</div></div>
    ${$('#panelBody').innerHTML}
    <div class="pdf-foot" dir="ltr">${esc(location.href)}</div>`;
  sheet.querySelectorAll('.p-actions, .trip, button, details.how').forEach(n => n.remove());
  sheet.querySelectorAll('details').forEach(d => { d.open = true; });
  document.body.appendChild(sheet);
  const title = document.title;
  document.title = `${nameHe(iso2, iso2)} ${dmy(pd().from)} – מפת מטיילים`;   // default PDF file name
  const done = () => { document.title = title; sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  toast('בחלון ההדפסה בחרו "שמירה כ־PDF"', 5000);
  setTimeout(() => window.print(), 50);
}

// great-circle distance from Ben Gurion airport to the capital; flying time ≈ distance at ~800 km/h + half an hour
const TLV = { lat: 32.01, lon: 34.89 };
function flightLine(iso2) {
  const cap = iso2 !== 'IL' && repPoint(iso2);
  if (!cap) return '';
  const km = kmBetween(TLV, cap), hours = Math.max(1, Math.round((km / 800 + 0.5) * 2) / 2);
  return `<dt>מרחק טיסה</dt><dd>כ־${fmtNum.format(Math.round(km / 50) * 50)} ק״מ מתל אביב · כ־${hours} שעות</dd>`;
}
function factsItem(iso2) {
  const i = state.info[iso2];
  if (!i) return `<div class="pr-item"><h4>ℹ️ פרטים כלליים</h4><div class="empty">אין נתונים</div></div>`;
  const langNames = new Intl.DisplayNames(['he'], { type: 'language' });
  const langs = Object.entries(i.languages || {}).map(([code, en]) => { try { const n = langNames.of(code); return n && n !== code ? n : en; } catch { return en; } });
  const curNames = new Intl.DisplayNames(['he'], { type: 'currency' });
  const cur = Object.entries(i.currencies || {}).map(([code, c]) => { let n; try { n = curNames.of(code); } catch {} return `${n && n !== code ? n : c.name} (${c.symbol || code})`; });
  const caps = capitalsHe(iso2);
  return `<div class="pr-item"><h4>ℹ️ פרטים כלליים</h4><dl class="facts">
    ${caps.length ? `<dt>בירה</dt><dd>${esc(caps.join(', '))}</dd>` : ''}
    ${i.pop ? `<dt>אוכלוסייה</dt><dd>${fmtNum.format(i.pop)} <small style="color:#6b7385">(${i.popYear})</small></dd>` : ''}
    ${langs.length ? `<dt>שפות</dt><dd>${esc(langs.join(', '))}</dd>` : ''}
    ${cur.length ? `<dt>מטבע</dt><dd>${esc(cur.join(', '))}</dd>` : ''}
    ${i.region ? `<dt>אזור</dt><dd>${esc(REGION_HE[i.region] || i.region)}</dd>` : ''}
    ${flightLine(iso2)}
    <dt>שעה מקומית</dt><dd id="localTime">–</dd>
  </dl></div>`;
}

// a collapsible panel section; every country opens with all sections open (kept while re-rendering the same one)
function fold(id, title, body) {
  return `<details class="card fold" data-fold="${id}" ${state.folds[id] === false ? '' : 'open'}>
    <summary><h3 id="${id}Title">${title}</h3></summary><div id="${id}Body">${body}</div></details>`;
}
$('#panelBody').addEventListener('toggle', e => {   // 'toggle' doesn't bubble: listen in the capture phase
  const id = e.target.dataset?.fold; if (!id) return;
  state.folds[id] = e.target.open;
}, true);
function eventsCard(iso2) {
  const ev = eventsInRange(iso2, pd().from, pd().to);
  return fold('ev', '🎉 אירועים עונתיים', `${ev.length ? `<ul class="list">${ev.map(e =>
    `<li>${CAT_ICON[e.cat] || ''} ${esc(e.name)} <small>${CAT_NAME[e.cat] || ''} · ${esc(e.city)} · ${dmy(e.start)} – ${dmy(e.end)}${e.approx ? ' (תאריך משוער)' : ''}</small></li>`).join('')}</ul>`
    : '<div class="empty">אין אירועים במאגר בתאריכים אלה</div>'}
    <div class="meta">מאגר אירועים מקומי (data/events.json) · תאריכים משוערים יש לאמת באתר האירוע</div>`);
}

let panelToken = 0;
// ---------- trip: flights (Skyscanner) & hotels (Booking) to a city ----------
// Affiliate IDs go here once approved; with them empty the links are plain links.
const AFFILIATE = {
  bookingAid: '',     // Booking.com affiliate id (aid)
  skyscannerWrap: '', // tracking-link template from Skyscanner's partner programme, with {url} for the target
};
const yymmdd = d => d.slice(2).replace(/-/g, '');
// destination choices: the country's biggest cities and its tourist spots (data/destinations.json);
// the default is the searched/clicked place, else the capital
function tripCities(iso2) {
  const spots = state.dests.filter(c => c[2] === iso2);
  const spotNames = new Set(spots.map(c => c[1]));
  const all = [...state.cities.filter(c => c[2] === iso2 && !spotNames.has(c[1])), ...spots];
  const cities = all.filter(c => !spots.includes(c)).slice(0, spots.length ? 6 : 8);
  const near = (lat, lon, km) => {
    let best = null, bestKm = km;
    for (const c of all) {
      if (Math.abs(c[3] - lat) > 1 || Math.abs(c[4] - lon) > 1.5) continue;
      const d = kmBetween({ lat, lon }, { lat: c[3], lon: c[4] });
      if (d < bestKm) { bestKm = d; best = c; }
    }
    return best;
  };
  const pt = state.point, cap = state.info[iso2]?.cap;
  let dest = state.trip?.iso2 === iso2 && state.trip.point === pt ? state.trip.city : null;
  dest ||= (pt && pt.label !== 'מרכז המדינה' && near(pt.lat, pt.lon, 60)) || (cap && near(cap[0], cap[1], 40)) || cities[0] || spots[0];
  if (dest && !cities.includes(dest) && !spots.includes(dest)) cities.unshift(dest);
  return { cities, spots, dest };
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
  const { from, to: back } = pd(), to = back > from ? back : addDays(from, 1);
  const iata = city && ((typeof city[5] === 'string' && city[5]) || MAIN_AIRPORT[city[1]] || (state.airports && nearestAirport(city[3], city[4], iso2)));
  let flights = `https://www.skyscanner.co.il/transport/flights/tlv/${(iata || iso2).toLowerCase()}/${yymmdd(from)}/${yymmdd(back)}/`;
  if (AFFILIATE.skyscannerWrap) flights = AFFILIATE.skyscannerWrap.replace('{url}', encodeURIComponent(flights));
  const q = new URLSearchParams({ ss: city ? `${city[1]}, ${state.features[iso2].properties.en}` : state.features[iso2].properties.en,
    checkin: from, checkout: to, group_adults: 2, no_rooms: 1, group_children: 0 });
  if (AFFILIATE.bookingAid) q.set('aid', AFFILIATE.bookingAid);
  return { flights, hotels: `https://www.booking.com/searchresults.he.html?${q}`, iata };
}
function tripRow(iso2) {
  if (iso2 === 'IL' || !state.cities.length) return '';
  const { cities, spots, dest } = tripCities(iso2);
  const list = [...cities, ...spots];
  state.trip = { iso2, point: state.point, city: dest, list };
  const l = tripLinks(iso2, dest);
  const opts = (arr, offset) => arr.map((c, i) => `<option value="${i + offset}"${c === dest ? ' selected' : ''}>${esc(c[0])}</option>`).join('');
  const select = spots.length
    ? `<optgroup label="ערים">${opts(cities, 0)}</optgroup><optgroup label="יעדי תיירות">${opts(spots, cities.length)}</optgroup>`
    : opts(cities, 0);
  return `<div class="trip">
    <label><span class="pin">📍</span> חופשה ב־<select id="tripCity" aria-label="יעד">${select}</select></label>
    <span class="trip-btns">
      <a id="tripFlights" href="${esc(l.flights)}" target="_blank" rel="noopener sponsored">✈️ טיסות</a>
      <a id="tripHotels" href="${esc(l.hotels)}" target="_blank" rel="noopener sponsored">🏨 מלונות</a>
    </span>
    ${AFFILIATE.bookingAid || AFFILIATE.skyscannerWrap ? '<div class="meta">קישורי שותפים: ייתכן שנקבל עמלה, בלי עלות נוספת לכם</div>' : ''}
  </div>`;
}
// cities and airports load after the first paint: fill in a panel that is already open
function refreshTrip() {
  const iso2 = state.selected;
  if (!iso2 || $('#panel').hidden) return;
  const old = $('#panelBody .trip');
  if (old) old.outerHTML = tripRow(iso2);
  else $('#panelBody .p-actions')?.insertAdjacentHTML('afterend', tripRow(iso2));
}
// flights / hotels clicks (the links open the booking site in a new tab)
$('#panelBody').addEventListener('click', e => {
  const a = e.target.closest('#tripFlights, #tripHotels');
  if (!a || !state.trip) return;
  const c = state.trip.city, props = { country: state.trip.iso2, city: c?.[1] || null };
  if (a.id === 'tripFlights') track('flight_click', { ...props, airport: tripLinks(state.trip.iso2, c).iata || null });
  else track('hotel_click', props);
});
$('#panelBody').addEventListener('change', e => {
  if (e.target.id !== 'tripCity' || !state.trip) return;
  // the chosen destination's own information: weather, daylight, Shabbat times, local time
  const c = state.trip.city = state.trip.list[+e.target.value];
  showPoint({ lat: c[3], lon: c[4], label: c[0], clicked: true }, { keepTrip: true });
});
// show the panel's information for another place in the same country. keepTrip: the trip row keeps its choice
// (the destination was just picked there); otherwise it moves to the place, like a click on the map (see tripCities)
function showPoint(point, { keepTrip = false } = {}) {
  state.point = point;
  if (state.trip && keepTrip) state.trip.point = point;
  pointMarker.setLatLng([point.lat, point.lon]).addTo(map);
  renderPanel();
}

// a long country name gets a smaller font, so it fits beside the dates in two lines at most
const nameCls = n => n.length > 14 ? ' class="long"' : n.length > 7 ? ' class="mid"' : '';
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
      <div><h2${nameCls(nameHe(iso2, p.he || p.en))}>${esc(nameHe(iso2, p.he || p.en))}</h2><div class="en">${esc(p.en)}</div></div>
      <div class="p-dates${state.pdates ? ' custom' : ''}">
        <input id="pDates" readonly aria-label="תאריכים למדינה זו" title="שינוי התאריכים למדינה זו בלבד">
        <svg class="pencil" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.7 1.3a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L5.4 13.6 1.5 14.5l.9-3.9 9.3-9.3zM3.5 11.2l-.4 1.7 1.7-.4 7.6-7.6-1.3-1.3-7.6 7.6z"/></svg>
        ${state.pdates ? '<button class="p-dates-reset" data-act="pdreset" title="חזרה לתאריכי המפה">↺</button>' : ''}
      </div>
    </div>
    <div class="p-actions">
      <button data-act="zoom">🔍 התקרבו למדינה</button>
      <button data-act="share">${SHARE_ICON} שיתוף</button>
      <button data-act="pdf">📄 הורדה כ־PDF</button>
    </div>
    ${tripRow(iso2)}
    ${riskCard(iso2)}
    ${nscNote(iso2)}
    ${fold('wx', `🌤️ מזג אוויר${pt?.label ? ` · ${esc(pt.label)}` : ''}`, '<div class="spinner">טוען…</div>')}
    ${fold('hol', '📅 חגים רשמיים', '<div class="spinner">טוען…</div>')}
    ${eventsCard(iso2)}
    ${practicalSection(iso2)}
    <button class="linkbtn fb-link" data-open="feedback" data-from="panel" data-country="${iso2}">משהו לא מדויק כאן? ספרו לנו</button>`;

  setupPanelDates();
  // weather
  fillMoney(iso2, token);
  // the time zone comes from a local table, so Shabbat times, daylight and local time do not wait for the weather
  const tz = pt && tzFor(iso2, pt.lat, pt.lon);
  fillShabbat(pt, tz, token);
  fillDaylight(pt, tz, token);
  if (tz && $('#localTime')) try { $('#localTime').textContent = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); } catch {}
  if (!pt) $('#wxBody').innerHTML = '<div class="empty">אין נתונים</div>';
  // the weather service (forecast, or the same dates last year); if it is unavailable, the multi-year normal of
  // every day from local data, so this section always shows something
  if (pt) countryWeather(pt).catch(async e => {
    console.error(e);
    const [days] = await normalWeather([pt], pd());
    if (!days) throw e;
    track('weather_fallback', { reason: /429|quota/.test(e.message) ? 'quota' : 'error' });
    return { plan: { kind: 'normal', limit: /429|quota/.test(e.message) }, days };
  }).then(({ plan, days }) => {
    if (token !== panelToken) return;
    const isNormal = plan.kind === 'normal';
    const hi = avg(days.map(d => d.hi)), lo = avg(days.map(d => d.lo)), rainAvg = avg(days.map(d => d.rain));
    const rainy = days.filter(d => d.rain >= 1).length;
    const note = isNormal ? 'ממוצע רב־שנתי לכל יום · NASA POWER 2001–2020'
      : plan.kind === 'estimate' ? 'הערכה: אותם תאריכים בשנה שעברה (מעבר לטווח התחזית של 16 יום) · Open-Meteo'
      : plan.kind === 'actual' ? 'נתונים היסטוריים בפועל · Open-Meteo' : 'תחזית · Open-Meteo';
    // the multi-year normal for the same dates: what the heat map and the finder go by
    const normal = isNormal ? null : avg(normalDays(pt.lat, pt.lon, pd().from, pd().to) || []);
    // the weather service did not answer: say so, and that these are the map's own multi-year normals
    $('#wxBody').innerHTML = `${isNormal ? `<div class="wx-limit">⚠️ התחזית לא נטענה כרגע${plan.limit ? ' (הגענו למגבלת הבקשות של שירות מזג האוויר)' : ''}. מוצגים הממוצעים הרב־שנתיים לתאריכים האלה, מהנתונים שעליהם בנויה המפה · <button class="linkbtn" data-act="wxretry">לנסות שוב</button></div>` : ''}
      <div class="wxsum"><span>מקס׳ <b class="hi">${Math.round(hi)}°</b></span>${lo != null ? `<span>מינ׳ <b class="lo">${Math.round(lo)}°</b></span>` : ''}${isNormal
        ? (rainAvg != null ? `<span>משקעים <b>${rainAvg.toFixed(1)}</b> מ״מ ליום</span>` : '') : `<span>ימי גשם <b>${rainy}</b>/${days.length}</span>`}</div>
      ${normal != null ? `<div class="wx-normal">ממוצע רב־שנתי לתאריכים האלה: מקס׳ <b>${Math.round(normal)}°</b> <small>(לפיו המפה ומאתר היעדים)</small></div>` : ''}
      <div id="citiesWx"></div>
      <table class="wx"><tr><th>יום</th><th></th><th>מקס׳</th><th>מינ׳</th><th>משקעים</th></tr>
      ${days.map((d, k) => { const [ic, t] = WX(d.code); return `<tr${k >= 6 ? ' class="more"' : ''}><td>${dayLabel(d.date)}</td><td title="${t}">${ic}</td>
        <td>${d.hi == null ? '–' : `<span class="tchip" style="background:${tempColor(d.hi)}">${Math.round(d.hi)}°</span>`}</td>
        <td>${d.lo == null ? '–' : `<span class="tchip tchip-lo" style="${tempChipLo(d.lo)}">${Math.round(d.lo)}°</span>`}</td>
        <td>${d.rain == null ? '–' : d.rain.toFixed(1) + ' מ״מ'}</td></tr>`; }).join('')}</table>
      ${days.length > 6 ? `<button class="linkbtn wx-more" data-act="wxmore">עוד ${days.length - 6} ימים ▾</button>` : ''}
      <div class="meta">${note}</div>`;
    loadCitiesWx(iso2, token);
  }).catch(e => {
    console.error(e);
    if (token !== panelToken || !$('#wxBody .spinner')) return;
    $('#wxBody').innerHTML = `<div class="empty">לא הצלחנו לטעון מזג אוויר · <button class="linkbtn" data-act="wxretry">לנסות שוב</button></div>`;
  });

  // holidays
  holidays(iso2).catch(e => { console.error(e); return 'error'; }).then(list => {
    if (token !== panelToken) return;
    if (list === 'error') { $('#holBody').innerHTML = '<div class="empty">לא הצלחנו לטעון חגים כרגע</div>'; return; }
    const body = list == null ? '<div class="empty">אין נתוני חגים למדינה זו במקור</div>'
      : list.length ? `<ul class="list">${list.map(h => {
        const when = h.end && h.end !== h.date ? `${dmy(h.date)} – ${dmy(h.end)}` : dmy(h.date);
        return `<li>${esc(h.localName)}${h.localName !== h.name ? ` <small>${esc(h.name)} · ${when}</small>` : ` <small>${when}</small>`}</li>`;
      }).join('')}</ul>`
      : '<div class="empty">אין חגים רשמיים בתאריכים אלה</div>';
    $('#holBody').innerHTML = `${body}<div class="meta">${iso2 === 'IL' ? 'Hebcal' : 'Nager.Date'}</div>`;
  });
}

// the panel's own date range: changes this country's information only, not the map
let pfp;
function setupPanelDates() {
  pfp?.destroy();
  const { from, to } = pd();
  pfp = flatpickr('#pDates', {
    mode: 'range', dateFormat: 'd/m/y', disableMobile: true, static: true, monthSelectorType: 'static',
    locale: { ...flatpickr.l10ns.he, rangeSeparator: ' – ' }, defaultDate: [parse(from), parse(to)],
    onReady: (_, __, inst) => setupMonthPicker(inst),
    onOpen: (_, __, inst) => {
      // keep the calendar inside the panel (on a phone it would run past the screen's edge)
      const cal = inst.calendarContainer, box = $('#panel').getBoundingClientRect();
      cal.style.left = '0px';
      const r = cal.getBoundingClientRect();
      const shift = Math.max(box.left + 8 - r.left, Math.min(0, box.right - 8 - r.right));
      if (shift) cal.style.left = `${shift}px`;
    },
    onClose: (sel, _, inst) => {
      if (!sel.length) return inst.setDate([parse(from), parse(to)], false);
      // one date picked: the trip moves to start on it and keeps its length
      let f = iso(sel[0]), t = sel[1] ? iso(sel[1]) : addDays(f, daysBetween(from, to));
      if (daysBetween(f, t) > MAX_DAYS - 1) { t = addDays(f, MAX_DAYS - 1); toast(`טווח מקסימלי: ${MAX_DAYS} ימים`); }
      if (f === from && t === to) return;
      state.pdates = f === state.from && t === state.to ? null : { from: f, to: t };
      setTimeout(renderPanel);   // not from inside the picker's own callback: renderPanel destroys it
    },
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
  if (act === 'pdreset') { state.pdates = null; renderPanel(); }
  if (act === 'wxretry') renderPanel();
  if (act === 'wxmore') { e.target.closest('[data-fold]').querySelector('table.wx:not(.cities)').classList.add('all'); e.target.remove(); }
  if (act === 'share') shareCountry(state.selected);
  if (act === 'pdf') exportPdf(state.selected);
});
function closePanel() {
  $('#panel').hidden = true; state.selected = null; state.pdates = null; pointMarker.remove(); restyle(); saveHash();
  resetPageZoom();
}
$('#close').addEventListener('click', closePanel);

// ---------- first visit: what a click on a country opens ----------
function hideIntro() {
  if ($('#intro').hidden) return;
  $('#intro').hidden = true;
  try { localStorage.setItem('tm-intro', '1'); } catch {}
}
try { if (!localStorage.getItem('tm-intro')) $('#intro').hidden = false; } catch { $('#intro').hidden = false; }
$('#introOk').addEventListener('click', hideIntro);

// ---------- about & privacy / feedback window ----------
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  $('#modal .m-card').scrollTop = 0;
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('.m-close')) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

function aboutHTML() {
  return `<h3>🌍 על מפת מטיילים</h3>
    <p>מפה למטיילים ישראלים ויהודים: לכל מדינה מדד סיכון, מזג אוויר לתאריכים שלכם, ויזה לדרכון ישראלי, זמני שבת וחגים,
      אירועים ומידע מעשי, ומאתר יעדים לפי טמפרטורה וסיכון. השימוש חינמי.</p>
    <h4>🧭 מדד הסיכון</h4>
    <p>המדד הוא חישוב שלנו: 60% אזהרת המסע העדכנית של <a href="${esc(state.nscMeta.url || 'https://www.gov.il/he/departments/news/travel-warnings')}" target="_blank" rel="noopener">המל״ל</a>
      ו־40% שיעור העמדות האנטישמיות לפי סקר ADL. הוא לא ייעוץ ולא תחליף לאזהרת המסע הרשמית –
      לפני נסיעה בדקו תמיד את אזהרת המל״ל המלאה. המידע באתר (מזג אוויר, ויזה, אירועים, זמנים) נאסף ממקורות ציבוריים,
      ייתכנו בו טעויות, ואין לראות בו ייעוץ מכל סוג.</p>
    <h4>🔒 פרטיות</h4>
    <ul>
      <li>אנחנו מודדים שימוש באתר בעזרת PostHog: אילו דפים ואפשרויות נפתחו (למשל איזו מדינה, לחיצה על טיסות), באיזה מכשיר ודפדפן.
        כתובת ה־IP משמשת רק לזיהוי מדינה ועיר משוערות, ולא נשמרת.</li>
      <li>כדי לדעת אם חזרתם לאתר, נשמר בדפדפן מזהה אקראי (עוגייה ואחסון מקומי). הוא לא מזהה אתכם אישית.</li>
      <li>לא נאספים שם, מייל, טלפון או מיקום מדויק. אין הקלטה של הגלישה ואין פרסומות.</li>
      <li>הדפדפן שומר אצלכם העדפות (למשל אם ראיתם את ההסבר) ותוצאות מזג אוויר לזמן קצר, כדי שהאתר ייטען מהר.</li>
      <li>כדי להציג מפות, מזג אוויר, חגים ושערי מטבע, הדפדפן פונה ישירות לשירותים ציבוריים (למשל OpenStreetMap, Open-Meteo, Hebcal),
        שרואים את כתובת ה־IP כמו בכל גלישה.</li>
      <li>מה שתכתבו בטופס המשוב נשמר כדי שנוכל לקרוא אותו – אל תכתבו בו פרטים אישיים.</li>
    </ul>
    <h4>💬 יצירת קשר</h4>
    <p>הערות, טעויות או רעיונות – <button class="linkbtn" data-open="feedback">כתבו לנו</button>.</p>
    <div class="meta">נתונים: המל״ל · ADL · Open-Meteo · NASA POWER · Hebcal · Nager.Date · OpenStreetMap · Esri</div>`;
}

// feedback is sent to the site's analytics (PostHog) as a 'feedback' event; nothing in the page says where it goes
function feedbackHTML(iso2) {
  const about = iso2 && state.features[iso2] ? nameHe(iso2, iso2) : '';
  return `<h3>💬 משוב</h3>
    <form id="fbForm" data-country="${iso2 || ''}">
      ${about ? `<div class="fb-about">על: <b>${esc(about)}</b></div>` : ''}
      <div class="fb-mood" role="radiogroup" aria-label="איך האתר?">
        <label><input type="radio" name="mood" value="good"> 👍 עוזר לי</label>
        <label><input type="radio" name="mood" value="bad"> 👎 משהו לא עובד / לא מדויק</label>
      </div>
      <textarea id="fbText" maxlength="1000" rows="5" placeholder="${about ? `מה לא מדויק ב${esc(about)}? מה היית רוצה לראות?` : 'מה עבד, מה חסר, מה לא מדויק?'}"></textarea>
      <div class="meta">בלי פרטים אישיים, בבקשה.</div>
      <button type="submit" class="fb-send">שליחה</button>
    </form>`;
}
function openFeedback(iso2, from) {
  openModal(feedbackHTML(iso2));
  $('#fbForm').dataset.from = from;
  setTimeout(() => $('#fbText')?.focus(), 50);
}
$('#modalBody').addEventListener('submit', e => {
  if (e.target.id !== 'fbForm') return;
  e.preventDefault();
  const f = e.target, text = $('#fbText').value.trim(), mood = f.querySelector('[name=mood]:checked')?.value || null;
  if (!text && !mood) { toast('כתבו כמה מילים או בחרו 👍 / 👎'); return; }
  // without the analytics library (an ad blocker) the message cannot be sent: say so instead of losing it
  if (!window.posthog?.capture) { toast('לא הצלחנו לשלוח – ייתכן שחוסם פרסומות חוסם את הטופס', 4500); return; }
  track('feedback', { text: text.slice(0, 1000), mood, country: f.dataset.country || null, from: f.dataset.from || 'site' });
  closeModal();
  toast('תודה! קיבלנו 🙏');
});
// every [data-open] in the page: the corner links, the intro card, the top-bar button, the card and finder links
document.addEventListener('click', e => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  e.preventDefault();
  if (b.dataset.open === 'about') { openModal(aboutHTML()); track('about_open'); }
  if (b.dataset.open === 'feedback') openFeedback(b.dataset.country || null, b.dataset.from || 'site');
}, true);   // capture: Leaflet stops clicks in its credits corner from bubbling

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
  // tourist spots first, then cities (state.cities is sorted by population, so the biggest come first)
  const hit = c => wordStart(c[0], t) || wordStart(c[1], t);
  const spots = state.dests.filter(hit), names = new Set(spots.map(c => c[1]));
  return [...spots.map(c => ['🏝️', c]), ...state.cities.filter(c => hit(c) && !names.has(c[1])).map(c => ['🏙️', c])]
    .slice(0, 5).map(([icon, [he, en, iso2, lat, lon]]) => ({ icon, title: he, sub: `${en} · ${nameHe(iso2, iso2)}`, lat, lon, zoom: 11, iso2 }));
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
    if (state.features[it.iso2]) return selectCountry(it.iso2, { zoom: true, source: 'search' });
    if (it.bounds) return map.flyToBounds(it.bounds, { maxZoom: 6 });
    return;
  }
  if (it.bounds) map.flyToBounds(it.bounds, { maxZoom: 16, duration: 1 });
  else map.flyTo([it.lat, it.lon], it.zoom || 15, { duration: 1 });
  searchMarker = L.marker([it.lat, it.lon]).addTo(map).bindPopup(`<b>${esc(it.title)}</b><br><small>${esc(it.sub)}</small>`).openPopup();
  if (state.features[it.iso2]) selectCountry(it.iso2, { point: { lat: it.lat, lon: it.lon, label: it.title }, source: 'search' });
}

// ---------- dates ----------
function setDates(from, to, { silent = false } = {}) {
  if (to < from) to = from;
  if (daysBetween(from, to) > MAX_DAYS - 1) { to = addDays(from, MAX_DAYS - 1); if (!silent) toast(`טווח מקסימלי: ${MAX_DAYS} ימים`); }
  state.from = from; state.to = to; state.pdates = null;
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
    panel.innerHTML = `<div class="mp-year"><button data-y="1" aria-label="שנה הבאה">‹</button><b>${year}</b><button data-y="-1" aria-label="שנה קודמת">›</button></div>
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
$$('.layers button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.layer !== state.layer) track('layer_change', { layer: b.dataset.layer });
  setLayer(b.dataset.layer);
}));

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
// Normal daily highs (data/climate.json, the same numbers as the heat map) for every day of the range, at each
// country's capital, its other main cities in big countries, and its tourist spots (data/destinations.json)
async function loadCountryTemps() {
  const key = `${state.from}_${state.to}`;
  if (state.ctemps?.key === key) return state.ctemps.temps;
  await climateReady;
  if (!climate) throw new Error('no climate data');
  const temps = {};
  const add = (c, lat, lon, label, capital = false) => {
    const his = normalDays(lat, lon, state.from, state.to);
    if (his) (temps[c] ||= []).push({ label, his, capital });
  };
  for (const c of [...Object.keys(state.features), ...Object.keys(state.areas)]) {
    const cap = repPoint(c);
    if (!cap) continue;
    add(c, cap.lat, cap.lon, cap.label, true);
    const b = mainBounds(c);
    const diag = kmBetween({ lat: b.getSouth(), lon: b.getWest() }, { lat: b.getNorth(), lon: b.getEast() });
    if (diag > 1500) for (const x of spreadCities(c)) if (kmBetween(x, cap) > 150) add(c, x.lat, x.lon, x.he);
  }
  for (const [he, , c, lat, lon] of state.dests) add(c, lat, lon, he);
  state.ctemps = { key, temps };
  return temps;
}
// share of the days whose normal high is within the range; the country takes its best place (capital on a tie)
const DAYS_NEEDED = { any: d => d > 0, most: d => d >= 0.5, all: d => d === 1 };
function tempMatch(places, f) {
  let best = null;
  for (const p of places || []) {
    const share = p.his.filter(t => t >= f.tmin && t <= f.tmax).length / p.his.length;
    if (!best || share > best.share) best = { label: p.label, capital: p.capital, share, lo: Math.min(...p.his), hi: Math.max(...p.his) };
  }
  return best && DAYS_NEEDED[f.days](best.share) ? best : null;
}
function readFinder() {
  return {
    tempOn: $('#fTempOn').checked, tmin: +$('#fTmin').value, tmax: +$('#fTmax').value, days: $('#fDays').value, risk: +$('#fRisk').value,
    visa: $('#fVisa').checked, events: $('#fEvents').checked,
  };
}
let finderSeq = 0;
const FINDER_SHORT = 15;   // results shown before 'show all'
async function runFinder() {
  if (!state.finder) return;
  const f = state.finder = readFinder(), seq = ++finderSeq;
  let temps = null;
  if (f.tempOn) {
    try { temps = await loadCountryTemps(); }
    catch { $('#fResults').innerHTML = '<div class="empty">לא הצלחנו לטעון את נתוני האקלים. רעננו את הדף.</div>'; return; }
    if (seq !== finderSeq || !state.finder) return;
  }
  // first failing criterion per country, so we can explain why countries with events were left out
  const REASON = { risk: 'מדד סיכון', temp: 'טמפרטורה', visa: 'ויזה' };
  const failOf = (iso2, r, t) => {
    if (f.risk <= 100 && (!r || r.score >= f.risk)) return 'risk';   // 'all' also keeps countries without a score
    if (f.tempOn && !t) return 'temp';
    if (f.visa && !visaOk(state.practical[iso2]?.visa)) return 'visa';
    return null;
  };
  const hits = [], eventFails = {};
  let withEvents = 0;
  for (const iso2 of [...Object.keys(state.features), ...Object.keys(state.areas)]) {
    if (iso2 === 'AQ') continue;
    const r = riskOf(iso2), t = temps ? tempMatch(temps[iso2], f) : null, ev = eventsInRange(iso2);
    if (f.events && !ev.length) continue;
    if (f.events) withEvents++;
    const fail = failOf(iso2, r, t);
    if (fail) { if (f.events) eventFails[fail] = (eventFails[fail] || 0) + 1; continue; }
    hits.push({ iso2, r, t, ev });
  }
  // best temperature fit first (share of days in range), then lower risk, then bigger countries
  // (otherwise dozens of micro-states with a 0 score lead the list)
  hits.sort((a, b) => (b.t?.share ?? 0) - (a.t?.share ?? 0) || (a.r?.bucket ?? 5) - (b.r?.bucket ?? 5)
    || (state.info[b.iso2]?.pop || 0) - (state.info[a.iso2]?.pop || 0));
  finderMatches = new Set(hits.map(h => h.iso2));
  state.finderHits = hits;
  restyle();
  saveHash();   // the link carries the search, so it can be shared
  // with the events filter on, show the matching countries' event markers on the map
  if (f.events) { drawEventMarkers(finderMatches); eventLayer.addTo(map); }
  else if (state.layer !== 'events') eventLayer.remove();
  else drawEventMarkers();
  const why = f.events && withEvents > hits.length
    ? `<div class="f-why">מתוך ${withEvents} מדינות עם אירועים בתאריכים, נפסלו: ${Object.entries(eventFails).map(([k, n]) => `${n} בגלל ${REASON[k]}`).join(' · ')}</div>` : '';
  $('#fResults').innerHTML = `<div class="f-count">${hits.length ? `נמצאו <b>${hits.length}</b> יעדים` : 'לא נמצאו יעדים – נסו להרחיב את הסינון'}</div>${why}
    <ul class="f-list${state.finderAll ? '' : ' short'}">${hits.map(h => `<li data-iso="${h.iso2}">
      <span>${esc(nameHe(h.iso2, (state.features[h.iso2] || state.areas[h.iso2]).properties.he || (state.features[h.iso2] || state.areas[h.iso2]).properties.en))}${f.events ? `<small class="f-ev">${h.ev.map(e => `${CAT_ICON[e.cat] || ''} ${esc(e.name)}`).join(' · ')}</small>` : ''}</span>
      ${h.t ? `${h.t.capital ? '' : `<span class="f-city">${esc(h.t.label)}</span>`}<span class="tchip" dir="ltr" style="background:${tempColor((h.t.lo + h.t.hi) / 2)}">${Math.round(h.t.lo) === Math.round(h.t.hi) ? '' : `${Math.round(h.t.lo)}–`}${Math.round(h.t.hi)}°</span>` : ''}
      ${h.r ? `<span class="rchip" style="background:${h.r.color}33;color:${darkText(h.r.color)}">${h.r.score}</span>` : '<span class="rchip">–</span>'}</li>`).join('')}</ul>
    ${hits.length > FINDER_SHORT && !state.finderAll ? `<button class="linkbtn f-more" data-more>הצג את כל ${hits.length} היעדים</button>` : ''}
    <button class="linkbtn fb-link" data-open="feedback" data-from="finder">לא מצאתם מה שחיפשתם? ספרו לנו</button>`;
}
function openFinder(open) {
  $('#finder').hidden = !open;
  document.body.classList.toggle('finder-open', open);
  $('#finderBtn').classList.toggle('on', open);
  if (open) {
    track('finder_open');
    state.finder = readFinder();
    runFinder();
  } else {
    state.finder = null; state.finderAll = false; finderMatches = new Set(); restyle(); saveHash();   // reopened: top 15 again
    if (state.layer === 'events') drawEventMarkers(); else eventLayer.remove();
  }
}
$('#finderBtn').addEventListener('click', () => {
  if (state.finder && $('#finder').hidden) { $('#finder').hidden = false; document.body.classList.add('finder-open'); }  // minimised → show again
  else openFinder($('#finder').hidden);
});
$('#fMap').addEventListener('click', () => { $('#finder').hidden = true; document.body.classList.remove('finder-open'); });
$('#fClose').addEventListener('click', () => openFinder(false));
$('#fShare').addEventListener('click', shareFinder);

// share the search: a short Hebrew message with the top results, then the link that reopens the same search
const FINDER_SHARE_TOP = 5;
async function shareFinder() {
  const f = state.finder, hits = state.finderHits || [];
  if (!f) return;
  const name = iso2 => nameHe(iso2, (state.features[iso2] || state.areas[iso2]).properties.he || (state.features[iso2] || state.areas[iso2]).properties.en);
  const deg = t => Math.round(t.lo) === Math.round(t.hi) ? `${Math.round(t.hi)}°` : `${Math.round(t.lo)}–${Math.round(t.hi)}°`;
  const DAYS = { any: 'לפחות ביום אחד', most: 'ברוב הימים', all: 'בכל הימים' };
  const filters = [
    f.tempOn && `${f.tmin}°–${f.tmax}° ${DAYS[f.days]}`,
    f.risk <= 100 ? `סיכון ${$('#fRisk').selectedOptions[0].textContent}` : null,
    f.visa && 'בלי ויזה מראש', f.events && 'עם אירוע בתאריכים',
  ].filter(Boolean);
  // the place the temperature is for, as in the list (a city or tourist spot when it is not the capital)
  const top = hits.slice(0, FINDER_SHARE_TOP).map(h => `${name(h.iso2)}${h.t ? `${h.t.capital ? '' : ` (${h.t.label})`} ${deg(h.t)}` : ''}`);
  const more = hits.length > FINDER_SHARE_TOP ? ` (ועוד ${hits.length - FINDER_SHARE_TOP})` : '';
  const text = `🎯 יעדים ל־${dmy(state.from).slice(0, 5)}–${dmy(state.to)}${filters.length ? ` · ${filters.join(' · ')}` : ''}:\n`
    + (top.length ? `${top.join(' · ')}${more}` : 'לא נמצאו יעדים') + '\nלכל היעדים על המפה:';
  // the search only: a country panel open while sharing is not part of it
  const h = new URLSearchParams(location.hash.slice(1));
  h.delete('c');
  const url = `${location.origin}${location.pathname}#${h}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'מפת מטיילים – מאתר יעדים', text, url }); track('share_finder', { results: hits.length, method: 'native' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('ההודעה והקישור הועתקו – אפשר להדביק בוואטסאפ'); track('share_finder', { results: hits.length, method: 'copy' }); }
  catch { prompt('העתיקו את הקישור:', url); }
}
$('#finder').addEventListener('change', () => { state.finderAll = false; runFinder(); });
const PRESETS = { sun: [26, 34], mild: [16, 26], snow: [-15, 2] };
$('#finder .f-presets').addEventListener('click', e => {
  const name = e.target.closest('[data-preset]')?.dataset.preset, p = PRESETS[name]; if (!p) return;
  track('finder_preset', { preset: name });
  [$('#fTmin').value, $('#fTmax').value] = p;
  $('#fTempOn').checked = true; $('#fDays').value = 'most';
  state.finderAll = false; runFinder();
});
// number fields update the results while typing, not only when the field loses focus
let finderTimer;
$('#finder').addEventListener('input', e => {
  if (e.target.type !== 'number') return;
  clearTimeout(finderTimer); finderTimer = setTimeout(() => { state.finderAll = false; runFinder(); }, 350);
});
$('#fResults').addEventListener('click', e => {
  if (e.target.closest('[data-more]')) { state.finderAll = true; $('#fResults .f-list').classList.remove('short'); e.target.remove(); return; }
  const iso = e.target.closest('[data-iso]')?.dataset.iso;
  if (iso && state.features[iso]) selectCountry(iso, { zoom: true, source: 'finder' });
  else if (iso) fitCountry(iso);   // an area without a country panel: just show it
});

// ---------- URL hash (shareable state) ----------
function saveHash() {
  const h = new URLSearchParams({ layer: state.layer, from: state.from, to: state.to });
  if (state.layer === 'risk' && state.riskMode !== 'combined') h.set('mode', state.riskMode);
  if (state.selected) h.set('c', state.selected);
  // an open finder: its filters (ft = temperature range or "off", fd = days, fr = risk, fv / fe = visa / events)
  const f = state.finder;
  if (f) {
    h.set('ft', f.tempOn ? `${f.tmin}_${f.tmax}` : 'off'); h.set('fd', f.days); h.set('fr', f.risk);
    if (f.visa) h.set('fv', 1);
    if (f.events) h.set('fe', 1);
  }
  history.replaceState(null, '', '#' + h);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { layer: h.get('layer'), mode: h.get('mode'), from: h.get('from'), to: h.get('to'), c: h.get('c'),
    finder: h.has('ft') ? { ft: h.get('ft'), fd: h.get('fd'), fr: h.get('fr'), fv: h.has('fv'), fe: h.has('fe') } : null };
}
// a shared search: fill the finder's fields from the link and open it
function applyFinderHash(p) {
  const [a, b] = (p.ft || '').split('_').map(Number);
  $('#fTempOn').checked = p.ft !== 'off';
  if (Number.isFinite(a) && Number.isFinite(b)) { $('#fTmin').value = a; $('#fTmax').value = b; }
  if ([...$('#fDays').options].some(o => o.value === p.fd)) $('#fDays').value = p.fd;
  if ([...$('#fRisk').options].some(o => o.value === p.fr)) $('#fRisk').value = p.fr;
  $('#fVisa').checked = p.fv; $('#fEvents').checked = p.fe;
  openFinder(true);
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
  const citiesReady = fetch('data/cities.json').then(r => r.json()).then(c => { state.cities = c; drawLabels(); refreshTrip(); }).catch(() => {});
  fetch('data/destinations.json').then(r => r.json()).then(d => { state.dests = d.places; refreshTrip(); }).catch(() => {});
  fetch('data/airports.json').then(r => r.json()).then(a => { state.airports = a.airports; refreshTrip(); }).catch(() => {});
  state.zones = (await fetch('data/timezones.json').then(r => r.json()).catch(() => null))?.zones || [];
  for (const f of geo.features) if (f.properties.iso2 && !state.features[f.properties.iso2]) state.features[f.properties.iso2] = f;
  // areas without an ISO code (Somaliland, Gaza…): no country panel, but the finder checks them like countries
  for (const f of geo.features) if (!f.properties.iso2 && f.properties.a3) state.areas[f.properties.a3] = f;
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
          let label = city ? `ליד ${city}` : await regionName(lat, lng, iso2);
          if (!label) { const far = nearestCity(lat, lng, 300, iso2); label = far ? `ליד ${far}` : nameHe(iso2, iso2); }
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
  if (h.finder) applyFinderHash(h.finder);
  if (h.c && state.features[h.c]) { await citiesReady; selectCountry(h.c, { zoom: true, source: 'link' }); }   // capital names in Hebrew
})();
