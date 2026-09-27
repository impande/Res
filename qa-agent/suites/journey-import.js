'use strict';
/* Journey D — users who already have a résumé: paste its text, upload a PDF,
 * or import from GitHub. Each import must land in the wizard fields and then
 * generate a résumé from the imported data. */
const { assert } = require('../lib/harness');
const A = require('../lib/app');
const { pastedResume } = require('../lib/fixtures');

const val = (page, id) => page.locator('#' + id).inputValue().catch(() => '');

async function openBuilder(page, base) {
  await A.openHome(page, base);
  await page.locator('button[onclick="startBuild()"]').first().click();
  await page.locator('#firstName').waitFor({ state: 'visible' });
}

/** Wait for the import to fill Basic Info, then report what landed where. */
async function waitForImport(page, expectFirst, timeout = 120000) {
  await page.waitForFunction(() => (document.getElementById('firstName').value || '').trim().length > 0 ||
    /fail|couldn.t|error/i.test((document.getElementById('uploadStatusBar') || {}).innerText || ''), null, { timeout, polling: 500 });
  const status = await page.locator('#uploadStatusBar').innerText().catch(() => '');
  await A.settleStep(page);
  const first = await val(page, 'firstName');
  assert(first, 'import failed: ' + (status || 'first name not filled'));
  assert(first.toLowerCase() === expectFirst.toLowerCase(), `imported the wrong name: "${first}" (expected "${expectFirst}")`);
}

module.exports = async function journeyImport(audit, { base, files }) {
  await audit.suite('Journey D — Import an existing résumé (paste · PDF · GitHub)', async (s, page) => {
    // ── Paste text ───────────────────────────────────────────────────────
    await s.step('Paste résumé text → "Parse & Import" fills the wizard (live AI)', async () => {
      await openBuilder(page, base);
      await page.locator('#tabPaste').click();
      await page.locator('#resumePasteArea').fill(pastedResume);
      await page.locator('#btnParseText').click();
      await waitForImport(page, 'Rohan');
      const got = { last: await val(page, 'lastName'), email: await val(page, 'email'), title: await val(page, 'jobTitle') };
      assert(/mehta/i.test(got.last), 'last name not imported: ' + got.last);
      assert(/rohan\.mehta@example\.com/i.test(got.email), 'email not imported: ' + got.email);
      s.flags.pasted = true;
      return `${got.title || 'no title'} · ${got.email}`;
    }, { severity: 'critical', timeout: 130000 });

    await s.step('Pasted import: experience, education & skills landed in their steps', async () => {
      await A.clickSidebar(page, 2);
      const cos = await page.locator('#step2 input[id^="exp-co-"]').evaluateAll(es => es.map(e => e.value));
      assert(cos.some(c => /flipkart/i.test(c)), 'Flipkart job not imported, companies: [' + cos.join(', ') + ']');
      await A.clickSidebar(page, 5);
      const schools = await page.locator('#step5 input[id^="edu-sch-"]').evaluateAll(es => es.map(e => e.value));
      assert(schools.some(c => /christ/i.test(c)), 'education not imported: [' + schools.join(', ') + ']');
      await A.clickSidebar(page, 6);
      const skills = await page.locator('#skillTags .skill-tag span').allInnerTexts();
      assert(skills.some(k => /sql/i.test(k)), 'skills not imported: [' + skills.join(', ') + ']');
      return `${cos.filter(Boolean).length} job(s), ${schools.filter(Boolean).length} school(s), ${skills.length} skill(s)`;
    }, { severity: 'major', needs: ['pasted'] });

    await s.step('Pasted import: generate a résumé from the imported data (live AI)', async () => {
      await A.clickSidebar(page, 8);
      const txt = await A.generateAndSettle(page, 'Mehta');
      assert(/flipkart/i.test(txt), 'generated résumé lost the imported Flipkart job');
    }, { severity: 'major', needs: ['pasted'], timeout: 150000 });
  }, { description: 'Paste-text parsing and generating from imported data.' });

  await audit.suite('Journey D2 — Upload a PDF résumé', async (s, page) => {
    await s.step('Upload PDF → fields are extracted (live AI)', async () => {
      await openBuilder(page, base);
      await page.locator('#tabUpload').click();
      await page.setInputFiles('#resumeUploadInput', files.resumePdf);
      await waitForImport(page, 'Ananya', 150000);
      const email = await val(page, 'email');
      assert(/ananya\.iyer@example\.com/i.test(email), 'email not extracted from the PDF: ' + email);
      s.flags.uploaded = true;
      return `${await val(page, 'firstName')} ${await val(page, 'lastName')} · ${email}`;
    }, { severity: 'critical', timeout: 160000 });

    await s.step('Uploaded PDF: job history extracted', async () => {
      await A.clickSidebar(page, 2);
      const cos = await page.locator('#step2 input[id^="exp-co-"]').evaluateAll(es => es.map(e => e.value));
      assert(cos.some(c => /zoho/i.test(c)), 'Zoho job not extracted, companies: [' + cos.join(', ') + ']');
    }, { severity: 'major', needs: ['uploaded'] });
  }, { description: 'The recommended "Upload PDF / DOC" path, with a real PDF file.' });

  await audit.suite('Journey D3 — Import from GitHub', async (s, page) => {
    await s.step('GitHub username → profile imported into Basic Info', async () => {
      await openBuilder(page, base);
      await A.type(page, '#ghUsername', 'torvalds');
      await page.locator('button[onclick="prefillFromGithub()"]').click();
      await page.waitForFunction(() => (document.getElementById('firstName').value || '').length > 0, null, { timeout: 30000 });
      const name = `${await val(page, 'firstName')} ${await val(page, 'lastName')}`.trim();
      assert(/linus/i.test(name), 'unexpected name from GitHub: ' + name);
      const gh = await val(page, 'github');
      assert(/torvalds/i.test(gh), 'GitHub URL not filled: ' + gh);
      return name;
    }, { severity: 'minor', timeout: 40000 });
  }, { description: 'Public GitHub profile import.' });
};
