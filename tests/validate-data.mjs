// Checks data/cytokines.json and stress-tests question generation.
// Run: node tests/validate-data.mjs
import { readFileSync } from 'node:fs';
import {
  ATTR_KEYS, itemsFor, forwardQuestion, reverseQuestion, scenarioQuestion,
  matchingRound, makeQuestion, filterByCategory,
} from '../js/questions.js';

const data = JSON.parse(readFileSync(new URL('../data/cytokines.json', import.meta.url), 'utf8'));
const all = data.cytokines;
const errors = [];
const warn = [];
const fail = (m) => errors.push(m);

// ---------- schema ----------
const ids = new Set();
for (const c of all) {
  const where = c.name || c.id || '(unnamed)';
  for (const f of ['id', 'name', 'category', 'summary', 'sourceGroup']) if (!c[f]) fail(`${where}: missing "${f}"`);
  for (const f of ['sources', 'functions', 'clinical', 'drugs', 'diseases', 'scenarios']) {
    if (!Array.isArray(c[f])) fail(`${where}: "${f}" must be an array`);
  }
  if (!['proinflammatory', 'anti-inflammatory'].includes(c.category)) fail(`${where}: bad category "${c.category}"`);
  if (ids.has(c.id)) fail(`duplicate id ${c.id}`);
  ids.add(c.id);
  for (const d of c.drugs || []) {
    for (const f of ['name', 'mechanism', 'indications']) if (!d[f]) fail(`${where}: drug missing "${f}"`);
  }
  for (const s of c.scenarios || []) {
    if (!s.prompt || !s.explanation) fail(`${where}: scenario needs prompt + explanation`);
    if (s.attr && !ATTR_KEYS.includes(s.attr)) fail(`${where}: scenario attr "${s.attr}" unknown`);
  }
  // Reverse questions show these texts, so they must not name the answer.
  const names = [c.name, ...(c.aliases || [])].map((n) => n.toLowerCase());
  for (const a of ['functions', 'clinical', 'diseases']) {
    for (const t of c[a] || []) {
      const low = t.toLowerCase();
      for (const n of names) {
        const re = new RegExp(`(^|[^a-z0-9-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
        if (re.test(low)) fail(`${where}: ${a} item gives away the answer ("${n}"): ${t}`);
      }
    }
  }
  for (const s of c.scenarios || []) {
    for (const n of [c.name.toLowerCase()]) {
      if (s.prompt.toLowerCase().includes(n)) fail(`${where}: scenario prompt names the answer: ${s.prompt.slice(0, 60)}…`);
    }
  }
}

const required = ['IL-1', 'IL-2', 'IL-6', 'IL-8', 'IL-12', 'IL-17', 'IL-18', 'IL-23', 'TNF-α', 'IFN-γ', 'IFN-α/β', 'IL-4', 'IL-5', 'IL-10', 'IL-13', 'TGF-β'];
for (const r of required) if (!all.some((c) => c.name === r)) fail(`required cytokine missing: ${r}`);

// ---------- generation invariants ----------
let seed = 42;
const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const keysOf = (c, attr) => new Set(itemsFor(c, attr).flatMap((i) => [...i.keys]));

function checkMC(q, label) {
  if (!q) return;
  if (q.options.length !== 4) fail(`${label}: ${q.options.length} options`);
  if (q.options.filter((o) => o.correct).length !== 1) fail(`${label}: must have exactly one correct option`);
  const texts = q.options.map((o) => o.text);
  if (new Set(texts).size !== texts.length) fail(`${label}: duplicate options ${texts}`);
  if (!q.explanation) fail(`${label}: no explanation`);
}

let count = 0;
for (const c of all) {
  for (const attr of ATTR_KEYS) {
    for (let i = 0; i < 40; i++) {
      const f = forwardQuestion(c, attr, all, rng);
      if (itemsFor(c, attr).length && !f) warn.push(`no forward question for ${c.name}/${attr}`);
      checkMC(f, `forward ${c.name}/${attr}`);
      if (f) {
        // no distractor may be a property of the subject cytokine
        const mine = keysOf(c, attr);
        for (const o of f.options.filter((x) => !x.correct)) {
          const owner = all.find((x) => itemsFor(x, attr).some((it) => it.text === o.text));
          const it = itemsFor(owner, attr).find((x) => x.text === o.text);
          if ([...it.keys].some((k) => mine.has(k))) fail(`forward ${c.name}/${attr}: distractor also true: ${o.text}`);
        }
      }
      const r = reverseQuestion(c, attr, all, rng);
      checkMC(r, `reverse ${c.name}/${attr}`);
      if (r && r.options.find((o) => o.correct).id !== c.id) fail(`reverse ${c.name}/${attr}: wrong answer marked`);
      count += 2;
    }
  }
  for (const s of c.scenarios) {
    const q = scenarioQuestion(c, s, all, rng);
    checkMC(q, `scenario ${c.name}`);
    count++;
  }
}

for (const cat of ['proinflammatory', 'anti-inflammatory', 'both']) {
  const pool = filterByCategory(all, cat);
  for (const attr of ATTR_KEYS) {
    let best = 0;
    for (let i = 0; i < 50; i++) {
      const round = matchingRound(pool, attr, all, 5, rng);
      best = Math.max(best, round.pairs.length);
      // every item must belong only to its own cytokine among the chosen
      for (const p of round.pairs) {
        for (const o of round.pairs) {
          if (o === p) continue;
          const oc = all.find((x) => x.id === o.cytokineId);
          const it = itemsFor(all.find((x) => x.id === p.cytokineId), attr).find((x) => x.text === p.text);
          if ([...it.keys].some((k) => keysOf(oc, attr).has(k))) fail(`matching ${cat}/${attr}: "${p.text}" also fits ${oc.name}`);
        }
      }
      count++;
    }
    console.log(`matching ${cat.padEnd(17)} ${attr.padEnd(8)} max pairs: ${best}`);
  }
  for (const mode of ['rapid', 'reverse', 'sort']) {
    for (let i = 0; i < 100; i++) {
      const q = makeQuestion(mode, { pool, all, attrs: ATTR_KEYS, rng });
      if (!q) fail(`makeQuestion(${mode}, ${cat}) returned null`);
      else if (q.kind === 'mc') checkMC(q, `${mode}/${cat}`);
      count++;
    }
  }
}

console.log(`\n${all.length} cytokines, ${count} generated questions/rounds checked.`);
if (warn.length) console.log(`Warnings:\n  ${[...new Set(warn)].join('\n  ')}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ${[...new Set(errors)].join('\n  ')}`);
  process.exit(1);
}
console.log('Data OK ✓');
