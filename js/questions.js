// Pure question-generation logic. No DOM access here, so it can be tested in Node.

export const ATTRS = {
  source: { label: 'Source', long: 'main cell source' },
  function: { label: 'Function', long: 'function / action' },
  clinical: { label: 'Clinical', long: 'clinical correlation' },
  drug: { label: 'Drug', long: 'drug that targets it' },
  disease: { label: 'Disease', long: 'associated immunodeficiency / disease' },
};
export const ATTR_KEYS = Object.keys(ATTRS);

export const CATEGORY_LABELS = {
  proinflammatory: 'Proinflammatory',
  'anti-inflammatory': 'Anti-inflammatory',
};

// ---------- small helpers ----------

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// A single source like "T cells (mainly activated CD4+ helper T cells)" or
// "Macrophages/monocytes" becomes one or more comparable keys.
function sourceKeys(s) {
  return s
    .replace(/\([^)]*\)/g, '')
    .split('/')
    .map((p) => 'src:' + norm(p))
    .filter((k) => k !== 'src:');
}

// ---------- items ----------

// Every attribute is turned into a list of items: { text, keys:Set, drug? }.
// Two cytokines "share" a fact when their items have a key in common; shared
// facts are never used as wrong answers. For text attributes the key is the
// exact wording, so give shared properties identical wording in the JSON.
export function itemsFor(c, attr) {
  switch (attr) {
    case 'source':
      if (!c.sources || !c.sources.length) return [];
      return [{
        text: c.sources.join(', '),
        keys: new Set(['grp:' + norm(c.sourceGroup || c.sources[0]), ...c.sources.flatMap(sourceKeys)]),
      }];
    case 'function':
      return (c.functions || []).map((t) => ({ text: t, keys: new Set([norm(t)]) }));
    case 'clinical':
      return (c.clinical || []).map((t) => ({ text: t, keys: new Set([norm(t)]) }));
    case 'disease':
      return (c.diseases || []).map((t) => ({ text: t, keys: new Set([norm(t)]) }));
    case 'drug':
      return (c.drugs || []).map((d) => ({ text: d.name, keys: new Set([norm(d.name)]), drug: d }));
    default:
      return [];
  }
}

function allKeys(c, attr) {
  const s = new Set();
  for (const it of itemsFor(c, attr)) for (const k of it.keys) s.add(k);
  return s;
}

const overlaps = (a, b) => {
  for (const k of a) if (b.has(k)) return true;
  return false;
};

function ownersOf(item, attr, all) {
  return all.filter((c) => overlaps(item.keys, allKeys(c, attr)));
}

// Cytokines whose own list contains this exact wording (for "that belongs to X").
function textOwners(item, attr, all) {
  return all.filter((c) => itemsFor(c, attr).some((it) => norm(it.text) === norm(item.text)));
}

function explainItem(c, attr, item) {
  if (attr === 'drug' && item.drug) {
    return `${item.drug.name}: ${item.drug.mechanism} — ${item.drug.indications}.`;
  }
  if (attr === 'source') return `${c.name} — main source: ${item.text}.`;
  return `${c.name}: ${item.text}.`;
}

export function hasAttr(c, attr) {
  return itemsFor(c, attr).length > 0;
}

// ---------- forward: cytokine → attribute ----------

export function forwardQuestion(c, attr, all, rng = Math.random) {
  const items = itemsFor(c, attr);
  if (!items.length) return null;
  const correct = pick(items, rng);
  const mine = allKeys(c, attr);

  const seen = new Set([norm(correct.text)]);
  const usedKeys = new Set(correct.keys);
  const distractors = [];
  for (const o of shuffle(all.filter((x) => x.id !== c.id), rng)) {
    for (const it of shuffle(itemsFor(o, attr), rng)) {
      if (overlaps(it.keys, mine)) continue;
      if (seen.has(norm(it.text))) continue;
      // Keep source options mutually distinct (e.g. no two "macrophage" answers).
      if (attr === 'source' && overlaps(it.keys, usedKeys)) continue;
      seen.add(norm(it.text));
      for (const k of it.keys) usedKeys.add(k);
      distractors.push({ text: it.text, owners: textOwners(it, attr, all).map((x) => x.name) });
      break;
    }
    if (distractors.length === 3) break;
  }
  if (distractors.length < 3) return null;

  const promptByAttr = {
    source: `What is the main source of ${c.name}?`,
    function: `Which is a function of ${c.name}?`,
    clinical: `Which clinical correlation fits ${c.name}?`,
    drug: `Which drug targets ${c.name}?`,
    disease: `Which disease/immunodeficiency involves ${c.name}?`,
  };

  return {
    kind: 'mc',
    direction: 'forward',
    cytokineId: c.id,
    attr,
    prompt: promptByAttr[attr],
    subject: c.name,
    options: shuffle([
      { text: correct.text, correct: true },
      ...distractors.map((d) => ({ text: d.text, correct: false, note: `That belongs to ${d.owners.join(' / ')}.` })),
    ], rng),
    explanation: explainItem(c, attr, correct),
    hook: c.mnemonic || '',
  };
}

// ---------- reverse: attribute / scenario → cytokine ----------

function cytokineOptions(answer, excludeIds, all, rng) {
  const pool = shuffle(all.filter((x) => x.id !== answer.id && !excludeIds.has(x.id)), rng);
  // Prefer at least one "tricky" distractor from the other category.
  const other = pool.find((x) => x.category !== answer.category);
  const picks = [];
  if (other) picks.push(other);
  for (const x of pool) {
    if (picks.length === 3) break;
    if (!picks.includes(x)) picks.push(x);
  }
  if (picks.length < 3) return null;
  return shuffle([answer, ...picks], rng).map((x) => ({
    text: x.name,
    id: x.id,
    correct: x.id === answer.id,
    note: x.id === answer.id ? '' : `${x.name}: ${x.summary}`,
  }));
}

export function reverseQuestion(c, attr, all, rng = Math.random) {
  const items = itemsFor(c, attr);
  if (!items.length) return null;
  const item = pick(items, rng);
  const exclude = new Set(ownersOf(item, attr, all).map((x) => x.id));
  exclude.delete(c.id);
  const options = cytokineOptions(c, exclude, all, rng);
  if (!options) return null;

  let prompt;
  switch (attr) {
    case 'source': prompt = 'Which cytokine is made mainly by:'; break;
    case 'function': prompt = 'Which cytokine has this action?'; break;
    case 'clinical': prompt = 'Which cytokine is linked to:'; break;
    case 'disease': prompt = 'Which cytokine is involved in:'; break;
    case 'drug': prompt = 'Which cytokine does this drug target?'; break;
  }
  const subject = attr === 'drug' ? `${item.drug.name} (used for ${item.drug.indications})` : item.text;
  return {
    kind: 'mc',
    direction: 'reverse',
    cytokineId: c.id,
    attr,
    prompt,
    subject,
    options,
    explanation: explainItem(c, attr, item),
    hook: c.mnemonic || '',
  };
}

export function scenarioQuestion(c, scenario, all, rng = Math.random) {
  const options = cytokineOptions(c, new Set(scenario.exclude || []), all, rng);
  if (!options) return null;
  return {
    kind: 'mc',
    direction: 'scenario',
    cytokineId: c.id,
    attr: scenario.attr || 'clinical',
    prompt: 'Clinical vignette',
    subject: scenario.prompt,
    options,
    explanation: scenario.explanation,
    hook: c.mnemonic || '',
  };
}

// ---------- pro vs anti ----------

export function sortQuestion(c) {
  return {
    kind: 'sort',
    cytokineId: c.id,
    attr: 'category',
    subject: c.name,
    aliases: c.aliases || [],
    answer: c.category,
    explanation: `${c.name} is ${CATEGORY_LABELS[c.category].toLowerCase()} — ${c.summary}`,
  };
}

// ---------- matching ----------

// Picks up to `size` cytokines, each paired with one item that no other chosen
// cytokine shares, so every pair has exactly one correct match.
export function matchingRound(pool, attr, all, size = 5, rng = Math.random) {
  const chosen = [];
  for (const c of shuffle(pool, rng)) {
    if (chosen.length === size) break;
    const cKeys = allKeys(c, attr);
    // An already-chosen item must not also be true of this cytokine...
    if (chosen.some((p) => overlaps(p.keys, cKeys))) continue;
    // ...and this cytokine's item must not be true of an already-chosen one.
    const item = shuffle(itemsFor(c, attr), rng).find((it) => !chosen.some((p) => overlaps(it.keys, p.allKeys)));
    if (!item) continue;
    chosen.push({ cytokine: c, item, keys: item.keys, allKeys: cKeys });
  }
  return {
    attr,
    pairs: chosen.map((p, i) => ({
      pairId: i,
      cytokineId: p.cytokine.id,
      name: p.cytokine.name,
      text: p.item.text,
      explanation: explainItem(p.cytokine, attr, p.item),
    })),
  };
}

// ---------- pools ----------

export function filterByCategory(all, category) {
  if (category === 'both' || !category) return all;
  return all.filter((c) => c.category === category);
}

// Builds a random question for the given mode, or null if impossible.
export function makeQuestion(mode, { pool, all, attrs, rng = Math.random }) {
  const usable = attrs.filter((a) => ATTR_KEYS.includes(a));
  for (let tries = 0; tries < 40; tries++) {
    const c = pick(pool, rng);
    if (!c) return null;
    if (mode === 'sort') return sortQuestion(c);
    const attr = pick(usable, rng);
    if (!attr) return null;
    let q = null;
    if (mode === 'rapid') {
      q = forwardQuestion(c, attr, all, rng);
    } else if (mode === 'reverse') {
      const scen = (c.scenarios || []).filter((s) => usable.includes(s.attr || 'clinical'));
      q = scen.length && rng() < 0.45
        ? scenarioQuestion(c, pick(scen, rng), all, rng)
        : reverseQuestion(c, attr, all, rng);
    } else if (mode === 'weak') {
      const r = rng();
      const scen = c.scenarios || [];
      if (r < 0.4) q = forwardQuestion(c, attr, all, rng);
      else if (r < 0.75 || !scen.length) q = reverseQuestion(c, attr, all, rng);
      else q = scenarioQuestion(c, pick(scen, rng), all, rng);
    }
    if (q) return q;
  }
  return null;
}
