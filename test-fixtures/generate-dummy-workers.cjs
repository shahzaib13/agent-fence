// Generates ~300 dummy fencing businesses across VIC regions, with heavy
// suburb overlap within each region so the compare-quote feature has real
// multiple-business competition to test against. Deterministic (seeded PRNG)
// so re-running gives the same output.
//
// Usage: node generate-dummy-workers.js
// Writes: dummy-workers-300.json (array) and prints a ready-to-paste JS
// array literal to dummy-workers-300.js (for the n8n Code node).

const fs = require('fs');
const path = require('path');

// Mulberry32 seeded PRNG — deterministic, no dependency.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260729);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickN = (arr, min, max) => {
  const n = Math.min(arr.length, min + Math.floor(rand() * (max - min + 1)));
  const shuffled = [...arr].sort(() => rand() - 0.5);
  return shuffled.slice(0, n);
};
const randInt = (min, max) => Math.floor(min + rand() * (max - min + 1));

const REGIONS = [
  { name: 'South East Melbourne', suburbs: ['Berwick', 'Beaconsfield', 'Beaconsfield Upper', 'Officer', 'Pakenham', 'Narre Warren', 'Narre Warren South', 'Cranbourne', 'Cranbourne North', 'Hampton Park', 'Hallam', 'Endeavour Hills', 'Doveton', 'Clyde', 'Clyde North'] },
  { name: 'Western Melbourne', suburbs: ['Werribee', 'Hoppers Crossing', 'Tarneit', 'Point Cook', 'Wyndham Vale', 'Sunshine', 'Footscray', 'Altona', 'Williamstown', 'Yarraville', 'Newport', 'Braybrook'] },
  { name: 'Northern Melbourne', suburbs: ['Craigieburn', 'Roxburgh Park', 'Epping', 'Thomastown', 'Lalor', 'Wollert', 'South Morang', 'Broadmeadows', 'Glenroy', 'Fawkner', 'Coburg', 'Pascoe Vale', 'Essendon'] },
  { name: 'Eastern Melbourne', suburbs: ['Ringwood', 'Croydon', 'Mitcham', 'Lilydale', 'Mooroolbark', 'Chirnside Park', 'Kilsyth', 'Rowville', 'Ferntree Gully', 'Boronia', 'Bayswater', 'Wantirna', 'Knoxfield'] },
  { name: 'Inner City', suburbs: ['Richmond', 'Fitzroy', 'Collingwood', 'Brunswick', 'Carlton', 'Abbotsford', 'South Yarra'] },
  { name: 'Bayside', suburbs: ['Brighton', 'Hampton', 'Sandringham', 'Beaumaris', 'Black Rock', 'Cheltenham'] },
  { name: 'Mornington Peninsula', suburbs: ['Frankston', 'Mornington', 'Mount Eliza', 'Rosebud', 'Rye', 'Sorrento', 'Dromana', 'Seaford', 'Langwarrin', 'Carrum Downs', 'Skye'] },
  { name: 'South East Outer', suburbs: ['Dandenong', 'Springvale', 'Noble Park', 'Keysborough', 'Clayton', 'Mulgrave'] },
  { name: 'Geelong & Surf Coast', suburbs: ['Geelong', 'Belmont', 'Grovedale', 'Waurn Ponds', 'Newcomb', 'Corio', 'Lara', 'Torquay', 'Anglesea', 'Jan Juc', 'Lorne', 'Ocean Grove', 'Barwon Heads', 'Drysdale', 'Clifton Springs', 'Portarlington', 'St Leonards', 'Queenscliff'] },
  { name: 'Ballarat Region', suburbs: ['Ballarat', 'Wendouree', 'Sebastopol', 'Alfredton', 'Delacombe'] },
  { name: 'Melton & Bacchus Marsh', suburbs: ['Melton', 'Bacchus Marsh', 'Kurunjang', 'Brookfield', 'Toolern Vale'] },
  { name: 'Sunbury & Macedon Ranges', suburbs: ['Sunbury', 'Diggers Rest', 'Gisborne', 'Riddells Creek', 'Woodend', 'Macedon', 'Mount Macedon', 'Romsey', 'Lancefield'] },
  { name: 'Yarra Valley & Diamond Valley', suburbs: ['Healesville', 'Yarra Glen', 'Coldstream', 'Seville', 'Wandin', 'Woori Yallock', 'Eltham', 'Diamond Creek', 'Hurstbridge', 'Research', 'Greensborough'] },
  { name: 'Inner East Premium', suburbs: ['Toorak', 'Malvern', 'Hawthorn', 'Kew', 'Camberwell', 'Armadale'] },
  { name: 'Gippsland', suburbs: ['Traralgon', 'Morwell', 'Warragul', 'Drouin', 'Sale', 'Moe', 'Churchill'] },
  { name: 'Bendigo Region', suburbs: ['Bendigo', 'Kangaroo Flat', 'Eaglehawk', 'Epsom', 'Strathfieldsaye', 'Golden Square'] },
  { name: 'Shepparton Region', suburbs: ['Shepparton', 'Mooroopna', 'Kialla', 'Tatura'] },
  { name: 'Wodonga Border', suburbs: ['Wodonga', 'Baranduda', 'Wangaratta'] },
  { name: 'Mildura Region', suburbs: ['Mildura', 'Irymple', 'Merbein'] },
  { name: 'South West Coast', suburbs: ['Warrnambool', 'Port Fairy', 'Portland', 'Koroit', 'Camperdown'] },
];

const FENCE_TYPES = [
  { type: 'Timber', min: 92, max: 165, standardHeightMm: 1800 },
  { type: 'Colorbond', min: 118, max: 175, standardHeightMm: 1800 },
  { type: 'Aluminium', min: 205, max: 355, standardHeightMm: 1800 },
  { type: 'Pool Fencing', min: 175, max: 300, standardHeightMm: 1200 },
  { type: 'Security', min: 210, max: 365, standardHeightMm: 2100 },
  { type: 'Rural', min: 48, max: 82, standardHeightMm: 1200 },
];

const NAME_PREFIXES = [
  'Premier', 'Elite', 'Reliable', 'Local', 'Quality', 'Trusted', 'Rapid', 'Prime',
  'Classic', 'Superior', 'All-Area', 'Metro', 'Regional', 'Coastal', 'Heritage',
  'Modern', 'Budget', 'Value', 'Precision', 'Master', 'Pro', 'Genuine', 'Direct',
  'Family', 'Neighbourhood', 'Skyline', 'Summit', 'Horizon', 'Anchor',
];
const NAME_SUFFIXES = [
  'Fencing', 'Fencing Co', 'Fencing Solutions', 'Fencing Pros', 'Fence & Gate',
  'Fencing Specialists', 'Fencing Group', 'Boundaries', 'Fencing Services',
  'Fence Works', 'Fencing Contractors', 'Fence Builders',
];

function makeBusinessName(region, used) {
  let name;
  let attempts = 0;
  do {
    const style = randInt(0, 2);
    if (style === 0) {
      name = `${region.name.split(' ')[0]} ${pick(NAME_SUFFIXES)}`;
    } else if (style === 1) {
      name = `${pick(NAME_PREFIXES)} ${pick(NAME_SUFFIXES)}`;
    } else {
      name = `${pick(region.suburbs)} ${pick(NAME_SUFFIXES)}`;
    }
    attempts++;
  } while (used.has(name) && attempts < 20);
  if (used.has(name)) name = `${name} #${used.size + 1}`;
  used.add(name);
  return name;
}

const REMOVAL_LABELS = [
  'Removal of old fence', 'Old fence removal', 'Removal of old timber fence',
  'Removal of old Colorbond fence', 'Standard removal', 'Tight access removal',
];

const usedNames = new Set();
const workers = [];
const TARGET = 300;
const perRegion = Math.ceil(TARGET / REGIONS.length);

for (const region of REGIONS) {
  for (let i = 0; i < perRegion && workers.length < TARGET; i++) {
    const businessName = makeBusinessName(region, usedNames);
    const serviceSuburbs = pickN(region.suburbs, Math.max(2, Math.floor(region.suburbs.length * 0.5)), region.suburbs.length);
    const typeCount = randInt(2, 4);
    const chosenTypes = pickN(FENCE_TYPES, typeCount, typeCount);
    const fenceTypes = chosenTypes.map((ft) => ({
      type: ft.type,
      ratePerMeter: Math.round(ft.min + rand() * (ft.max - ft.min)),
      standardHeightMm: ft.standardHeightMm,
    }));
    const addOns = [
      { item: pick(REMOVAL_LABELS), price: randInt(15, 60) },
    ];
    if (rand() < 0.15) {
      addOns.push({ item: 'Steep terrain / access surcharge', price: randInt(10, 30) });
    }

    workers.push({
      businessName,
      jobType: 'fencing',
      active: true,
      region: region.name,
      serviceSuburbs,
      fenceTypes,
      addOns,
    });
  }
}

console.log(`Generated ${workers.length} businesses across ${REGIONS.length} regions.`);

fs.writeFileSync(
  path.join(__dirname, 'dummy-workers-300.json'),
  JSON.stringify(workers, null, 2),
);

// Also emit a ready-to-paste JS array literal (no "region" field — that was
// just for generation bookkeeping, the n8n Code node doesn't need it).
// Compact one-object-per-line format (matches the original hand-written
// dataset's density) instead of JSON.stringify's one-field-per-line, which
// would make the Code node ~11,000 lines for no benefit.
function q(s) {
  return `'${String(s).replace(/'/g, "\\'")}'`;
}
function compactWorker(w) {
  const suburbs = w.serviceSuburbs.map(q).join(', ');
  const types = w.fenceTypes
    .map((ft) => `{ type: ${q(ft.type)}, ratePerMeter: ${ft.ratePerMeter}, standardHeightMm: ${ft.standardHeightMm} }`)
    .join(', ');
  const addOns = w.addOns
    .map((a) => `{ item: ${q(a.item)}, price: ${a.price} }`)
    .join(', ');
  return `  {\n    businessName: ${q(w.businessName)},\n    jobType: 'fencing',\n    active: true,\n    serviceSuburbs: [${suburbs}],\n    fenceTypes: [${types}],\n    addOns: [${addOns}],\n  }`;
}
const jsLiteral = 'const allWorkers = [\n' + workers.map(compactWorker).join(',\n') + '\n];\n';
fs.writeFileSync(path.join(__dirname, 'dummy-workers-300.js'), jsLiteral);

// Quick sanity report for a couple of common suburbs, useful for picking
// realistic test-PDF price anchors.
function report(suburb, fenceType) {
  const matches = workers.filter(
    (w) => w.serviceSuburbs.includes(suburb) &&
      w.fenceTypes.some((ft) => ft.type === fenceType),
  );
  const rates = matches.map((w) => w.fenceTypes.find((ft) => ft.type === fenceType).ratePerMeter);
  rates.sort((a, b) => a - b);
  console.log(`\n${suburb} / ${fenceType}: ${matches.length} businesses`);
  console.log('rates/m:', rates.join(', '));
}
report('Berwick', 'Colorbond');
report('Cranbourne', 'Colorbond');
report('Geelong', 'Timber');
