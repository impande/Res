'use strict';
/* Journey E — the same builder on a phone (iPhone 13, touch). Most visitors
 * come from mobile, and layout bugs (sideways scrolling, cut-off résumé,
 * unreachable buttons) only show up here. */
const fs = require('fs');
const { devices } = require('playwright');
const { assert } = require('../lib/harness');
const A = require('../lib/app');
const { persona } = require('../lib/fixtures');

const P = { ...persona, firstName: 'Mobile', lastName: persona.lastName };

module.exports = async function journeyMobile(audit, { base }) {
  await audit.suite('Journey E — Build a résumé on a phone (iPhone 13)', async (s, page) => {
    const overflow = async where => {
      const px = await A.horizontalOverflow(page);
      assert(px <= 2, `${where}: page scrolls sideways by ${px}px on a phone`);
    };
    const stepLabel = () => page.evaluate(() => (document.body.innerText.match(/Step\s+(\d)\s+of\s+8/) || [])[1] || '');

    await s.step('Home page fits the phone screen; main CTA above the fold', async () => {
      await A.openHome(page, base);
      await overflow('home');
      const cta = await page.locator('button[onclick="startBuild()"]').first().boundingBox();
      assert(cta && cta.y + cta.height <= 844, 'the "Generate Your First Resume" button is below the fold');
    }, { severity: 'major' });

    await s.step('Tap "Generate Your First Resume" → Step 1 of 8', async () => {
      await page.locator('button[onclick="startBuild()"]').first().tap();
      await page.locator('#firstName').waitFor({ state: 'visible' });
      assert((await stepLabel()) === '1', 'mobile header does not say "Step 1 of 8"');
      s.flags.started = true;
    }, { severity: 'critical' });

    await s.step('Fill every step by tapping "Next" — no sideways scrolling anywhere', async () => {
      for (const [id, v] of [['firstName', P.firstName], ['lastName', P.lastName], ['jobTitle', P.jobTitle], ['email', P.email], ['phone', P.phone]]) await A.type(page, '#' + id, v);
      await overflow('step 1');
      await A.goNext(page, 2);
      const e = P.experience[0];
      await A.type(page, '#exp-title-1', e.title); await A.type(page, '#exp-co-1', e.co);
      await A.type(page, '#exp-start-1', e.start); await A.type(page, '#exp-end-1', e.end);
      await page.locator('#exp-desc-1').tap(); await page.keyboard.type(e.notes);
      await overflow('step 2');
      for (const n of [3, 4, 5]) { await A.goNext(page, n); await overflow('step ' + n); }
      await A.type(page, '#edu-deg-1', P.education[0].deg); await A.type(page, '#edu-sch-1', P.education[0].sch);
      await A.goNext(page, 6); await overflow('step 6');
      for (const sk of P.skills.slice(0, 3)) { await A.type(page, '#skillInput', sk); await page.keyboard.press('Enter'); }
      await A.goNext(page, 7); await overflow('step 7');
      await A.goNext(page, 8); await overflow('step 8');
      assert((await stepLabel()) === '8', 'header does not say "Step 8 of 8" on the last step');
      s.flags.filled = true;
    }, { severity: 'critical', needs: ['started'], timeout: 120000 });

    await s.step('Generate on mobile (live AI) — résumé fits the screen', async () => {
      await page.locator('#generateBtn').scrollIntoViewIfNeeded();
      await page.locator('#generateBtn').tap();
      await A.waitForResume(page, P.lastName, 120000);
      await page.locator('button[onclick="dismissTips()"]').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      await A.dismissTips(page);
      s.flags.generated = true;
      await overflow('generated résumé');
      const out = await page.locator('#resumeOutput').boundingBox();
      assert(out && out.width <= 392, `résumé is ${Math.round(out && out.width)}px wide on a 390px screen`);
    }, { severity: 'critical', needs: ['filled'], timeout: 130000 });

    await s.step('"Preview Resume" opens full-screen preview; pick a template there', async () => {
      await page.locator('#previewFab:visible, button[onclick="openPreviewModal()"]:visible').first().tap();
      await page.locator('#previewModalBody').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForFunction(n => (document.getElementById('previewModalBody').innerText || '').toLowerCase().includes(n.toLowerCase()), P.lastName, { timeout: 10000 });
      // "Choose template" is a native <select> in the preview.
      const sel = page.locator('#previewModalOverlay select').first();
      assert(await sel.count(), 'no template chooser in the preview');
      const before = await page.locator('#previewModalBody').innerHTML();
      await sel.selectOption({ label: 'Classic' });
      await page.waitForFunction(b => document.getElementById('previewModalBody').innerHTML !== b, before, { timeout: 8000 });
      assert((await page.locator('#previewModalBody').innerText()).toLowerCase().includes(P.lastName.toLowerCase()), 'preview blank after choosing a template');
      await page.locator('.preview-modal-close:visible, button[onclick="closePreviewModal()"]:visible').first().tap();
      await page.locator('#previewModalBody').waitFor({ state: 'hidden', timeout: 5000 });
    }, { severity: 'major', needs: ['generated'] });

    await s.step('Download buttons are reachable; DOC downloads on mobile', async () => {
      for (const fn of ['downloadPDF()', 'downloadDoc()', '_r4uShareResumeQR()']) {
        const b = page.locator(`button[onclick="${fn}"]:visible`).first();
        assert(await b.count(), `${fn} button not visible on mobile`);
        const box = await b.boundingBox();
        assert(box.width >= 32 && box.height >= 32, `${fn} tap target is only ${Math.round(box.width)}×${Math.round(box.height)}px`);
      }
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('button[onclick="downloadDoc()"]:visible').first().tap()]);
      assert(fs.readFileSync(await dl.path(), 'utf8').includes(P.lastName), 'mobile DOC missing the name');
    }, { severity: 'major', needs: ['generated'] });
  }, { contextOptions: { ...devices['iPhone 13'] }, description: 'Touch-first walk-through at 390px: layout, header progress, generation, preview & downloads.' });
};
