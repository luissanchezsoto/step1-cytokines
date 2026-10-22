// End-to-end test of every game mode in headless Chromium.
// Run: npm install && node tests/e2e.mjs   (set SCREENSHOT_DIR to save screenshots)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const data = JSON.parse(await readFile(join(root, 'data/cytokines.json'), 'utf8'));
const byName = Object.fromEntries(data.cytokines.map((c) => [c.name, c]));
const shots = process.env.SCREENSHOT_DIR;

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path === '/' ? 'index.html' : path);
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

let passed = 0;
const failures = [];
async function test(name, fn, ctxOpts = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  try {
    await fn(page, ctx);
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function open(page) {
  await page.goto(URL_);
  await page.waitForSelector('#view-home:not([hidden])');
}

async function noHorizontalScroll(page, where) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(sw <= iw, `${where}: horizontal scroll (${sw} > ${iw})`);
}

// Answers the current multiple-choice question; returns whether it was right.
async function answerMC(page, pickCorrect) {
  await page.waitForSelector('#game-body .option');
  const options = page.locator('#game-body .option');
  const n = await options.count();
  assert(n === 4, `expected 4 options, got ${n}`);
  // Find the right answer by answering, so the test also checks the marking.
  const idx = pickCorrect === undefined ? Math.floor(Math.random() * 4) : pickCorrect;
  await options.nth(idx).click();
  await page.waitForSelector('#feedback:not([hidden])');
  const correctCount = await page.locator('#game-body .option.correct').count();
  assert(correctCount === 1, `expected one highlighted correct option, got ${correctCount}`);
  const explain = await page.textContent('#fb-explain');
  assert(explain.trim().length > 5, 'missing explanation');
  return (await page.getAttribute('#feedback', 'class')).includes('good');
}

console.log('Cytokine Recall e2e');

await test('home loads with all five modes', async (page) => {
  await open(page);
  assert(await page.locator('.mode-card').count() === 5, 'expected 5 mode cards');
  assert((await page.title()) === 'Cytokine Recall', 'title');
});

await test('rapid fire: 15 questions with feedback, keyboard, score', async (page) => {
  await open(page);
  await page.click('[data-mode="rapid"]');
  let right = 0;
  for (let i = 0; i < 15; i++) {
    if (i % 3 === 0) {
      await page.waitForSelector('#game-body .option');
      await page.keyboard.press(String((i % 4) + 1));
      await page.waitForSelector('#feedback:not([hidden])');
      if ((await page.getAttribute('#feedback', 'class')).includes('good')) right++;
      await page.keyboard.press('Enter');
    } else {
      if (await answerMC(page)) right++;
      await page.click('#next-btn');
    }
  }
  assert((await page.textContent('#game-score')) === String(right), 'score mismatch');
  assert((await page.textContent('#game-attempts')).includes('15'), 'attempts mismatch');
  await page.click('#end-game');
  await page.waitForSelector('#view-results:not([hidden])');
  assert((await page.textContent('#results-line')).includes('of 15'), 'results line');
});

await test('reverse: answers point to cytokines and vignettes appear', async (page) => {
  await open(page);
  await page.click('[data-mode="reverse"]');
  let vignette = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForSelector('#game-body .option');
    const texts = await page.locator('#game-body .option span:last-child').allTextContents();
    assert(texts.every((t) => byName[t]), `reverse options should be cytokine names: ${texts}`);
    if (await page.locator('.subject.vignette').count()) vignette = true;
    await answerMC(page);
    await page.click('#next-btn');
  }
  assert(vignette, 'no clinical vignette in 40 reverse questions');
});

await test('pro vs anti: correct auto-advances, wrong shows explanation', async (page) => {
  await open(page);
  await page.click('[data-mode="sort"]');
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('.sort-card');
    const name = await page.textContent('.sort-card .name');
    const cat = byName[name].category;
    await page.click(`.sort-btns [data-cat="${cat}"]`);
    await page.waitForFunction((n) => !document.querySelector('.sort-card .name') || document.querySelector('.sort-btns .option:not(:disabled)'), name);
  }
  assert((await page.textContent('#game-score')) === '8', 'expected 8 correct');
  const name = await page.textContent('.sort-card .name');
  const wrong = byName[name].category === 'proinflammatory' ? 'anti-inflammatory' : 'proinflammatory';
  await page.keyboard.press(wrong === 'proinflammatory' ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForSelector('#feedback.bad:not([hidden])');
  assert((await page.textContent('#fb-explain')).includes(name), 'explanation names the cytokine');
  await page.click('#next-btn');
  await page.waitForSelector('.sort-btns .option:not(:disabled)');
});

await test('matching: wrong pair flagged, correct pairs disappear, round clears', async (page) => {
  await open(page);
  await page.click('[data-mode="match"]');
  for (let round = 0; round < 2; round++) {
    await page.waitForSelector('.tile.cyto');
    const pairs = await page.locator('.tile.cyto').evaluateAll((ts) => ts.map((t) => t.dataset.pair));
    assert(pairs.length >= 3, `only ${pairs.length} pairs`);
    // deliberate mistake
    await page.click(`.tile.cyto[data-pair="${pairs[0]}"]`);
    await page.click(`.tile.item[data-pair="${pairs[1]}"]`);
    await page.waitForSelector('#feedback.bad:not([hidden])');
    for (const p of pairs) {
      await page.click(`.tile.item[data-pair="${p}"]`);
      await page.click(`.tile.cyto[data-pair="${p}"]`);
      await page.waitForSelector(`.tile.cyto[data-pair="${p}"]`, { state: 'detached' });
    }
    assert((await page.textContent('#fb-result')).includes('Round cleared'), 'round cleared message');
    await page.click('#next-btn');
  }
  assert(Number(await page.textContent('#game-score')) >= 6, 'matched pairs counted');
});

await test('weak review, stats, persistence, and reset', async (page) => {
  await open(page);
  // Miss sort questions on purpose so there are weak cytokines.
  await page.click('[data-mode="sort"]');
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector('.sort-btns .option:not(:disabled)');
    const name = await page.textContent('.sort-card .name');
    const wrong = byName[name].category === 'proinflammatory' ? 'anti-inflammatory' : 'proinflammatory';
    await page.click(`.sort-btns [data-cat="${wrong}"]`);
    await page.click('#next-btn');
  }
  await page.click('#end-game');
  await page.click('#view-results [data-go="home"]');
  const weakDesc = await page.textContent('#weak-desc');
  assert(weakDesc.startsWith('Focus on:'), `weak desc: ${weakDesc}`);
  const weakNames = weakDesc.replace('Focus on: ', '').split(', ');

  await page.click('[data-mode="weak"]');
  for (let i = 0; i < 10; i++) {
    await answerMC(page);
    await page.click('#next-btn');
  }

  await page.click('#end-game');
  await page.click('#view-results [data-go="home"]');
  await page.reload();
  await page.waitForSelector('#view-home:not([hidden])');
  await page.click('#open-stats');
  const missed = await page.locator('#stats-missed li strong').allTextContents();
  assert(missed.length > 0 && weakNames.some((n) => missed.includes(n)), 'most-missed persisted after reload');
  assert((await page.textContent('#stats-overall')).includes('of 16'), 'overall count persisted');
  const sortRow = await page.locator('.bar-row', { hasText: 'Pro vs anti' }).textContent();
  assert(sortRow.includes('(6)'), `pro vs anti accuracy row: ${sortRow}`);
  await page.click('#reset-progress');
  assert((await page.textContent('#stats-overall')).startsWith('No answers yet'), 'reset clears stats');
  await page.reload();
  await page.waitForSelector('#view-home:not([hidden])');
  assert((await page.textContent('#weak-desc')).startsWith('No weak'), 'reset persisted');
});

await test('settings filter: anti-inflammatory + drug only', async (page) => {
  await open(page);
  await page.click('#open-settings');
  await page.click('label:has(input[value="anti-inflammatory"])');
  for (const a of ['source', 'function', 'clinical', 'disease']) await page.click(`#attr-checks label:has(input[value="${a}"])`);
  await page.click('#view-settings [data-go="home"]');
  assert((await page.textContent('#settings-summary')).includes('Anti-inflammatory · Drug'), 'summary reflects settings');
  await page.click('[data-mode="rapid"]');
  const anti = data.cytokines.filter((c) => c.category === 'anti-inflammatory').map((c) => c.name);
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('#game-body .option');
    const prompt = await page.textContent('#game-body .subject');
    assert(prompt.startsWith('Which drug targets'), `drug-only prompt: ${prompt}`);
    assert(anti.some((n) => prompt.includes(n)), `anti-only subject: ${prompt}`);
    await answerMC(page);
    await page.click('#next-btn');
  }
});

await test('60-second timer ends with a score and saves best', async (page) => {
  await page.clock.install();
  await open(page);
  await page.click('#open-settings');
  await page.click('label.switch');
  await page.click('#view-settings [data-go="home"]');
  await page.click('[data-mode="sort"]');
  assert(await page.isVisible('#game-timer'), 'timer visible');
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('.sort-btns .option:not(:disabled)');
    const name = await page.textContent('.sort-card .name');
    await page.click(`.sort-btns [data-cat="${byName[name].category}"]`);
    await page.clock.runFor(700);
  }
  await page.clock.runFor(61_000);
  await page.waitForSelector('#view-results:not([hidden])');
  assert((await page.textContent('#results-title')) === 'Time!', 'time up title');
  assert((await page.textContent('#results-score')) === '3', 'timed score');
  assert((await page.textContent('#results-best')).includes('New best'), 'new best');
  await page.click('#play-again');
  await page.waitForSelector('#view-game:not([hidden])');
});

await test('timed matching mode also finishes', async (page) => {
  await page.clock.install();
  await open(page);
  await page.click('#open-settings');
  await page.click('label.switch');
  await page.click('#view-settings [data-go="home"]');
  await page.click('[data-mode="match"]');
  await page.waitForSelector('.tile.cyto');
  await page.clock.runFor(61_000);
  await page.waitForSelector('#view-results:not([hidden])');
  assert((await page.textContent('#results-unit')).includes('pairs'), 'matching results unit');
});

await test('dark mode + theme toggle', async (page) => {
  await open(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert((await bg()) === 'rgb(22, 24, 29)', `dark bg expected, got ${await bg()}`);
  await page.click('#theme-toggle');
  assert((await bg()) === 'rgb(247, 247, 245)', 'toggle to light');
  await page.reload();
  await page.waitForSelector('#view-home:not([hidden])');
  assert((await bg()) === 'rgb(247, 247, 245)', 'theme choice persisted');
}, { colorScheme: 'dark' });

for (const [label, viewport, scheme] of [['phone', { width: 375, height: 740 }, 'light'], ['laptop', { width: 1280, height: 800 }, 'dark']]) {
  await test(`${label} layout: no horizontal scroll in any mode, 44px+ tap targets`, async (page) => {
    await open(page);
    await noHorizontalScroll(page, 'home');
    if (shots) await page.screenshot({ path: `${shots}/${label}-home.png`, fullPage: true });
    for (const mode of ['match', 'rapid', 'reverse', 'sort']) {
      await page.click(`[data-mode="${mode}"]`);
      await page.waitForSelector('#game-body button');
      if (mode === 'rapid' || mode === 'reverse') await answerMC(page);
      await noHorizontalScroll(page, mode);
      const small = await page.locator('#game-body button:visible').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height < 44).length);
      assert(small === 0, `${mode}: ${small} tap targets under 44px`);
      if (shots) await page.screenshot({ path: `${shots}/${label}-${mode}.png`, fullPage: true });
      await page.click('#end-game');
      if (await page.isVisible('#view-results')) await page.click('#view-results [data-go="home"]');
    }
    await page.click('#open-settings');
    await noHorizontalScroll(page, 'settings');
    if (shots) await page.screenshot({ path: `${shots}/${label}-settings.png`, fullPage: true });
  }, { viewport, colorScheme: scheme, hasTouch: label === 'phone' });
}

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
