import {
  ATTRS, ATTR_KEYS, CATEGORY_LABELS, shuffle, makeQuestion, matchingRound, filterByCategory,
} from './questions.js';
import {
  loadSettings, saveSettings, loadProgress, resetProgress, recordAnswer, recordBest,
  weakCytokines, mostMissed, accuracy,
} from './progress.js';

const MODE_NAMES = {
  match: 'Matching',
  rapid: 'Rapid fire',
  reverse: 'Reverse',
  sort: 'Pro vs anti',
  weak: 'Weak review',
};
const ROUND_MS = 60_000;

let all = [];
let settings = loadSettings();
let progress = loadProgress();

const game = {
  mode: null,
  score: 0,
  attempts: 0,
  endsAt: 0,
  timerId: null,
  autoId: null,
  q: null,
  answered: false,
  match: null,
};

// ---------- DOM helpers ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function show(view) {
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== `view-${view}`;
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
  if (view === 'settings') renderSettings();
  if (view === 'stats') renderStats();
}

const currentView = () => document.querySelector('.view:not([hidden])')?.id.replace('view-', '');

// ---------- theme ----------

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
}

function toggleTheme() {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = settings.theme === 'auto' ? (systemDark ? 'dark' : 'light') : settings.theme;
  settings.theme = effective === 'dark' ? 'light' : 'dark';
  saveSettings(settings);
  applyTheme();
  if (currentView() === 'settings') renderSettings();
}

// ---------- home ----------

function renderHome() {
  const weak = weakCytokines(progress, all);
  $('#weak-desc').textContent = weak.length
    ? `Focus on: ${weak.map((c) => c.name).join(', ')}`
    : 'No weak cytokines yet — play a few rounds first';
  const cat = { both: 'Both groups', proinflammatory: 'Proinflammatory', 'anti-inflammatory': 'Anti-inflammatory' }[settings.category];
  const attrs = settings.attrs.length === ATTR_KEYS.length ? 'all attributes' : settings.attrs.map((a) => ATTRS[a].label).join(', ');
  $('#settings-summary').textContent = `${cat} · ${attrs}${settings.timed ? ' · 60s timer' : ''}`;
}

// ---------- settings ----------

function renderSettings() {
  for (const r of document.querySelectorAll('input[name="category"]')) r.checked = r.value === settings.category;
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === settings.theme;
  $('#timed').checked = settings.timed;
  const box = $('#attr-checks');
  box.replaceChildren(...ATTR_KEYS.map((a) => el('label', {},
    el('input', { type: 'checkbox', value: a, checked: settings.attrs.includes(a) }),
    el('span', {}, ATTRS[a].label),
  )));
}

function bindSettings() {
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'category') settings.category = t.value;
    else if (t.name === 'theme') { settings.theme = t.value; applyTheme(); }
    else if (t.id === 'timed') settings.timed = t.checked;
    else if (t.closest('#attr-checks')) {
      const on = [...document.querySelectorAll('#attr-checks input:checked')].map((i) => i.value);
      if (!on.length) { t.checked = true; return; }
      settings.attrs = ATTR_KEYS.filter((a) => on.includes(a));
    } else return;
    saveSettings(settings);
  });
}

// ---------- game lifecycle ----------

function poolFor(mode) {
  if (mode === 'sort') return all;
  if (mode === 'weak') return weakCytokines(progress, all);
  return filterByCategory(all, settings.category);
}

function startGame(mode) {
  stopTimers();
  Object.assign(game, { mode, score: 0, attempts: 0, q: null, answered: false, match: null });
  $('#game-mode').textContent = MODE_NAMES[mode];
  updateScore();
  show('game');

  const timer = $('#game-timer');
  timer.hidden = !settings.timed;
  timer.classList.remove('low');
  if (settings.timed) {
    game.endsAt = Date.now() + ROUND_MS;
    tick();
    game.timerId = setInterval(tick, 200);
  }
  next();
}

function tick() {
  const left = Math.max(0, game.endsAt - Date.now());
  const t = $('#game-timer');
  t.textContent = Math.ceil(left / 1000);
  t.classList.toggle('low', left <= 10_000);
  if (left <= 0) endGame(true);
}

function stopTimers() {
  clearInterval(game.timerId);
  clearTimeout(game.autoId);
  game.timerId = game.autoId = null;
}

function updateScore() {
  $('#game-score').textContent = game.score;
  $('#game-attempts').textContent = game.mode === 'match' ? ' matched' : ` / ${game.attempts}`;
}

function endGame(timeUp = false) {
  stopTimers();
  if (!timeUp && game.attempts === 0) { show('home'); return; }
  const pct = game.attempts ? Math.round((game.score / game.attempts) * 100) : 0;
  $('#results-title').textContent = timeUp ? 'Time!' : 'Session complete';
  $('#results-score').textContent = game.score;
  $('#results-unit').textContent = game.mode === 'match' ? 'pairs matched' : 'correct';
  $('#results-line').textContent = `${game.score} of ${game.attempts} attempts correct (${pct}%) — ${MODE_NAMES[game.mode]}`;
  let best = '';
  if (settings.timed && timeUp) {
    const isNew = recordBest(progress, game.mode, game.score);
    best = isNew ? 'New best 60-second score!' : `Best 60-second score: ${progress.best[game.mode]}`;
  }
  $('#results-best').textContent = best;
  show('results');
}

function next() {
  clearTimeout(game.autoId);
  hideFeedback();
  game.answered = false;
  if (game.mode === 'match') return newMatchRound();

  const pool = poolFor(game.mode);
  if (!pool.length) {
    return showEmpty(game.mode === 'weak'
      ? 'No weak cytokines yet. Play other modes — anything you miss will show up here.'
      : 'No cytokines match these settings.');
  }
  const attrs = game.mode === 'weak' ? ATTR_KEYS : settings.attrs;
  game.q = makeQuestion(game.mode, { pool, all, attrs });
  if (!game.q) return showEmpty('Could not build a question with these settings. Try enabling more attribute types.');
  if (game.q.kind === 'sort') renderSort(game.q);
  else renderMC(game.q);
}

function showEmpty(msg) {
  stopTimers();
  $('#game-body').replaceChildren(el('div', { class: 'empty' }, el('p', {}, msg),
    el('button', { class: 'btn primary', type: 'button', onclick: () => show('home') }, 'Back to home')));
}

// ---------- multiple choice (rapid / reverse / weak) ----------

function renderMC(q) {
  const header = q.direction === 'forward'
    ? [el('p', { class: 'prompt' }, ATTRS[q.attr].label), el('p', { class: 'subject' }, q.prompt)]
    : [
      el('p', { class: 'prompt' }, q.prompt),
      el('p', { class: `subject${q.direction === 'scenario' ? ' vignette' : ''}` }, q.subject,
        el('span', { class: 'attr-tag' }, ATTRS[q.attr]?.label || '')),
    ];
  const opts = el('div', { class: 'options' }, q.options.map((o, i) =>
    el('button', { class: 'option', type: 'button', dataset: { i }, onclick: () => answerMC(i) },
      el('span', { class: 'key' }, i + 1), el('span', {}, o.text))));
  $('#game-body').replaceChildren(...header, opts);
}

function answerMC(i) {
  if (game.answered) return;
  game.answered = true;
  const q = game.q;
  const chosen = q.options[i];
  const buttons = document.querySelectorAll('#game-body .option');
  q.options.forEach((o, j) => {
    const b = buttons[j];
    b.disabled = true;
    if (o.correct) b.classList.add('correct');
    else if (j === i) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  const ok = chosen.correct;
  game.attempts++;
  if (ok) game.score++;
  recordAnswer(progress, { cytokineId: q.cytokineId, attr: q.attr, correct: ok });
  updateScore();
  const right = q.options.find((o) => o.correct).text;
  showFeedback(ok, ok ? 'Correct!' : `Not quite — answer: ${right}`, q.explanation, ok ? '' : chosen.note, q.hook);
}

// ---------- pro vs anti ----------

function renderSort(q) {
  $('#game-body').replaceChildren(
    el('p', { class: 'prompt' }, 'Proinflammatory or anti-inflammatory?'),
    el('div', { class: 'sort-card' },
      el('div', { class: 'name' }, q.subject),
      el('div', { class: 'aka' }, q.aliases.join(' · '))),
    el('div', { class: 'sort-btns' },
      el('button', { class: 'option pro', type: 'button', dataset: { cat: 'proinflammatory' }, onclick: () => answerSort('proinflammatory') },
        'Proinflammatory', el('kbd', {}, '←')),
      el('button', { class: 'option anti', type: 'button', dataset: { cat: 'anti-inflammatory' }, onclick: () => answerSort('anti-inflammatory') },
        'Anti-inflammatory', el('kbd', {}, '→'))),
  );
}

function answerSort(cat) {
  if (game.answered) return;
  game.answered = true;
  const q = game.q;
  const ok = cat === q.answer;
  for (const b of document.querySelectorAll('.sort-btns .option')) {
    b.disabled = true;
    if (b.dataset.cat === q.answer) b.classList.add('correct');
    else b.classList.add('wrong');
  }
  game.attempts++;
  if (ok) game.score++;
  recordAnswer(progress, { cytokineId: q.cytokineId, attr: 'category', correct: ok });
  updateScore();
  showFeedback(ok, ok ? 'Correct!' : `No — ${CATEGORY_LABELS[q.answer]}`, q.explanation, '', '');
  if (ok) game.autoId = setTimeout(next, 600);
}

// ---------- matching ----------

function newMatchRound() {
  const pool = poolFor('match');
  const attrs = shuffle(settings.attrs);
  let round = null;
  for (const a of attrs) {
    const r = matchingRound(pool, a, all, 5);
    if (!round || r.pairs.length > round.pairs.length) round = r;
    if (r.pairs.length === 5) break;
  }
  if (!round || round.pairs.length < 3) {
    return showEmpty('Not enough distinct facts for a matching round. Try "Both" groups or more attribute types.');
  }
  game.match = { round, selCyto: null, selItem: null, remaining: round.pairs.length, missed: new Set() };

  const left = shuffle(round.pairs).map((p) =>
    el('button', { class: 'tile cyto', type: 'button', dataset: { pair: p.pairId, side: 'c' }, onclick: onTile }, p.name));
  const right = shuffle(round.pairs).map((p) =>
    el('button', { class: 'tile item', type: 'button', dataset: { pair: p.pairId, side: 'i' }, onclick: onTile }, p.text));

  $('#game-body').replaceChildren(
    el('p', { class: 'prompt' }, `Match each cytokine to its ${ATTRS[round.attr].long}`),
    el('div', { class: 'match-grid' }, el('div', { class: 'match-col' }, left), el('div', { class: 'match-col' }, right)),
  );
}

function onTile(e) {
  const m = game.match;
  const tile = e.currentTarget;
  if (tile.classList.contains('matched')) return;
  const side = tile.dataset.side;
  const key = side === 'c' ? 'selCyto' : 'selItem';
  document.querySelectorAll(`.tile[data-side="${side}"]`).forEach((t) => t.classList.remove('selected', 'wrong'));
  if (m[key] === tile) { m[key] = null; return; }
  m[key] = tile;
  tile.classList.add('selected');
  if (m.selCyto && m.selItem) checkPair();
}

function checkPair() {
  const m = game.match;
  const c = m.selCyto;
  const it = m.selItem;
  m.selCyto = m.selItem = null;
  const cp = m.round.pairs[+c.dataset.pair];
  const ip = m.round.pairs[+it.dataset.pair];
  game.attempts++;

  if (cp === ip) {
    game.score++;
    m.remaining--;
    // A pair counts as "correct" for stats only if it wasn't missed earlier this round.
    if (!m.missed.has(cp.cytokineId)) recordAnswer(progress, { cytokineId: cp.cytokineId, attr: m.round.attr, correct: true });
    for (const t of [c, it]) {
      t.classList.remove('selected');
      t.classList.add('matched');
      setTimeout(() => t.remove(), 260);
    }
    updateScore();
    if (m.remaining === 0) {
      showFeedback(true, 'Round cleared!', cp.explanation, '', '');
    } else {
      showFeedback(true, 'Match!', cp.explanation, '', '', { inline: true });
    }
  } else {
    m.missed.add(cp.cytokineId);
    recordAnswer(progress, { cytokineId: cp.cytokineId, attr: m.round.attr, correct: false });
    for (const t of [c, it]) {
      t.classList.remove('selected');
      t.classList.add('wrong');
    }
    setTimeout(() => [c, it].forEach((t) => t.classList.remove('wrong')), 600);
    updateScore();
    showFeedback(false, `Not a match: ${cp.name}`, `That one goes with ${ip.name} — ${ip.explanation}`, '', '', { inline: true });
  }
}

// ---------- feedback ----------

function showFeedback(ok, result, explain, note, hook, { inline = false } = {}) {
  const fb = $('#feedback');
  fb.hidden = false;
  fb.classList.toggle('good', ok);
  fb.classList.toggle('bad', !ok);
  $('#fb-result').textContent = (ok ? '✓ ' : '✗ ') + result;
  $('#fb-explain').textContent = explain || '';
  $('#fb-note').textContent = note || '';
  $('#fb-hook').textContent = hook ? `Memory hook: ${hook}` : '';
  $('#next-btn').hidden = inline;
  if (!inline && ok && settings.timed && game.mode !== 'sort') {
    game.autoId = setTimeout(next, 900);
  }
}

function hideFeedback() {
  $('#feedback').hidden = true;
}

// ---------- stats ----------

function renderStats() {
  const p = progress;
  const pct = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;
  $('#stats-overall').textContent = p.answered
    ? `${p.correct} of ${p.answered} answers correct (${pct}%).`
    : 'No answers yet — play a mode and your stats will appear here.';

  const rows = [...ATTR_KEYS, 'category'].map((a) => {
    const e = p.attrs[a];
    const acc = accuracy(e);
    const label = a === 'category' ? 'Pro vs anti' : ATTRS[a].label;
    return el('div', { class: 'bar-row' },
      el('span', { class: 'bar-label' }, label),
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${acc === null ? 0 : Math.round(acc * 100)}%` })),
      el('span', { class: 'bar-val' }, acc === null ? '—' : `${Math.round(acc * 100)}% (${e.right + e.wrong})`));
  });
  $('#stats-attrs').replaceChildren(...rows);

  const missed = mostMissed(p, all);
  $('#stats-missed').replaceChildren(...(missed.length
    ? missed.map(({ c, e }) => el('li', {},
      el('span', { class: `cat-dot ${c.category}` }), el('strong', {}, c.name),
      el('span', { class: 'meta' }, ` — missed ${e.wrong}×, ${Math.round(accuracy(e) * 100)}% accuracy`)))
    : [el('li', { class: 'muted' }, 'Nothing missed yet.')]));

  const best = Object.entries(p.best);
  $('#stats-best').replaceChildren(...(best.length
    ? best.map(([m, s]) => el('li', {}, `${MODE_NAMES[m] || m}: ${s}`))
    : [el('li', { class: 'muted' }, 'Turn on the 60-second timer in Settings to set a best score.')]));
}

// ---------- keyboard ----------

function onKey(e) {
  if (currentView() !== 'game' || e.metaKey || e.ctrlKey || e.altKey) return;
  const fbOpen = !$('#feedback').hidden && !$('#next-btn').hidden;
  if ((e.key === 'Enter' || e.key === ' ') && fbOpen) { e.preventDefault(); next(); return; }
  if (e.key === 'Escape') { endGame(false); return; }
  if (!game.q || game.answered || game.mode === 'match') return;
  if (game.q.kind === 'sort') {
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'p') answerSort('proinflammatory');
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'a') answerSort('anti-inflammatory');
    return;
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= game.q.options.length) answerMC(n - 1);
}

// ---------- boot ----------

async function boot() {
  applyTheme();
  try {
    const res = await fetch('data/cytokines.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    all = data.cytokines;
    if (!Array.isArray(all) || !all.length) throw new Error('No cytokines found in data file');
  } catch (err) {
    $('#loading').textContent = `Could not load data/cytokines.json (${err.message}). `
      + 'If you opened index.html directly from disk, serve the folder instead (e.g. "python3 -m http.server") or use the GitHub Pages link.';
    return;
  }
  $('#loading').hidden = true;

  document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => startGame(b.dataset.mode)));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  $('#brand').addEventListener('click', () => { stopTimers(); show('home'); });
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#open-settings').addEventListener('click', () => show('settings'));
  $('#open-stats').addEventListener('click', () => show('stats'));
  $('#end-game').addEventListener('click', () => endGame(false));
  $('#next-btn').addEventListener('click', next);
  $('#play-again').addEventListener('click', () => startGame(game.mode));
  $('#reset-progress').addEventListener('click', () => {
    if (confirm('Reset all progress and stats? This cannot be undone.')) {
      progress = resetProgress();
      renderStats();
    }
  });
  bindSettings();
  document.addEventListener('keydown', onKey);
  show('home');
}

boot();
