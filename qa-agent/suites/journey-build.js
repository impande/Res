'use strict';
/* Journey A — a first-time visitor builds a complete résumé from scratch on
 * desktop, using every step of the wizard and the live AI helpers, then
 * tries templates, edits inline and exports. */
const fs = require('fs');
const { assert, warn } = require('../lib/harness');
const A = require('../lib/app');
const { persona: P } = require('../lib/fixtures');

module.exports = async function journeyBuild(audit, { base, files }) {
  await audit.suite('Journey A — Build a résumé from scratch (desktop)', async (s, page) => {
    await s.step('Open site and start the builder', async () => {
      await A.openHome(page, base);
      await page.locator('button[onclick="startBuild()"]').first().click();
      await page.locator('#firstName').waitFor({ state: 'visible', timeout: 10000 });
      s.flags.started = true;
    }, { severity: 'critical' });

    // ── Step 1: Basic info ────────────────────────────────────────────────
    await s.step('Step 1: fill personal information', async () => {
      for (const [id, v] of [['firstName', P.firstName], ['lastName', P.lastName], ['jobTitle', P.jobTitle], ['email', P.email],
        ['phone', P.phone], ['location', P.location], ['linkedin', P.linkedin], ['github', P.github]]) {
        await A.type(page, '#' + id, v);
        const got = await page.locator('#' + id).inputValue();
        assert(got === v, `#${id} holds "${got}" after typing "${v}"`);
      }
      s.flags.basic = true;
    }, { severity: 'critical', needs: ['started'] });

    await s.step('Step 1: job-title chip fills the title', async () => {
      try {
        await page.locator('#jobTitle').fill('');
        await page.locator('#firstName').click();             // leave the field…
        await page.waitForTimeout(400);
        await page.locator('#jobTitle').click();              // …and come back: chips appear on focus
        const chip = page.locator('#step1 .chips .chip:visible').first();
        await chip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        if (!(await chip.count())) warn('no job-title suggestion chips shown on focus');
        const label = (await chip.innerText()).trim();
        await chip.click();
        const v = await page.locator('#jobTitle').inputValue();
        assert(v && label.includes(v.slice(0, 5)), `chip "${label}" set title to "${v}"`);
      } finally {
        await A.type(page, '#jobTitle', P.jobTitle);     // back to our persona either way
      }
    }, { severity: 'minor', needs: ['started'] });

    await s.step('Step 1: upload & crop a profile photo', async () => {
      await page.setInputFiles('#photoInput', files.photo);
      await page.locator('#rpcModal button[onclick*="_rpc.apply"]').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#rpcModal button[onclick*="_rpc.apply"]').click();
      await page.waitForFunction(() => { const i = document.getElementById('photoPreview'); return i && /^data:|^blob:/.test(i.src) && i.getBoundingClientRect().width > 0; }, null, { timeout: 10000 });
    }, { severity: 'major', needs: ['started'] });

    // ── Step 2: Experience ────────────────────────────────────────────────
    await s.step('Step 1 → 2 via "Next: Experience"', async () => {
      await A.goNext(page, 2);
      s.flags.step2 = true;
    }, { severity: 'critical', needs: ['basic'] });

    await s.step('Step 2: fill first job incl. rich-text notes', async () => {
      const e = P.experience[0];
      await A.type(page, '#exp-title-1', e.title);
      await A.type(page, '#exp-co-1', e.co);
      await A.type(page, '#exp-start-1', e.start);
      await A.type(page, '#exp-end-1', e.end);
      await page.locator('#exp-desc-1').click();
      await page.keyboard.type(e.notes, { delay: 3 });
      const t = await page.locator('#exp-desc-1').innerText();
      assert(t.includes('payment APIs'), 'rich-text notes not stored: ' + t.slice(0, 80));
    }, { severity: 'critical', needs: ['step2'] });

    await s.step('Step 2: "+ Add Work Experience" adds a second job', async () => {
      await page.locator('button[onclick^="addExperience"]:visible').first().click();
      await page.locator('#exp-title-2').waitFor({ state: 'visible', timeout: 5000 });
      const e = P.experience[1];
      await A.type(page, '#exp-title-2', e.title);
      await A.type(page, '#exp-co-2', e.co);
      await A.type(page, '#exp-start-2', e.start);
      await A.type(page, '#exp-end-2', e.end);
      s.flags.exp2 = true;
    }, { severity: 'major', needs: ['step2'] });

    await s.step('Step 2: add then remove a third job (✕)', async () => {
      const ids = () => page.locator('#step2 .entry-card[id^="exp-"]').evaluateAll(cs => cs.map(c => c.id));
      const before = await ids();
      await page.locator('button[onclick^="addExperience"]:visible').first().click();
      await page.waitForFunction(n => document.querySelectorAll('#step2 .entry-card[id^="exp-"]').length > n, before.length);
      const added = (await ids()).find(id => !before.includes(id));
      assert(added, 'no new job card appeared');
      await page.locator('#' + added + ' .entry-remove').click();
      const after = await ids();
      assert(!after.includes(added), 'new card still present after ✕');
      assert(before.every(id => after.includes(id)), `✕ removed the wrong card: before [${before}] after [${after}]`);
      assert((await page.locator('#exp-co-1').inputValue()) === P.experience[0].co, 'first job data changed after removing another card');
    }, { severity: 'minor', needs: ['step2'] });

    await s.step('Step 2: "Generate Bullets with AI" writes bullets (live AI)', async () => {
      await page.locator('#gen-bullets-btn-2').click();
      await page.waitForFunction(() => (document.getElementById('exp-desc-2').innerText || '').trim().length > 40, null, { timeout: 60000, polling: 500 });
      const t = await page.locator('#exp-desc-2').innerText();
      return 'AI wrote ' + t.split('\n').filter(Boolean).length + ' line(s)';
    }, { severity: 'major', needs: ['exp2'], timeout: 75000 });

    // ── Step 3: Awards ────────────────────────────────────────────────────
    await s.step('Step 3: add an award', async () => {
      await A.goNext(page, 3);
      await A.type(page, '#award-name-1', P.award.name);
      await A.type(page, '#award-year-1', P.award.year);
      await A.type(page, '#award-org-1', P.award.org);
      await A.type(page, '#award-desc-1', P.award.desc);
      s.flags.step3 = true;
    }, { severity: 'major', needs: ['step2'] });

    // ── Step 4: Key achievements ──────────────────────────────────────────
    await s.step('Step 4: write a key achievement', async () => {
      await A.goNext(page, 4);
      await page.locator('#step4 input[placeholder^="Achievement title"]').first().fill(P.keyAchievement.title);
      await page.locator('#step4 textarea').first().fill(P.keyAchievement.desc);
      assert(await page.locator('#kaIncResume').isChecked(), '"include in résumé" is unchecked by default');
      s.flags.step4 = true;
    }, { severity: 'major', needs: ['step3'] });

    await s.step('Step 4: "Suggest 5 with AI" → tap ＋ adds one (live AI)', async () => {
      const count = () => page.locator('#step4 input[placeholder^="Achievement title"]').count();
      await page.locator('#kaAiBtn').click();
      await page.waitForFunction(() => document.querySelector('#kaSuggestBox .ka-sug-card, #kaSuggestBox .ka-sug-empty'), null, { timeout: 60000, polling: 500 });
      const empty = page.locator('#kaSuggestBox .ka-sug-empty');
      if (await empty.count()) throw new Error('AI returned no suggestions: ' + (await empty.innerText()));
      const n = await page.locator('#kaSuggestBox .ka-sug-card').count();
      const before = await count();
      await page.locator('#kaSuggestBox .ka-sug-add').first().click();
      await page.waitForFunction(b => document.querySelectorAll('#step4 input[placeholder^="Achievement title"]').length > b, before, { timeout: 5000 });
      return `${n} suggestions, added 1`;
    }, { severity: 'minor', needs: ['step4'], timeout: 75000 });

    // ── Step 5: Education ─────────────────────────────────────────────────
    await s.step('Step 5: add two education entries', async () => {
      await A.goNext(page, 5);
      const [e1, e2] = P.education;
      await A.type(page, '#edu-deg-1', e1.deg); await A.type(page, '#edu-sch-1', e1.sch);
      await A.type(page, '#edu-yr-1', e1.yr); await A.type(page, '#edu-gpa-1', e1.gpa);
      await page.locator('button[onclick^="addEducation"]:visible').first().click();
      await page.locator('#edu-deg-2').waitFor({ state: 'visible', timeout: 5000 });
      await A.type(page, '#edu-deg-2', e2.deg); await A.type(page, '#edu-sch-2', e2.sch); await A.type(page, '#edu-yr-2', e2.yr);
      s.flags.step5 = true;
    }, { severity: 'major', needs: ['step4'] });

    // ── Step 6: Skills ────────────────────────────────────────────────────
    await s.step('Step 6: add skills with the button and with Enter', async () => {
      await A.goNext(page, 6);
      for (const [i, sk] of P.skills.entries()) {
        await A.type(page, '#skillInput', sk);
        if (i % 2) await page.keyboard.press('Enter'); else await page.locator('button[onclick="addSkill()"]').click();
      }
      const tags = await page.locator('#skillTags .skill-tag span').allInnerTexts();
      for (const sk of P.skills) assert(tags.includes(sk), `skill "${sk}" missing from tags [${tags.join(', ')}]`);
      s.flags.step6 = true;
    }, { severity: 'major', needs: ['step5'] });

    await s.step('Step 6: remove a skill with ✕', async () => {
      await A.type(page, '#skillInput', 'Temporary'); await page.keyboard.press('Enter');
      await page.locator('#skillTags .skill-remove[data-skill="Temporary"]').click();
      const tags = await page.locator('#skillTags .skill-tag span').allInnerTexts();
      assert(!tags.includes('Temporary'), 'skill still present after ✕');
    }, { severity: 'minor', needs: ['step6'] });

    await s.step('Step 6: "Suggest Skills with AI" offers skills (live AI)', async () => {
      const before = await page.locator('#skillTags .skill-tag').count();
      const sugBefore = await page.locator('#step6 .sug-chip:visible').count();
      await page.locator('#aiSkillsBtn').click();
      await page.waitForFunction(([t, c]) => document.querySelectorAll('#skillTags .skill-tag').length > t ||
        document.querySelectorAll('#step6 .sug-chip').length > c, [before, sugBefore], { timeout: 60000, polling: 500 });
      return `tags ${before}→${await page.locator('#skillTags .skill-tag').count()}, suggestions ${sugBefore}→${await page.locator('#step6 .sug-chip:visible').count()}`;
    }, { severity: 'minor', needs: ['step6'], timeout: 75000 });

    // ── Step 7: Custom section ───────────────────────────────────────────
    await s.step('Step 7: add a custom section', async () => {
      await A.goNext(page, 7);
      await page.locator('button[onclick="addCustomSection()"]:visible').click();
      await page.locator('#custom-title-sel-1').selectOption(P.customSection.title);
      await page.locator('#custom-content-1').click();
      await page.keyboard.type(P.customSection.body);
      s.flags.step7 = true;
    }, { severity: 'major', needs: ['step6'] });

    await s.step('Sidebar marks completed steps and navigates back & forth', async () => {
      const cls = await page.locator('li[onclick^="goToStep("]').evaluateAll(ls => ls.map(l => l.className));
      const done = cls.filter(c => /completed/.test(c)).length;
      assert(done >= 6, `only ${done} steps marked completed: ${cls.join(' | ')}`);
      try {
        await A.clickSidebar(page, 2);
        assert((await page.locator('#exp-co-1').inputValue({ timeout: 3000 })) === P.experience[0].co, 'experience lost after navigating back');
        await A.clickSidebar(page, 1);
        assert((await page.locator('#firstName').inputValue()) === P.firstName, 'first name lost after navigating back');
      } finally {
        await A.clickSidebar(page, 7);   // leave the journey where the next step expects it
      }
    }, { severity: 'major', needs: ['step7'] });

    await s.step('Live preview modal shows the draft before generating', async () => {
      await page.locator('#previewFab').click();
      await page.locator('#previewModalBody').waitFor({ state: 'visible' });
      await page.waitForFunction(n => (document.getElementById('previewModalBody').innerText || '').includes(n), P.lastName, { timeout: 10000 });
      await A.closeTopOverlay(page);
    }, { severity: 'major', needs: ['step7'] });

    // ── Step 8: Templates + Generate ─────────────────────────────────────
    await s.step('Step 8: template gallery & filters', async () => {
      await A.goNext(page, 8);
      const all = await page.locator('.tpl-card:visible').count();
      assert(all >= 50, `only ${all} templates visible under "All"`);
      audit.templateCount = all;
      for (const f of ['dark', 'light', 'creative', 'minimal']) {
        await page.locator(`.tpl-filter-btn[onclick*="'${f}'"]`).click();
        const n = await page.locator('.tpl-card:visible').count();
        assert(n > 0 && n < all, `filter "${f}" shows ${n} of ${all}`);
      }
      await page.locator(`.tpl-filter-btn[onclick*="'all'"]`).click();
      s.flags.step8 = true;
      return all + ' templates';
    }, { severity: 'major', needs: ['step7'] });

    await s.step('Generate résumé with AI (live) and verify every entered field', async () => {
      await page.locator('.tpl-card[onclick="selectTemplate(\'modern\')"]').click().catch(() => {});
      const t = Date.now();
      await page.locator('#generateBtn').click();
      const txt = await A.waitForResume(page, P.lastName, 120000);
      audit.generateMs = Date.now() - t;
      const need = [P.firstName, P.lastName, P.email, P.experience[0].co, P.experience[1].co, P.education[0].sch, P.award.name, 'Python', 'Kubernetes', P.customSection.title];
      const missing = need.filter(n => !txt.toLowerCase().includes(n.toLowerCase()));
      s.flags.generated = true;
      assert(!missing.length, 'generated résumé is missing: ' + missing.join(', '));
      const bullets = await page.locator('#resumeOutput li').count();
      assert(bullets >= 4, `only ${bullets} bullet points generated`);
      if (audit.generateMs > 45000) warn(`generation took ${Math.round(audit.generateMs / 1000)}s`);
      return `${Math.round(audit.generateMs / 1000)}s, ${bullets} bullets`;
    }, { severity: 'critical', needs: ['step8'], timeout: 130000 });

    await s.step('"Quick tips" popup appears after generating and can be dismissed', async () => {
      const shown = await page.locator('button[onclick="dismissTips()"]').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      if (!shown) return 'tips popup not shown (already seen?)';
      await A.dismissTips(page);
      await page.locator('#tipsBackdrop').waitFor({ state: 'hidden', timeout: 5000 });
    }, { severity: 'major', needs: ['generated'] });

    await s.step('ATS score card renders a score', async () => {
      await page.locator('#atsScoreCard').waitFor({ state: 'visible', timeout: 10000 });
      const t = await page.locator('#atsScoreCard').innerText();
      const m = t.match(/(\d{1,3})\s*\/\s*100/);
      assert(m, 'no "NN/100" score in ATS card');
      audit.atsScore = +m[1];
      if (+m[1] < 60) warn('ATS score for a complete résumé is only ' + m[1]);
      return m[1] + '/100';
    }, { severity: 'major', needs: ['generated'] });

    await s.step('Inline edit on the résumé survives a template switch', async () => {
      const target = page.locator('#resumeOutput li').first();
      await target.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' QAEDIT');
      await page.locator('.tpl-card[onclick="selectTemplate(\'classic\')"]').click();
      await page.waitForTimeout(800);
      const txt = await page.locator('#resumeOutput').innerText();
      assert(txt.includes('QAEDIT'), 'inline edit was lost after switching template');
    }, { severity: 'major', needs: ['generated'] });

    await s.step('Every template renders the résumé without errors', async () => {
      const ids = await page.locator('.tpl-card').evaluateAll(cs => cs.map(c => (c.getAttribute('onclick') || '').match(/selectTemplate\('([^']+)'\)/)).filter(Boolean).map(m => m[1]));
      const errsBefore = s.pageErrors.length;
      const bad = [];
      for (const id of ids) {
        await page.evaluate(i => document.querySelector(`.tpl-card[onclick="selectTemplate('${i}')"]`).scrollIntoView({ block: 'center' }), id);
        await page.locator(`.tpl-card[onclick="selectTemplate('${id}')"]`).click();
        const ok = await page.waitForFunction(([n, i]) => {
          const o = document.getElementById('resumeOutput');
          const card = document.querySelector(`.tpl-card[onclick="selectTemplate('${i}')"]`);
          // Some templates upper-case the name with CSS, so compare case-insensitively.
          return o && (o.innerText || '').toLowerCase().includes(n.toLowerCase()) && card && card.classList.contains('tpl-active');
        }, [P.lastName, id], { timeout: 5000, polling: 100 }).then(() => true, () => false);
        if (!ok) bad.push(id);
      }
      const newErrs = s.pageErrors.length - errsBefore;
      assert(!bad.length, `${bad.length}/${ids.length} templates failed to render: ${bad.join(', ')}`);
      assert(!newErrs, `${newErrs} JS error(s) while switching templates: ${s.pageErrors.slice(-2).join(' | ')}`);
      return ids.length + ' templates OK';
    }, { severity: 'major', needs: ['generated'], timeout: 240000 });

    await s.step('Text size S / M / L changes the résumé font', async () => {
      // The control scales via CSS zoom, so compare the rendered height of a line, not font-size.
      const size = () => page.locator('#resumeOutput').evaluate(o => Math.round((o.querySelector('.resume-a4-page li') || o).getBoundingClientRect().height * 10) / 10);
      const btn = k => page.locator('button:visible', { hasText: new RegExp('^' + k + '$') }).first();
      await btn('S').click(); await page.waitForTimeout(400); const sm = await size();
      await btn('L').click(); await page.waitForTimeout(400); const lg = await size();
      await btn('M').click();
      assert(lg > sm, `L (${lg}px) is not larger than S (${sm}px)`);
      return `bullet line height S=${sm}px → L=${lg}px`;
    }, { severity: 'minor', needs: ['generated'] });

    await s.step('Download DOC gives a Word file containing the résumé', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('button[onclick="downloadDoc()"]:visible').first().click()]);
      const f = await dl.path();
      const body = fs.readFileSync(f, 'utf8');
      assert(/\.docx?$/i.test(dl.suggestedFilename()), 'unexpected filename ' + dl.suggestedFilename());
      assert(body.includes(P.lastName), 'DOC does not contain the candidate name');
      assert(body.length > 2000, 'DOC is suspiciously small: ' + body.length + ' bytes');
      return `${dl.suggestedFilename()} (${Math.round(body.length / 1024)} KB)`;
    }, { severity: 'major', needs: ['generated'] });

    await s.step('Download PDF opens the payment screen (not charged)', async () => {
      await page.locator('button[onclick="downloadPDF()"]:visible').first().click();
      const modal = page.locator('#payModal');
      await modal.waitFor({ state: 'visible', timeout: 15000 });
      const t = await modal.innerText();
      assert(/\$|₹/.test(t) && /Pay/i.test(t), 'payment modal is missing a price or Pay button');
      const price = (t.match(/[$₹]\s?[\d.]+/) || [''])[0];
      await page.locator('#payModal').getByText(/Cancel/).first().click();
      await modal.waitFor({ state: 'hidden', timeout: 5000 });
      return 'price shown: ' + price;
    }, { severity: 'critical', needs: ['generated'] });
  }, { description: 'Every wizard step, the AI helpers, 50+ templates, inline editing and exports.' });
};
