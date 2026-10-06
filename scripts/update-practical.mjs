// Builds data/practical.json: visa rules for Israeli passports, emergency numbers, plug types, mains voltage,
// driving side and Israeli diplomatic missions. Run weekly: node scripts/update-practical.mjs
// A source that fails keeps the values from the previous file, so one outage never wipes data.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const OUT = new URL('../data/practical.json', import.meta.url);
const UA = 'travel-map-updater/0.1 (https://github.com/roysadeh520/travel-map)';
const run = promisify(execFile);
const curl = async (url, extra = []) =>
  (await run('curl', ['-sL', '--fail', '-m', '120', '-A', UA, ...extra, url], { maxBuffer: 50e6, encoding: 'utf8' })).stdout;
const sparql = async query => JSON.parse(await curl('https://query.wikidata.org/sparql',
  ['-H', 'Accept: application/sparql-results+json', '--data-urlencode', `query=${query}`])).results.bindings;

const prev = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{"countries":{}}'));
const countries = prev.countries || {};
const C = iso => (countries[iso] ||= {});
const status = {};

// 1. visa requirements for Israeli passport holders (Passport Index dataset)
try {
  const csv = await curl('https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-tidy-iso2.csv');
  let n = 0;
  for (const line of csv.split('\n')) {
    const [from, to, req] = line.trim().split(',');
    if (from !== 'IL' || !to || req === '-1') continue;
    const days = /^\d+$/.test(req) ? +req : null;
    C(to).visa = days ? { type: 'visa free', days } : { type: req };
    n++;
  }
  status.visa = `${n} destinations`;
} catch (e) { status.visa = `failed (${e.message.split('\n')[0]}) – kept previous`; }

// 2. emergency numbers, plugs, voltage, driving side (Wikidata)
// plug item labels -> IEC letter types
const PLUG = [[/NEMA 1-15/, 'A'], [/NEMA 5-15/, 'B'], [/Europlug|CEE 7\/16/, 'C'], [/BS 546.*5|Type D/, 'D'], [/Type E|CEE 7\/5/, 'E'],
  [/Schuko|CEE 7\/4/, 'F'], [/BS 1363/, 'G'], [/SI 32|Type H/, 'H'], [/AS\/NZS 3112|Type I/, 'I'], [/SEV 1011|Type J/, 'J'],
  [/Danish|Type K|DS 60884/, 'K'], [/CEI 23-50|Type L/, 'L'], [/BS 546.*15|Type M/, 'M'], [/NBR 14136|IEC 60906-1|Type N/, 'N'], [/TIS 166|Type O/, 'O']];
try {
  const rows = await sparql(`SELECT ?iso (GROUP_CONCAT(DISTINCT ?em; separator="|") AS ?emergency) (GROUP_CONCAT(DISTINCT ?plugL; separator="|") AS ?plugs)
    (GROUP_CONCAT(DISTINCT ?volt; separator="|") AS ?voltage) (SAMPLE(?sideL) AS ?side) WHERE {
      ?c wdt:P297 ?iso .
      OPTIONAL { ?c wdt:P2852 ?emI . ?emI rdfs:label ?em . FILTER(LANG(?em) = "en") }
      OPTIONAL { ?c wdt:P2853 ?plug . ?plug rdfs:label ?plugL . FILTER(LANG(?plugL) = "en") }
      OPTIONAL { ?c p:P2884/psv:P2884/wikibase:quantityAmount ?volt }
      OPTIONAL { ?c wdt:P1622 ?sideI . ?sideI rdfs:label ?sideL . FILTER(LANG(?sideL) = "en") }
    } GROUP BY ?iso`);
  for (const r of rows) {
    const c = C(r.iso.value);
    const em = (r.emergency?.value || '').split('|').filter(x => /^[\d*#]{2,5}$/.test(x));
    if (em.length) c.emergency = [...new Set(em)].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const plugs = new Set();
    for (const p of (r.plugs?.value || '').split('|')) for (const [re, letter] of PLUG) if (re.test(p)) plugs.add(letter);
    if (plugs.size) c.plugs = [...plugs].sort();
    // household voltage only (drop three-phase values such as 400 V)
    const volts = (r.voltage?.value || '').split('|').map(Number).filter(v => v >= 90 && v <= 250);
    if (volts.length) c.voltage = Math.max(...volts);
    if (r.side?.value) c.drives = /left/i.test(r.side.value) ? 'left' : 'right';
  }
  status.wikidataCountries = `${rows.length} rows`;
} catch (e) { status.wikidataCountries = `failed (${e.message.split('\n')[0]}) – kept previous`; }

// 3. embassies / consulates operated by Israel (Wikidata)
try {
  const rows = await sparql(`SELECT DISTINCT ?e ?eLabel ?iso ?coord ?addr ?site WHERE {
      ?e wdt:P137 wd:Q801 ; wdt:P17 ?c ; wdt:P31 ?type .
      VALUES ?type { wd:Q3917681 wd:Q7843791 }   # embassy, consulate
      ?c wdt:P297 ?iso .
      OPTIONAL { ?e wdt:P625 ?coord } OPTIONAL { ?e wdt:P6375 ?addr } OPTIONAL { ?e wdt:P856 ?site }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "he,en". }
    }`);
  const byIso = {};
  for (const r of rows) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord?.value || '');
    (byIso[r.iso.value] ||= []).push({ name: r.eLabel.value, url: r.site?.value || null, addr: r.addr?.value || null,
      lat: m ? +(+m[2]).toFixed(4) : null, lon: m ? +(+m[1]).toFixed(4) : null });
  }
  for (const c of Object.values(countries)) delete c.missions;
  for (const [iso, list] of Object.entries(byIso)) C(iso).missions = list.filter(x => !/^Q\d+$/.test(x.name));
  status.missions = `${rows.length} missions`;
} catch (e) { status.missions = `failed (${e.message.split('\n')[0]}) – kept previous`; }

await writeFile(OUT, JSON.stringify({
  _meta: {
    updated: new Date().toISOString(), status,
    sources: { visa: 'Passport Index dataset (github.com/ilyankou/passport-index-dataset)', other: 'Wikidata (CC0)' },
  },
  countries,
}));
console.log(status);
