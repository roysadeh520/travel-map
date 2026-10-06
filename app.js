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
const TEMP = [
  { max: 0, color: '#3b6fd8', label: 'מתחת ל־0°' },
  { max: 10, color: '#7fb2ec', label: '0°–10°' },
  { max: 18, color: '#c6e3d6', label: '10°–18°' },
  { max: 25, color: '#f9dd77', label: '18°–25°' },
  { max: 32, color: '#f59b4c', label: '25°–32°' },
  { max: Infinity, color: '#d94a2b', label: 'מעל 32°' },
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
  events: [],
  cities: [],           // [he, en, iso2, lat, lon, pop] — Natural Earth, for Hebrew search
  temps: null, tempsEstimate: false,
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
function nameHe(iso2, fallback) {
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

async function loadTemps() {
  const key = `${state.from}_${state.to}`;
  if (state.tempsKey === key) return;
  const plan = weatherPlan(state.from, state.to);
  const pts = Object.keys(state.features).map(c => ({ c, p: repPoint(c) })).filter(x => x.p);
  const kind = plan.kind === 'forecast' ? 'forecast' : 'archive';
  const from = plan.kind === 'estimate' ? shiftYears(plan.from, plan.shift) : plan.from;
  const to = plan.kind === 'estimate' ? shiftYears(plan.to, plan.shift) : plan.to;
  toast('טוען טמפרטורות לכל המדינות…', 8000);
  const temps = {};
  try {
    for (let i = 0; i < pts.length; i += 60) {
      const chunk = pts.slice(i, i + 60);
      const url = wxURL(kind, chunk.map(x => x.p.lat.toFixed(2)).join(','), chunk.map(x => x.p.lon.toFixed(2)).join(','), from, to, 'temperature_2m_max');
      let res = await getJSON(url);
      if (!Array.isArray(res)) res = [res];
      res.forEach((r, j) => { temps[chunk[j].c] = avg(r?.daily?.temperature_2m_max || []); });
    }
    state.temps = temps; state.tempsKey = key; state.tempsEstimate = plan.kind === 'estimate';
    $('#toast').hidden = true;
  } catch (e) {
    console.error(e);
    toast('לא הצלחנו לטעון מזג אוויר (ייתכן שחרגנו ממכסת ה־API). נסו שוב בעוד דקה.');
  }
}

async function countryWeather(pt) {
  const plan = weatherPlan(state.from, state.to);
  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code';
  const lat = pt.lat.toFixed(3), lon = pt.lon.toFixed(3);
  if (plan.kind !== 'estimate') {
    const r = await getJSON(wxURL(plan.kind === 'forecast' ? 'forecast' : 'archive', lat, lon, plan.from, plan.to, daily));
    return { plan, tz: r.timezone, days: r.daily.time.map((t, i) => ({
      date: t, hi: r.daily.temperature_2m_max[i], lo: r.daily.temperature_2m_min[i],
      rain: r.daily.precipitation_sum[i], code: r.daily.weather_code[i] })) };
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
    days.push({ date: addDays(plan.from, i), hi, lo, rain, code: rain >= 1 ? (lo < 1 ? 71 : 61) : 1 });
  }
  return { plan, tz: runs[0]?.timezone, days };
}

// ---------- holidays ----------
async function holidays(iso2) {
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
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
}).addTo(map);

let countryLayer;
function fillFor(iso2) {
  if (!iso2) return NODATA;
  if (state.layer === 'risk') {
    if (state.riskMode === 'nsc') { const n = nscFor(iso2); return n ? NSC[n.min || n.level].color : NODATA; }
    if (state.riskMode === 'adl') { const a = state.anti[iso2]; return a ? ANTI[a.level].color : NODATA; }
    return riskOf(iso2)?.color || NODATA;
  }
  if (state.layer === 'temp') { const t = state.temps?.[iso2]; return t == null ? NODATA : TEMP.find(b => t < b.max).color; }
  return eventsInRange(iso2).length ? EVENT_ON : EVENT_OFF;
}
function styleFor(f) {
  const sel = f.properties.iso2 && f.properties.iso2 === state.selected;
  // fade the fill as the user zooms in so the street map stays readable
  const z = map.getZoom();
  const op = z >= 9 ? 0.12 : z >= 6 ? 0.35 : 0.72;
  // NSC "combined" warnings: fill = most of the country, dashed outline in the colour of the riskier regions
  const key = keyOf(f.properties), w = nscFor(key), fill = fillFor(key);
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
  else if (state.layer === 'temp') { const t = state.temps?.[p.iso2]; extra = t == null ? 'אין נתונים' : `ממוצע מקסימום: ${Math.round(t)}°`; }
  else { const ev = eventsInRange(p.iso2); extra = ev.length ? ev.map(e => (CAT_ICON[e.cat] || '') + ' ' + e.name).join('<br>') : 'אין אירועים במאגר בתאריכים אלה'; }
  return `<b>${esc(n)}</b><br><span style="color:#6b7385">${extra}</span>`;
}

// event markers (visible on the events layer)
const eventLayer = L.layerGroup();
function drawEventMarkers() {
  eventLayer.clearLayers();
  for (const e of eventsInRange(null)) {
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
    L_.innerHTML = `<h4>טמפרטורה מקסימלית ממוצעת</h4>${rows(TEMP)}
      <div class="sub">נמדד בבירה של כל מדינה${state.tempsEstimate ? ' · הערכה לפי השנה הקודמת (מעבר לטווח התחזית)' : ''}</div>`;
  } else {
    L_.innerHTML = `<h4>אירועים עונתיים בתאריכים שנבחרו</h4>${rows([{ color: EVENT_ON, label: 'יש אירועים' }, { color: EVENT_OFF, label: 'אין במאגר' }])}
      <div class="sub">${Object.keys(CAT_ICON).map(k => `${CAT_ICON[k]} ${CAT_NAME[k]}`).join(' · ')}</div>`;
  }
}

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
  if (layer === 'temp') await loadTemps();
  restyle(); drawLegend(); saveHash();
}

// ---------- panel ----------
async function selectCountry(iso2, { zoom = false, point = null } = {}) {
  const f = state.features[iso2];
  if (!f) return;
  state.selected = iso2;
  state.point = point || repPoint(iso2);
  restyle();
  if (zoom) fitCountry(iso2);
  saveHash();
  renderPanel();
}

function fitCountry(iso2) {
  const wide = innerWidth > 760;
  map.flyToBounds(L.geoJSON(state.features[iso2]).getBounds(), {
    paddingTopLeft: [30, 30], paddingBottomRight: wide ? [420, 30] : [30, innerHeight * 0.6], maxZoom: 7, duration: 0.8 });
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
async function renderPanel() {
  const iso2 = state.selected; if (!iso2) return;
  const token = ++panelToken;
  const p = state.features[iso2].properties;
  const i = state.info[iso2];
  const pt = state.point;
  $('#panel').hidden = false;
  $('#panelBody').innerHTML = `
    <div class="p-head">
      <img src="https://flagcdn.com/w160/${iso2.toLowerCase()}.png" alt="" onerror="this.remove()">
      <div><h2>${esc(nameHe(iso2, p.he || p.en))}</h2><div class="en">${esc(p.en)}</div></div>
    </div>
    <div class="p-actions">
      <button data-act="zoom">🔍 התקרבו למדינה</button>
      <button data-act="share">🔗 העתיקו קישור</button>
    </div>
    ${riskCard(iso2)}
    ${nscNote(iso2)}
    <div class="daterange">📆 ${dmy(state.from)} – ${dmy(state.to)}</div>
    <section class="card" id="holCard"><h3>📅 חגים רשמיים</h3><div class="spinner">טוען…</div></section>
    ${eventsCard(iso2)}
    ${factsCard(iso2)}
    <section class="card" id="wxCard"><h3>🌤️ מזג אוויר${pt?.label ? ` · ${esc(pt.label)}` : ''}</h3><div class="spinner">טוען…</div></section>`;

  // weather
  if (pt) countryWeather(pt).then(({ plan, tz, days }) => {
    if (token !== panelToken) return;
    if (tz && $('#localTime')) try { $('#localTime').textContent = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); } catch {}
    const hi = avg(days.map(d => d.hi)), lo = avg(days.map(d => d.lo));
    const rainy = days.filter(d => d.rain >= 1).length;
    const note = plan.kind === 'estimate' ? 'הערכה: ממוצע של אותם תאריכים ב־3 השנים האחרונות (מעבר לטווח התחזית של 16 יום)'
      : plan.kind === 'actual' ? 'נתונים היסטוריים בפועל' : 'תחזית';
    $('#wxCard').innerHTML = `<h3>🌤️ מזג אוויר${pt.label ? ` · ${esc(pt.label)}` : ''}</h3>
      <div class="wxsum"><span>מקס׳ <b class="hi">${Math.round(hi)}°</b></span><span>מינ׳ <b class="lo">${Math.round(lo)}°</b></span><span>ימי גשם <b>${rainy}</b>/${days.length}</span></div>
      <table class="wx"><tr><th>יום</th><th></th><th>מקס׳</th><th>מינ׳</th><th>משקעים</th></tr>
      ${days.map(d => { const [ic, t] = WX(d.code); return `<tr><td>${dayLabel(d.date)}</td><td title="${t}">${ic}</td>
        <td class="hi">${d.hi == null ? '–' : Math.round(d.hi) + '°'}</td><td class="lo">${d.lo == null ? '–' : Math.round(d.lo) + '°'}</td>
        <td>${d.rain == null ? '–' : d.rain.toFixed(1) + ' מ״מ'}</td></tr>`; }).join('')}</table>
      <div class="meta">${note} · Open-Meteo</div>`;
  }).catch(e => { console.error(e); if (token === panelToken) $('#wxCard').querySelector('.spinner').textContent = 'לא הצלחנו לטעון מזג אוויר'; });

  // holidays
  holidays(iso2).then(list => {
    if (token !== panelToken) return;
    const body = list == null ? '<div class="empty">אין נתוני חגים למדינה זו במקור</div>'
      : list.length ? `<ul class="list">${list.map(h => `<li>${esc(h.localName)}${h.localName !== h.name ? ` <small>${esc(h.name)} · ${dmy(h.date)}</small>` : ` <small>${dmy(h.date)}</small>`}</li>`).join('')}</ul>`
      : '<div class="empty">אין חגים רשמיים בתאריכים אלה</div>';
    $('#holCard').innerHTML = `<h3>📅 חגים רשמיים</h3>${body}<div class="meta">Nager.Date</div>`;
  });
}

$('#panelBody').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'zoom') fitCountry(state.selected);
  if (act === 'share') navigator.clipboard?.writeText(location.href).then(() => toast('הקישור הועתק'));
});
$('#close').addEventListener('click', () => {
  $('#panel').hidden = true; state.selected = null; restyle(); saveHash();
});

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
  state.tempsKey = null;
  if (state.layer === 'temp') await loadTemps();
  if (state.layer === 'events') drawEventMarkers();
  restyle(); drawLegend(); saveHash();
  if (state.selected) renderPanel();
}
// one range picker, shown and typed as dd/mm/yyyy
const fp = flatpickr('#range', {
  mode: 'range', dateFormat: 'd/m/Y', allowInput: true, disableMobile: true,
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
$('#jewish').addEventListener('click', () => {
  jewishOn = !jewishOn;
  $('#jewish').classList.toggle('on', jewishOn);
  if (jewishOn) { jewishLayer.addTo(map); loadJewish(); } else { jewishLayer.remove(); }
});
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

  const [geo, anti, events, info, nsc] = await Promise.all([
    fetch('data/countries.geojson').then(r => r.json()),
    fetch('data/antisemitism.json').then(r => r.json()),
    fetch('data/events.json').then(r => r.json()),
    fetch('data/country-info.json').then(r => r.json()),
    fetch('data/nsc-warnings.json').then(r => r.json()),
  ]);
  state.nsc = nsc.countries; state.nscMeta = nsc._meta || {};
  state.info = info;
  state.anti = anti.countries; state.antiMeta = anti._meta || {};
  state.events = events.events;
  fetch('data/cities.json').then(r => r.json()).then(c => (state.cities = c)).catch(() => {});
  for (const f of geo.features) if (f.properties.iso2 && !state.features[f.properties.iso2]) state.features[f.properties.iso2] = f;

  countryLayer = L.geoJSON(geo, {
    style: styleFor,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(() => tooltipFor(f.properties), { sticky: true, direction: 'top', opacity: 0.95 });
      layer.on({
        mouseover: () => layer.setStyle({ weight: 2, color: '#1d2433' }),
        mouseout: () => countryLayer.resetStyle(layer),
        click: () => f.properties.iso2 && selectCountry(f.properties.iso2),
      });
    },
  }).addTo(map);
  map.on('zoomend', restyle);

  // old links used separate nsc / anti layers
  if (h.layer === 'nsc' || h.layer === 'anti') { h.mode = h.layer === 'anti' ? 'adl' : 'nsc'; h.layer = 'risk'; }
  if (['combined', 'adl', 'nsc'].includes(h.mode)) state.riskMode = h.mode;
  await setLayer(['risk', 'temp', 'events'].includes(h.layer) ? h.layer : 'risk');
  if (h.c && state.features[h.c]) selectCountry(h.c, { zoom: true });
})();
