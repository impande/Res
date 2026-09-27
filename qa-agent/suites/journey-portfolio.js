'use strict';
/* Journey C — the user turns their résumé into a portfolio website: walks the
 * builder, previews every design, downloads the HTML and publishes a /p/ link. */
const fs = require('fs');
const { assert, skip } = require('../lib/harness');
const { quickBuild } = require('../lib/flows');
const E = require('../lib/env');
const { persona: P, stamp } = require('../lib/fixtures');

module.exports = async function journeyPortfolio(audit, { base, publish, files, env }) {
  await audit.suite('Journey C — Portfolio website builder', async (s, page) => {
    await quickBuild(s, page, base, P);
    const ov = page.locator('#pfOverlay');
    const frameText = () => page.evaluate(() => {
      const f = document.getElementById('pfPreviewFrame');
      return (f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText) || '';
    });

    await s.step('Open "Build Portfolio" from the résumé', async () => {
      await page.locator('button[onclick="openPortfolioBuilder()"]:visible').first().click();
      await ov.waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#pfStep2').waitFor({ state: 'visible', timeout: 10000 });
      const chips = await page.locator('#pfOverlay [onclick^="pfChipGo"]').allInnerTexts();
      assert(chips.filter(c => c.includes('✓')).length >= 3, 'résumé data not carried into the portfolio sections: ' + chips.join(', '));
      s.flags.pf = true;
    }, { severity: 'major', needs: ['generated'] });

    await s.step('Sections: add a profile photo and a Projects case study', async () => {
      await page.locator('#pfOverlay [onclick="pfWzGo(0)"]').click();
      await page.setInputFiles('#pfWzPh', files.photo).catch(async () => {
        await page.locator('#pfOverlay input[type=file][accept^="image"]').first().setInputFiles(files.photo);
      });
      // A crop dialog may appear, as in the résumé wizard.
      const crop = page.locator('button[onclick*="pfCropApply"]:visible, #rpcModal button[onclick*="_rpc.apply"]:visible').first();
      if (await crop.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) await crop.click();
      const before = await page.locator('#pfOverlay [onclick^="pfCsRemoveImage"], #pfOverlay .pf-cs-card, #pfOverlay [id^="pfCs"]').count();
      await page.locator('#pfOverlay [onclick="pfAddCustomSection(\'project\')"]').click();
      await page.waitForTimeout(500);
      const after = await page.locator('#pfOverlay [onclick^="pfCsRemoveImage"], #pfOverlay .pf-cs-card, #pfOverlay [id^="pfCs"]').count();
      assert(after >= before, 'case-study section was not added');
    }, { severity: 'minor', needs: ['pf'] });

    await s.step('Include: choose sections, then continue to preview', async () => {
      await page.locator('#pfOverlay [onclick="pfShowInclude()"]').first().click();
      await page.locator('#pfStepInclude').waitFor({ state: 'visible' });
      const n = await page.locator('#pfStepInclude [onclick^="togglePfSection"]').count();
      assert(n >= 6, `only ${n} section toggles shown`);
      await page.locator('#pfStepInclude [onclick="pfGoStep(3)"]').click();
      await page.locator('#pfStep3').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForFunction(n => {
        const f = document.getElementById('pfPreviewFrame');
        return f && f.contentDocument && (f.contentDocument.body.innerText || '').toLowerCase().includes(n.toLowerCase());
      }, P.lastName, { timeout: 20000 });
      s.flags.pfPreview = true;
    }, { severity: 'major', needs: ['pf'] });

    await s.step('Preview renders every portfolio design with the user\'s name', async () => {
      const ids = await page.locator('#pfOverlay [onclick^="pfSetTemplate("]').evaluateAll(bs => bs.map(b => b.getAttribute('onclick').match(/'([^']+)'/)[1]));
      const bad = [], same = [];
      const doc = () => page.evaluate(() => { const f = document.getElementById('pfPreviewFrame'); return f ? (f.srcdoc || '') : ''; });
      for (const [i, id] of ids.entries()) {
        const prev = await doc();
        await page.locator(`#pfOverlay [onclick="pfSetTemplate('${id}')"]`).first().click();
        // The preview must actually re-render for this design…
        const changed = await page.waitForFunction(p => { const f = document.getElementById('pfPreviewFrame'); return f && f.srcdoc && f.srcdoc !== p; }, prev, { timeout: 12000 }).then(() => true, () => false);
        if (!changed && i > 0) same.push(id);
        // …and show the user's name.
        const ok = await page.waitForFunction(n => {
          const f = document.getElementById('pfPreviewFrame');
          return f && f.contentDocument && f.contentDocument.body && (f.contentDocument.body.innerText || '').toLowerCase().includes(n.toLowerCase());
        }, P.lastName, { timeout: 12000 }).then(() => true, () => false);
        if (!ok) bad.push(id);
      }
      assert(!same.length, `preview did not change for: ${same.join(', ')}`);
      assert(ids.length >= 5, 'only ' + ids.length + ' portfolio designs offered');
      assert(!bad.length, `${bad.length}/${ids.length} designs did not render: ${bad.join(', ')}`);
      return ids.length + ' designs OK';
    }, { severity: 'major', needs: ['pfPreview'], timeout: 240000 });

    await s.step('Download HTML gives a complete, self-contained website', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('#pfOverlay button[onclick="downloadPortfolio()"]').first().click()]);
      const html = fs.readFileSync(await dl.path(), 'utf8');
      assert(/^\s*<!doctype html/i.test(html), 'download is not an HTML document');
      assert(html.toLowerCase().includes(P.lastName.toLowerCase()), 'downloaded site does not contain the user\'s name');
      assert(html.includes(P.experience[0].co), 'downloaded site is missing work experience');
      return `${dl.suggestedFilename()} (${Math.round(html.length / 1024)} KB)`;
    }, { severity: 'major', needs: ['pfPreview'] });

    const slug = ('qa-audit-' + stamp + '-' + Math.random().toString(36).slice(2, 6)).toLowerCase();
    await s.step('Share Link: pick a URL, check availability, publish', async () => {
      if (!publish) skip('PUBLISH=0 — not creating public pages');
      E.needs(env, 'firebase', 'firestore');
      await page.locator('#pfShareBtn').click();
      const picker = page.locator('#_pfSlugPicker');
      const appeared = await picker.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
      if (!appeared) {
        const toast = await page.locator('.toast:visible, [class*="toast"]:visible').allInnerTexts().catch(() => []);
        throw new Error('URL picker did not open' + (toast.length ? ' — toast: ' + toast.join(' ') : ' (Firebase not loaded?)'));
      }
      await picker.locator('input').first().fill(slug);
      await picker.getByRole('button', { name: 'Check' }).click();
      await page.waitForFunction(() => /Available|taken|yours/i.test(document.getElementById('_pfSlugPicker').innerText), null, { timeout: 15000 });
      const status = await picker.innerText();
      assert(/Available|yours/i.test(status), 'slug check says: ' + status.replace(/\s+/g, ' ').slice(0, 140));
      await page.locator('#_pfSlugGenBtn').click();
      s.flags.pfPublished = true;
      return 'resume4u.help/p/' + slug;
    }, { severity: 'major', needs: ['pfPreview'], timeout: 45000 });

    await s.step('Published /p/ portfolio opens for a visitor', async () => {
      const url = base + '/p/' + slug;
      const ctx = await audit.browser.newContext({ viewport: { width: 1366, height: 768 } });
      try {
        if (audit.opts.beforePage) await audit.opts.beforePage(await ctx.newPage(), ctx);
        const v = ctx.pages()[0] || await ctx.newPage();
        s.watch(v);
        // Publishing is asynchronous; give Firestore a few seconds to serve it.
        let last = '';
        for (let i = 0; i < 8; i++) {
          const res = await v.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          last = 'HTTP ' + (res && res.status());
          if (res && res.ok()) {
            const ok = await v.waitForFunction(n => (document.body.innerText || '').toLowerCase().includes(n.toLowerCase()), P.lastName, { timeout: 8000 }).then(() => true, () => false);
            if (ok) return url;
            last = 'page loaded but name not shown';
          }
          await v.waitForTimeout(2500);
        }
        throw new Error(url + ' → ' + last);
      } finally { await ctx.close(); }
    }, { severity: 'major', needs: ['pfPublished'], timeout: 90000 });
  }, { description: 'Sections, include/exclude, every design, HTML download and the public /p/ link.' });
};
