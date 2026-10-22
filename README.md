# Cytokine Recall

A study game for the high-yield cytokines and chemokines on USMLE Step 1. It covers each one's cell sources, actions, clinical correlations, the drugs that target it, and linked immunodeficiencies. Everything runs in the browser: plain HTML, CSS and JavaScript, with no backend, login or build step. It works on phones and laptops, in light and dark mode.

## Game modes

| Mode | How it works |
|---|---|
| **Matching** | 5 cytokines and 5 facts (source, function, clinical, drug or disease). Tap a cytokine, then its match. Correct pairs disappear. |
| **Rapid fire** | One cytokine and 4 choices for a random attribute. |
| **Reverse** | A function, drug, clinical correlation or vignette. You pick the cytokine (e.g. *"Crohn patient on infliximab develops cavitary TB — which cytokine was blocked?"*). |
| **Pro vs anti** | Sort each cytokine as proinflammatory or anti-inflammatory as fast as you can. Arrow keys work on a laptop. |
| **Review my weak cytokines** | Mixed questions on the cytokines you miss most. A cytokine leaves this list once your accuracy on it reaches 85%. |

After every answer you see whether you were right, a one-line explanation, and a memory hook.

**Settings:** you can quiz proinflammatory, anti-inflammatory or both groups. Wrong answers can still come from the other group, because they make good traps. You can also turn individual attribute types on or off, and switch on 60-second timed rounds that end with a score and keep your best.

**Progress:** progress is saved in your browser's `localStorage`. It's kept per browser and per device. The **Stats** page shows your accuracy by attribute type, your most-missed cytokines and your best timed scores. It also has a **Reset progress** button.

**Keyboard (laptop):** `1`–`4` pick an answer, `Enter` goes to the next question, `←`/`→` sort in Pro vs anti, and `Esc` ends the round.

## Publish free with GitHub Pages

1. Merge this code into the `main` branch.
2. On GitHub, open the repository and go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
5. After a minute or two the page shows your site address, e.g. `https://<your-username>.github.io/step1-cytokines/`. Open it on your phone and use **Add to Home Screen** for an app-like icon.

Every push to `main` redeploys the site automatically. GitHub Pages on a free account requires the repository to be **public**. Private repositories need a paid plan.

### Running it locally

Browsers block loading the data file when you double-click `index.html`, so serve the folder instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Adding or editing cytokines

All content lives in **`data/cytokines.json`**. You never need to touch the JavaScript. Each cytokine is one object in the `cytokines` array:

```json
{
  "id": "il6",
  "name": "IL-6",
  "aliases": [],
  "category": "proinflammatory",
  "summary": "Fever plus hepatic acute-phase proteins (CRP, fibrinogen, hepcidin); blocked by tocilizumab.",
  "sourceGroup": "Macrophages",
  "sources": ["Macrophages", "Th2 cells (also endothelial cells)"],
  "functions": ["Causes fever", "Stimulates hepatic acute-phase protein production (...)"],
  "mnemonic": "\"Hot T-bone stEAK\": IL-6 = aKute-phase proteins.",
  "clinical": ["Anemia of chronic disease (↑hepcidin traps iron)"],
  "drugs": [
    { "name": "Tocilizumab", "mechanism": "Monoclonal antibody against the IL-6 receptor", "indications": "RA, giant cell arteritis, ..." }
  ],
  "diseases": ["Multicentric Castleman disease (HHV-8 encodes a viral homolog)"],
  "scenarios": [
    { "attr": "drug", "prompt": "Vignette ending in a question…", "explanation": "One-line answer explanation." }
  ]
}
```

| Field | Notes |
|---|---|
| `id` | Unique, short, no spaces. Saved stats are keyed by it, so don't rename it later. |
| `name` | What the game displays. |
| `category` | `"proinflammatory"` or `"anti-inflammatory"`. |
| `summary` | One line, shown in explanations and in Pro vs anti. |
| `sourceGroup` | The main producer, used so two "macrophage" answers never compete. |
| `sources` | Main cell sources. Put minor ones in `(parentheses)`. Those are shown but not used to judge overlap. |
| `functions`, `clinical`, `diseases` | Lists of short facts. Any list may be empty `[]`. |
| `drugs` | Each drug has a `name`, `mechanism` and `indications`. |
| `mnemonic` | Optional memory hook, shown after answers. |
| `scenarios` | Optional vignettes for Reverse and weak-review modes. `attr` is one of `source`, `function`, `clinical`, `drug` or `disease`. |

**Writing tips so the questions stay fair:**

- **Shared facts need identical wording.** If two cytokines share a property (fever: IL-1, IL-6 and TNF-α), copy the exact same text into both. The game then knows the fact is shared and never uses it as a "wrong" answer.
- **Don't name the cytokine inside its own facts.** Reverse mode shows those facts as the question, so naming the cytokine would give away the answer. Write "Receptor deficiency → …" rather than "IL-12 receptor deficiency → …". Drug `mechanism` text may name the target, because it only appears in explanations.

After editing, check the file:

```sh
node tests/validate-data.mjs
```

The check confirms that required fields are present and that no fact gives away its answer. It also generates thousands of questions and confirms each one has exactly one correct option.

## Project layout

```
index.html            app shell
css/styles.css        styles (light + dark)
js/questions.js       question generation (pure logic, no DOM)
js/progress.js        localStorage progress, stats, settings
js/app.js             UI and game loop
data/cytokines.json   all content (edit this one)
tests/                data validator + Playwright end-to-end tests
```

## Tests

```sh
npm install           # installs Playwright (dev only; not needed by the site)
npm test              # data validation + end-to-end tests of every mode
```

The end-to-end tests play every mode in headless Chromium. They check:

- feedback after each answer
- matching, including wrong pairs
- the 60-second timer and best score
- weak-cytokine review
- stats persistence across reloads, and reset
- settings filters
- dark mode
- phone and laptop layouts: no horizontal scrolling, tap targets of 44px or more

---

*Content is a study aid at the level of First Aid / UWorld. Verify against your current review resources.*
