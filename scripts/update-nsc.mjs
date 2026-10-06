// Fetches the current travel warnings of Israel's National Security Council (המל"ל) from gov.il
// and writes data/nsc-warnings.json. Run daily (e.g. GitHub Actions cron): node scripts/update-nsc.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const PAGE = 'https://www.gov.il/he/Departments/DynamicCollectors/travel-warnings-nsc?skip=0';
const API = 'https://www.gov.il/he/api/DynamicCollector';
const TEMPLATE = 'a591accc-14b7-4be8-a7b7-395ca588db53';
const UA = 'travel-map-updater/0.1';

// gov.il's firewall answers curl (with an honest User-Agent) but not Node's fetch, so we shell out to curl
const run = promisify(execFile);
async function curl(url, body) {
  const args = ['-s', '--fail', '-m', '30', '-A', UA, url];
  if (body) args.push('-H', 'Content-Type: application/json;charset=UTF-8', '--data-binary', JSON.stringify(body));
  const { stdout } = await run('curl', args, { maxBuffer: 20e6, encoding: 'utf8' });
  return stdout;
}

// gov.il country names that Intl.DisplayNames('he') spells differently
const OVERRIDES = {
  'איחוד האמירויות הערביות': 'AE', 'ארצות הברית': 'US', 'בריטניה': 'GB', 'הרפובליקה הדומיניקנית': 'DO',
  'צ\'כיה': 'CZ', 'קוריאה הדרומית': 'KR', 'דרום קוריאה': 'KR', 'צפון קוריאה': 'KP', 'חוף השנהב': 'CI',
  'הרפובליקה הדמוקרטית של קונגו': 'CD', 'קונגו': 'CG', 'מיאנמר (בורמה)': 'MM', 'מיאנמר': 'MM', 'בורמה': 'MM',
  'מקדוניה הצפונית': 'MK', 'מקדוניה': 'MK', 'בוסניה והרצגובינה': 'BA', 'טורקיה': 'TR', 'איי בהאמה': 'BS',
  'מאוריציוס': 'MU', 'קייפ ורדה': 'CV', 'אסוואטיני': 'SZ', 'סווזילנד': 'SZ', 'מזרח טימור': 'TL', 'טימור-לסטה': 'TL',
  'וייטנאם': 'VN', 'וייטנאם ': 'VN', 'לאוס': 'LA', 'רוסיה': 'RU', 'איראן': 'IR', 'סוריה': 'SY', 'הוותיקן': 'VA',
  'סנט קיטס ונוויס': 'KN', 'סנט וינסנט והגרנדינים': 'VC', 'אנטיגואה וברבודה': 'AG', 'טרינידד וטובגו': 'TT',
  'פפואה גינאה החדשה': 'PG', 'גינאה המשוונית': 'GQ', 'גינאה ביסאו': 'GW', 'קוסובו': 'XK', 'טייוואן': 'TW',
  'רפובליקה מרכז אפריקאית': 'CF', 'הרפובליקה המרכז אפריקאית': 'CF', 'סאו טומה ופרינסיפה': 'ST',
  'אורוגואי': 'UY', "אזרביג'אן": 'AZ', 'אקוואדור': 'EC', 'בוסניה הרצגובינה': 'BA', 'גאבון': 'GA', 'גווטמלה': 'GT',
  'גויאנה': 'GY', "ג'מאיקה": 'JM', 'דרום סודאן': 'SS', 'הונג קונג': 'HK', 'הרפובליקה המרכז אפריקנית': 'CF',
  'הרפובליקה של קונגו': 'CG', 'וותיקן': 'VA', "טג'יקיסטאן": 'TJ', 'טייואן': 'TW', 'מזרח טימור (הרפובליקה הדמוקרטית)': 'TL',
  'סאו טומה ופרינסיפ': 'ST', 'סודאן': 'SD', 'סוואזילנד': 'SZ', 'סיירה ליאונה': 'SL', 'פאלאו': 'PW', 'פיליפינים': 'PH',
  'פפואה ניו גיני': 'PG', 'פקיסטאן': 'PK', 'צפון מקדוניה': 'MK', 'קומורוס (איי קומרוס)': 'KM',
  'קונגו (הרפובליקה הדמוקרטית)': 'CD', 'קיריבטי': 'KI', 'תורכיה': 'TR', 'תורכמניסטן': 'TM', 'בורקינה פאסו': 'BF', 'סנט וינסנט והגרנדינס': 'VC',
};
// warnings for a region inside a country: kept as an extra note on the parent country
const SUBREGIONS = { 'מצרים (חצי האי סיני)': ['EG', 'חצי האי סיני'], "צ'צניה (רוסיה)": ['RU', "צ'צניה"] };

const norm = s => s.replace(/["'׳״`]/g, '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
const heNames = new Intl.DisplayNames(['he'], { type: 'region' });
const byHebrew = new Map();
// only current ISO codes (avoids legacy ones such as HV for Burkina Faso)
const VALID = new Set(Object.keys(JSON.parse(await readFile(new URL('../data/country-info.json', import.meta.url), 'utf8'))));
for (const code of VALID) {
  try { const n = heNames.of(code); if (n && n !== code) byHebrew.set(norm(n), code); } catch {}
}
const toIso = name => OVERRIDES[name.trim()] || OVERRIDES[norm(name)] || byHebrew.get(norm(name));

// NSC scale: 1 = no warning, 2 = occasional threat, 3 = medium (avoid non-essential travel), 4 = high (avoid travel).
// "Combined" warnings name several levels for different regions — keep the highest and lowest.
const WORDS = [[/ללא/, 1], [/מזדמן|רמה אחת|רמה שתיים|נמוכ/, 2], [/בינוני/, 3], [/גבוה|איסור/, 4]];
function levelsOf(alt, details) {
  const text = `${alt} ${details}`, found = new Set();
  for (const m of text.matchAll(/רמה\s*(\d)/g)) found.add(+m[1]);
  for (const m of alt.matchAll(/(\d)/g)) found.add(+m[1]);
  if (/רמה אחת/.test(text)) found.add(1);
  if (/שתיים/.test(text)) found.add(2);
  if (/שלוש/.test(text)) found.add(3);
  if (/ארבע/.test(text)) found.add(4);
  if (!found.size) for (const [re, lv] of WORDS) if (re.test(alt)) found.add(lv);
  const lv = [...found].filter(n => n >= 1 && n <= 4);
  return lv.length ? { level: Math.max(...lv), min: Math.min(...lv) } : { level: null, min: null };
}

// 1. code -> Hebrew country name, embedded in the collector page
const html = await curl(PAGE);
const names = {};
for (const m of html.matchAll(/&quot;Key&quot;:\s*&quot;(\d+)&quot;,\s*&quot;Value&quot;:\s*&quot;(.*?)&quot;/g)) names[m[1]] = m[2].replace(/&#39;|&amp;#39;/g, "'");
if (!Object.keys(names).length) throw new Error('country list not found on the page');

// 2. all warnings, 10 per page
const items = [];
for (let from = 0; ; from += 10) {
  const j = JSON.parse(await curl(API, { DynamicTemplateID: TEMPLATE, QueryFilters: { skip: { Query: from } }, From: from }));
  items.push(...j.Results);
  if (from + 10 >= j.TotalResults) break;
  await new Promise(res => setTimeout(res, 400));
}

const countries = {}, unmatched = [], subs = [];
for (const it of items) {
  const d = it.Data, nameHe = (names[d.country?.[0]] || it.UrlName).trim();
  const { level, min } = levelsOf((d.pic?.Alt || '').replace(/_/g, ' '), d.details || '');
  const entry = { level, min, mixed: min !== level, label: (d.pic?.Alt || '').trim(), details: (d.details || '').trim(), url: d.other?.URL };
  if (SUBREGIONS[nameHe]) { subs.push([...SUBREGIONS[nameHe], entry]); continue; }
  // areas without an ISO code are keyed by Natural Earth's A3 code, as in data/countries.geojson
  const iso2 = nameHe === 'סומלילנד' ? 'SOL' : toIso(nameHe);
  if (!iso2) { unmatched.push(nameHe); continue; }
  countries[iso2] = { ...entry, nameHe };
}
for (const [iso2, region, entry] of subs) if (countries[iso2]) (countries[iso2].regions ||= []).push({ region, ...entry });
await writeFile(new URL('../data/nsc-warnings.json', import.meta.url), JSON.stringify({
  _meta: { source: 'המטה לביטחון לאומי – אזהרות מסע', url: PAGE.replace('?skip=0', ''), updated: new Date().toISOString() }, countries,
}, null, 1));
console.log(`${items.length} warnings, ${Object.keys(countries).length} matched`);
const dist = {}; for (const c of Object.values(countries)) dist[c.level] = (dist[c.level] || 0) + 1;
console.log('levels:', JSON.stringify(dist));
if (unmatched.length) console.log('UNMATCHED:', unmatched.join(', '));
