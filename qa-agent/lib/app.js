'use strict';
/* Page helpers that drive resume4u the way a person does: real clicks and
 * typing on visible controls, rather than calling app functions directly.
 * (evaluate() is used only to *read* state, never to skip UI.) */
const { assert } = require('./harness');

async function openHome(page, base) {
  const res = await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert(res && res.ok(), 'homepage returned HTTP ' + (res && res.status()));
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.locator('button[onclick="startBuild()"]').first().waitFor({ state: 'visible', timeout: 20000 });
  return res;
}

/** The visible "Next: …" button for a step (each step has its own). */
function nextBtn(page, toStep) {
  return page.locator(`.btn-primary[onclick="goToStep(${toStep})"]:visible`).first();
}

async function activeStep(page) {
  return page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; };
    const ids = [...document.querySelectorAll('.step-content[id^="step"]')].filter(vis).map(s => parseInt(s.id.replace('step', ''), 10));
    return ids.length ? Math.max(...ids) : 0;   // #step0 (hero) can stay visible
  });
}

/** Wait until an element stops moving (content above it can still be
 *  rendering, e.g. AI suggestions) — a person clicks what they see settle. */
async function waitStable(locator, { quietMs = 600, maxMs = 8000 } = {}) {
  const t0 = Date.now(); let last = null, since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const b = await locator.evaluate(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + window.scrollY) + ':' + Math.round(r.height); }).catch(() => null);
    if (b !== last) { last = b; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
    await locator.page().waitForTimeout(100);
  }
}

async function goNext(page, toStep) {
  const btn = nextBtn(page, toStep);
  const opened = () => page.waitForFunction(n => {
    const el = document.getElementById('step' + n);
    return el && el.getBoundingClientRect().height > 0;
  }, toStep, { timeout: 5000 }).then(() => true, () => false);
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    await waitStable(btn);
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    ok = await opened();
  }
  if (!ok) {
    const diag = await page.evaluate(n => {
      const vis = el => el.getBoundingClientRect().height > 0;
      const steps = [...document.querySelectorAll('.step-content[id^="step"]')].filter(vis).map(e => e.id);
      const b = [...document.querySelectorAll(`.btn-primary[onclick="goToStep(${n})"]`)].find(vis);
      let hit = '';
      if (b) { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); hit = e ? (e.id || e.className || e.tagName) : 'nothing'; }
      const banner = [...document.querySelectorAll('.val-banner')].filter(vis).map(e => e.innerText.trim()).join(' | ');
      return `visible steps [${steps}], next button ${b ? 'present (hit-test: ' + hit + ')' : 'missing'}${banner ? ', banner: ' + banner : ''}`;
    }, toStep);
    throw new Error(`"Next" did not open step ${toStep}: ${diag}`);
  }
}

async function clickSidebar(page, step) {
  await page.locator(`li[onclick="goToStep(${step})"]:visible`).first().click();
  await page.waitForFunction(n => { const el = document.getElementById('step' + n); return el && el.getBoundingClientRect().height > 0; }, step, { timeout: 10000 });
}

/** Type like a person: focus, clear, type with a short per-key delay. */
async function type(page, selector, text) {
  const el = page.locator(selector).first();
  await el.click();
  await el.fill('');
  await el.pressSequentially(text, { delay: 8 });
}

async function dismissTips(page) {
  const b = page.locator('button[onclick="dismissTips()"]:visible').first();
  if (await b.count()) await b.click().catch(() => {});
}

/** Generate the résumé, then clear the post-generation "Quick tips" popup a
 *  real user would close. Returns the rendered text. */
async function generateAndSettle(page, mustContain, timeout = 120000) {
  await page.locator('#generateBtn').click();
  const txt = await waitForResume(page, mustContain, timeout);
  await page.locator('button[onclick="dismissTips()"]').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  await dismissTips(page);
  return txt;
}

async function closeTopOverlay(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const sel of ['.preview-modal-close:visible', 'button[onclick="closePreviewModal()"]:visible',
    'button[onclick="closePfModal()"]:visible', 'button[onclick="closePayModal()"]:visible', '#_r4uQRok:visible', '#aiCloseBtn:visible']) {
    const b = page.locator(sel).first();
    if (await b.count().catch(() => 0)) await b.click({ timeout: 2000 }).catch(() => {});
  }
}

/** Wait until #resumeOutput shows the rendered résumé (or a failure message). */
async function waitForResume(page, mustContain, timeout = 90000) {
  await page.waitForFunction(needle => {
    const o = document.getElementById('resumeOutput');
    if (!o) return false;
    const t = o.innerText || '';
    return t.toLowerCase().includes(needle.toLowerCase()) && !/Generating|Writing your/i.test(t.slice(0, 200)) || /Generation failed/i.test(t);
  }, mustContain, { timeout, polling: 500 });
  const txt = await page.locator('#resumeOutput').innerText();
  assert(!/Generation failed/i.test(txt), 'generation failed: ' + txt.replace(/\s+/g, ' ').slice(0, 200));
  return txt;
}

/** Wait until the wizard stops changing step on its own (e.g. the app moves
 *  the user to "review" after an import) — a person waits for that too. */
async function settleStep(page, { quietMs = 2500, maxMs = 12000 } = {}) {
  const t0 = Date.now(); let last = await activeStep(page), since = Date.now();
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(250);
    const cur = await activeStep(page);
    if (cur !== last) { last = cur; since = Date.now(); } else if (Date.now() - since >= quietMs) return cur;
  }
  return last;
}

/** Page must not scroll sideways — the classic mobile layout bug. */
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - w;
  });
}

async function isVisible(page, selector) {
  return page.locator(selector).first().isVisible().catch(() => false);
}

module.exports = { settleStep, generateAndSettle, openHome, nextBtn, goNext, waitStable, clickSidebar, activeStep, type, dismissTips, closeTopOverlay, waitForResume, horizontalOverflow, isVisible };
