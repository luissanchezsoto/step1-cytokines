// Progress and settings persisted in localStorage. All access is wrapped in
// try/catch so the app still works in private windows or with storage blocked.

const PROGRESS_KEY = 'cytokineRecall.progress.v1';
const SETTINGS_KEY = 'cytokineRecall.settings.v1';

export const DEFAULT_SETTINGS = {
  category: 'both',
  attrs: ['source', 'function', 'clinical', 'drug', 'disease'],
  timed: false,
  theme: 'auto',
};

function emptyProgress() {
  return { attrs: {}, cytokines: {}, best: {}, answered: 0, correct: 0 };
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep going in memory */
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) || {}) };
}

export function saveSettings(s) {
  write(SETTINGS_KEY, s);
}

export function loadProgress() {
  return { ...emptyProgress(), ...(read(PROGRESS_KEY) || {}) };
}

export function saveProgress(p) {
  write(PROGRESS_KEY, p);
}

export function resetProgress() {
  const p = emptyProgress();
  saveProgress(p);
  return p;
}

const bump = (bucket, key, correct) => {
  const e = bucket[key] || (bucket[key] = { right: 0, wrong: 0 });
  if (correct) e.right++;
  else e.wrong++;
};

export function recordAnswer(p, { cytokineId, attr, correct }) {
  p.answered++;
  if (correct) p.correct++;
  if (attr) bump(p.attrs, attr, correct);
  if (cytokineId) bump(p.cytokines, cytokineId, correct);
  saveProgress(p);
}

export function recordBest(p, mode, score) {
  if (!p.best[mode] || score > p.best[mode]) {
    p.best[mode] = score;
    saveProgress(p);
    return true;
  }
  return false;
}

export const accuracy = (e) => (e && e.right + e.wrong ? e.right / (e.right + e.wrong) : null);

// Cytokines missed at least once that are still below 85% accuracy,
// worst first (weighted by number of misses).
export function weakCytokines(p, all, limit = 6) {
  return all
    .map((c) => ({ c, e: p.cytokines[c.id] }))
    .filter(({ e }) => e && e.wrong > 0 && accuracy(e) < 0.85)
    .sort((a, b) => b.e.wrong * (1 - accuracy(b.e)) - a.e.wrong * (1 - accuracy(a.e)))
    .slice(0, limit)
    .map(({ c }) => c);
}

export function mostMissed(p, all, limit = 8) {
  return all
    .map((c) => ({ c, e: p.cytokines[c.id] }))
    .filter(({ e }) => e && e.wrong > 0)
    .sort((a, b) => b.e.wrong - a.e.wrong || accuracy(a.e) - accuracy(b.e))
    .slice(0, limit);
}
