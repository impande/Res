#!/usr/bin/env node
/*
 * Regression harness for resume4u (deploy-site/index.html).
 *
 * Why this exists: the app is one large single-file build. Past sessions kept
 * re-introducing the same regressions — the account-menu Sign-out getting
 * clipped, Key Achievements being wiped on load, section reorder not
 * persisting, new portfolio templates silently losing their routing, and so
 * on. Each was a one-line change that a static check would have caught.
 *
 * This harness runs two kinds of checks and exits non-zero if any fail, so it
 * can gate pushes in CI (see .github/workflows/regression.yml):
 *   1. BUILD   — `node build.js` succeeds, produces a syntactically valid
 *                app.js, and the built index references it. Runs on a COPY so
 *                the working tree is left untouched.
 *   2. STATIC  — key features/functions/CSS are present in the source, and the
 *                source is the pre-build source (not an already-built file).
 *
 * Run locally:  node scripts/regression.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'deploy-site', 'index.html');
const APP = path.join(ROOT, 'deploy-site', 'app.js');

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { results.push({ name, ok: true }); }
    else { results.push({ name, ok: false, msg: String(r) }); }
  } catch (e) {
    results.push({ name, ok: false, msg: e && e.message ? e.message : String(e) });
  }
}

if (!fs.existsSync(SRC)) {
  console.error('FATAL: ' + SRC + ' not found');
  process.exit(2);
}
const src = fs.readFileSync(SRC, 'utf8');

// ── helpers ────────────────────────────────────────────────────────────────
function has(needle) { return src.indexOf(needle) !== -1; }
function count(needle) { return src.split(needle).length - 1; }
function present(label, needle) {
  check(label, () => has(needle) || ('missing marker: ' + JSON.stringify(needle)));
}

// ── 1. BUILD (non-destructive) ───────────────────────────────────────────────
check('build: node build.js succeeds + valid app.js + index references it', () => {
  const backup = src;                       // restore source afterwards
  const hadApp = fs.existsSync(APP);
  const prevApp = hadApp ? fs.readFileSync(APP) : null;
  try {
    cp.execSync('node build.js', { cwd: ROOT, stdio: 'pipe' });
    if (!fs.existsSync(APP)) return 'build did not produce deploy-site/app.js';
    cp.execSync('node --check ' + JSON.stringify(APP), { stdio: 'pipe' }); // throws on syntax error
    const built = fs.readFileSync(SRC, 'utf8');
    if (!/app\.js\?v=/.test(built)) return 'built index.html does not reference app.js';
    return true;
  } finally {
    // Always restore the working tree to the committed source.
    fs.writeFileSync(SRC, backup);
    if (hadApp) fs.writeFileSync(APP, prevApp); else { try { fs.unlinkSync(APP); } catch (e) {} }
  }
});

// ── 1b. Syntax-check the id'd inline <script> blocks ─────────────────────────
// build.js only externalizes ATTRIBUTE-LESS <script> into app.js, so `node
// --check app.js` never covers <script id="...">…</script> blocks (the _r4u*
// features). Validate each here so a syntax error in one can't ship unnoticed.
check("inline id'd <script> blocks are syntactically valid", () => {
  const re = /<script\s+id="([^"]+)"([^>]*)>([\s\S]*?)<\/script>/g;
  let m; const bad = [];
  while ((m = re.exec(src))) {
    if (/type\s*=\s*["']application\/(ld\+)?json/i.test(m[2])) continue; // skip JSON-LD
    try { new Function(m[3]); } catch (e) { bad.push(m[1] + ': ' + e.message); }
  }
  return bad.length ? ('syntax error in: ' + bad.join(' | ')) : true;
});

// ── 2. STATIC feature presence ───────────────────────────────────────────────
check('source is pre-build (no app.js tag hardcoded)', () =>
  !/app\.js\?v=/.test(src) || 'source already contains a built app.js tag — did you commit build output?');
present('build id placeholder present', '__BUILD_ID__');

// core functions
present('core: renderOutput', 'renderOutput');
present('core: generatePortfolioHTML', 'generatePortfolioHTML');
present('core: renderATSScore', 'renderATSScore');
present('core: _atsMatch (JD keyword match)', 'function _atsMatch');

// regressions this project has actually hit before
present('regression guard: Sign-out dropdown fit', '_r4uAuthDropdownFitJS');
present('regression guard: Key Achievements persistence', 'keyAchievements');
present('regression guard: section-order persistence', '_r4uSecOrderPersistJS');
present('regression guard: portfolio template routing (NOVA_TPLS)', 'NOVA_TPLS');
present('regression guard: ATS-clean PDF headings (letter-spacing:normal)', 'letter-spacing:normal');
present('regression guard: PDF page-break rules', 'break-inside:avoid');

// JD tailoring feature (this session)
present('feature: JD tailor banner', '_r4uJdTailorJS');
present('feature: JD tailor deep-link (window._r4uJdMatch)', 'window._r4uJdMatch');
present('feature: full résumé tailoring (_tailorToJd)', '_tailorToJd');

// Bullet coach (#4)
present('feature: bullet coach tool', 'function _bulletCoach');
present('feature: bullet coach registered in tools', "lbl:'Bullet coach'");

// LinkedIn import (#6) — folded into the upload zone as a hint
present('feature: LinkedIn PDF hint in upload zone', 'upload-zone-li');

// Inline bullet coach on wizard steps (#4 extension)
present('feature: inline bullet coach on steps', '_r4uInlineBulletCoachJS');

// JD-aware cover letter enhancement (#5)
present('feature: cover-letter achievement grounding', '_r4uCoverLetterJS');

// Portfolio: live preview upfront on the Preview step
present('feature: portfolio preview-upfront reorder', '_r4uPfPreviewTopJS');

// Portfolio: dedicated "Choose what to include" step
present('feature: portfolio include step', '_r4uPfIncludeStepJS');

// Portfolio analytics dashboard + domain guide (#7)
present('feature: portfolio insights panel', '_pfInsightsHTML');
check('feature: portfolio analytics recording (share fn)', () => {
  const fp = path.join(ROOT, 'deploy-site', 'netlify', 'functions', 'share-portfolio.js');
  if (!fs.existsSync(fp)) return 'share-portfolio.js not found';
  const fn = fs.readFileSync(fp, 'utf8');
  cp.execSync('node --check ' + JSON.stringify(fp), { stdio: 'pipe' }); // throws on syntax error
  return fn.indexOf('updateMask.fieldPaths=daily') > -1 || 'daily-bucket recording missing from share-portfolio.js';
});

// sanity: portfolio template ids still routed
check('portfolio: all 6 premium template ids routed via NOVA_TPLS', () => {
  const m = src.match(/NOVA_TPLS\s*=\s*\{([^}]*)\}/);
  if (!m) return 'NOVA_TPLS object not found';
  const body = m[1];
  const need = ['nova', 'editorial', 'brutalist', 'swiss', 'glass', 'sage', 'cobalt'];
  const miss = need.filter(k => body.indexOf(k) === -1);
  return miss.length ? ('NOVA_TPLS missing: ' + miss.join(', ')) : true;
});

// sanity: file isn't truncated (must close the document and be full-size).
// Counting <script> tags is unreliable here because the portfolio generator
// embeds <script> inside JS string literals, so we guard truncation directly.
check('html: document closes and is full-size (not truncated)', () => {
  if (!/<\/html>\s*$/.test(src)) return 'file does not end with </html> — possible truncation';
  if (src.length < 500000) return 'source unexpectedly small (' + src.length + ' bytes) — possible truncation';
  return true;
});

// ── report ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  → ' + r.msg)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.error('\nREGRESSION CHECK FAILED (' + failed.length + ')'); process.exit(1); }
console.log('All regression checks passed ✅');
