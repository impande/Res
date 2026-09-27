'use strict';
/* Reusable multi-step flows. quickBuild is the shortest realistic path to a
 * generated résumé, used by journeys that test what comes *after* building. */
const A = require('./app');
const { assert } = require('./harness');

async function quickBuild(s, page, base, P, { flag = 'generated' } = {}) {
  await s.step('Quick build: basic info → job → education → skills → generate', async () => {
    await A.openHome(page, base);
    await page.locator('button[onclick="startBuild()"]').first().click();
    await page.locator('#firstName').waitFor({ state: 'visible' });
    for (const [id, v] of [['firstName', P.firstName], ['lastName', P.lastName], ['jobTitle', P.jobTitle], ['email', P.email], ['phone', P.phone], ['location', P.location], ['linkedin', P.linkedin]]) {
      await A.type(page, '#' + id, v);
    }
    await A.goNext(page, 2);
    const e = P.experience[0];
    await A.type(page, '#exp-title-1', e.title); await A.type(page, '#exp-co-1', e.co);
    await A.type(page, '#exp-start-1', e.start); await A.type(page, '#exp-end-1', e.end);
    await page.locator('#exp-desc-1').click(); await page.keyboard.type(e.notes);
    await A.clickSidebar(page, 5);
    const ed = P.education[0];
    await A.type(page, '#edu-deg-1', ed.deg); await A.type(page, '#edu-sch-1', ed.sch); await A.type(page, '#edu-yr-1', ed.yr);
    await A.clickSidebar(page, 6);
    for (const sk of P.skills) { await A.type(page, '#skillInput', sk); await page.keyboard.press('Enter'); }
    await A.clickSidebar(page, 8);
    const t = Date.now();
    const txt = await A.generateAndSettle(page, P.lastName);
    assert(txt.includes(e.co), 'company missing from generated résumé');
    s.flags[flag] = true;
    return `generated in ${Math.round((Date.now() - t) / 1000)}s`;
  }, { severity: 'critical', timeout: 180000 });
}

module.exports = { quickBuild };
