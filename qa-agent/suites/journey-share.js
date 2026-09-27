'use strict';
/* Journey B — after building a résumé, the user shares it (QR + /r/ link),
 * writes a cover letter for a specific job, and uses the "Refine with AI"
 * assistant (ATS breakdown, ATS match to a job, bullet coach, summary rewrite).
 * The assistant is used right after generating — when its tool menu shows. */
const fs = require('fs');
const { assert, warn, skip } = require('../lib/harness');
const A = require('../lib/app');
const { quickBuild } = require('../lib/flows');
const { persona: P, jobDescription } = require('../lib/fixtures');

module.exports = async function journeyShare(audit, { base, publish }) {
  await audit.suite('Journey B — Share link/QR, cover letter & AI assistant', async (s, page) => {
    await quickBuild(s, page, base, P);

    // ── Share / QR → public /r/ page ─────────────────────────────────────
    let slug = null;
    await s.step('Share / QR publishes the résumé and shows a scannable QR', async () => {
      if (!publish) skip('PUBLISH=0 — not creating public pages');
      const patch = page.waitForRequest(r => r.method() === 'PATCH' && /\/documents\/portfolios\//.test(r.url()), { timeout: 30000 });
      const done = page.waitForResponse(r => r.request().method() === 'PATCH' && /\/documents\/portfolios\//.test(r.url()), { timeout: 30000 });
      await page.locator('button[onclick="_r4uShareResumeQR()"]:visible').first().click();
      slug = decodeURIComponent((await patch).url().match(/portfolios\/([^?]+)/)[1]);
      const res = await done;
      assert(res.ok(), 'publishing to Firestore failed: HTTP ' + res.status());
      const ov = page.locator('#_r4uQRov');
      await ov.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForFunction(() => /QR code|Scan/i.test((document.getElementById('_r4uQRov') || {}).innerText || ''), null, { timeout: 15000 });
      const txt = await ov.innerText();
      assert(!/Couldn.t publish|try again/i.test(txt), 'share overlay shows an error: ' + txt.slice(0, 120));
      assert(await ov.locator('img, canvas, svg').count(), 'no QR image in the overlay');
      s.flags.shared = true;
      return '/r/' + slug;
    }, { severity: 'major', needs: ['generated'], timeout: 60000 });

    await s.step('"Download QR" saves a PNG', async () => {
      const btn = page.locator('#_r4uQRov').getByText(/Download QR/i).first();
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), btn.click()]);
      const size = fs.statSync(await dl.path()).size;
      assert(size > 500, 'QR file is only ' + size + ' bytes');
      return `${dl.suggestedFilename()} (${Math.round(size / 1024)} KB)`;
    }, { severity: 'minor', needs: ['shared'] });

    await A.closeTopOverlay(page);

    await s.step('Shared /r/ link opens the résumé for a visitor (fits the screen)', async () => {
      // A recruiter scanning the QR: brand-new browser, phone-sized screen.
      const ctx = await audit.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      try {
        if (audit.opts.beforePage) await audit.opts.beforePage(await ctx.newPage(), ctx);   // mock mode reuses its fake store
        const v = ctx.pages()[0] || await ctx.newPage();
        s.watch(v);
        const res = await v.goto(base + '/r/' + encodeURIComponent(slug), { waitUntil: 'domcontentloaded', timeout: 30000 });
        assert(res && res.status() < 400, '/r/ returned HTTP ' + (res && res.status()));
        await v.waitForFunction(n => (document.body.innerText || '').toLowerCase().includes(n.toLowerCase()), P.lastName, { timeout: 25000 });
        await v.waitForTimeout(1500);           // let the viewer's fit-to-screen settle
        const fit = await v.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
          // Anything with text that sticks out past the right edge is "cut off".
          const cut = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && (e.innerText || '').trim() && e.getBoundingClientRect().right > vw + 2).length;
          return { vw, sw, cut };
        });
        await v.screenshot({ path: require('path').join(audit.shotDir, 'shared-r-viewer-mobile.png') });
        assert(fit.sw <= fit.vw + 2 && fit.cut === 0, `shared résumé is cut off on a phone: page ${fit.sw}px wide in a ${fit.vw}px screen, ${fit.cut} text element(s) off-screen`);
      } finally { await ctx.close(); }
    }, { severity: 'major', needs: ['shared'], timeout: 60000 });

    // ── Refine with AI assistant ─────────────────────────────────────────
    const tool = name => page.locator('#aiChatPanel .airx-tool', { hasText: name }).last();
    const backToMenu = async () => {
      const b = page.locator('#aiChatMessages .aig-back', { hasText: 'Back to menu' }).last();
      if (await b.count()) await b.click();
      await tool('ATS breakdown').waitFor({ state: 'visible', timeout: 10000 });
    };

    await s.step('"Refine with AI" opens with analysis, ATS score and tool menu', async () => {
      await A.closeTopOverlay(page);
      await page.locator('#aiChatCta').click();
      await page.locator('#aiChatPanel').waitFor({ state: 'visible', timeout: 10000 });
      // The full analysis + tool menu replaces the first quick greeting a moment later.
      await tool('ATS breakdown').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      const t = await page.locator('#aiChatMessages').innerText();
      assert(await tool('ATS breakdown').count(), 'tool menu missing — assistant says: ' + t.replace(/\s+/g, ' ').slice(0, 140));
      assert(t.includes(P.firstName), 'assistant does not greet the user by name');
      assert(/\d+\s*\/\s*100/.test(t), 'assistant does not show the ATS score');
      s.flags.chat = true;
    }, { severity: 'major', needs: ['generated'] });

    await s.step('AI tool: ATS breakdown lists what passes and what is missing', async () => {
      try {
        await tool('ATS breakdown').click();
        await page.waitForFunction(() => document.querySelectorAll('#aiChatMessages .airx-ats-row, #aiChatMessages [class*="ats"]').length > 3 || /✅/.test(document.getElementById('aiChatMessages').innerText), null, { timeout: 10000 });
        const t = await page.locator('#aiChatMessages').innerText();
        const passes = (t.match(/✅/g) || []).length;
        assert(passes >= 5, 'breakdown shows only ' + passes + ' passing checks');
        return passes + ' checks passing';
      } finally {
        await backToMenu().catch(() => {});
      }
    }, { severity: 'minor', needs: ['chat'] });

    await s.step('AI tool: ATS match to a job scores keyword match (live AI)', async () => {
      try {
        await tool('ATS match to a job').click();
        const ta = page.locator('#aiChatPanel textarea:visible').last();
        await ta.fill(jobDescription);
        await page.locator('#aiChatMessages button', { hasText: 'Check match' }).last().click();
        await page.waitForFunction(() => /ATS match:\s*\d+%|Could not read/.test(document.getElementById('aiChatMessages').innerText), null, { timeout: 90000, polling: 500 });
        const t = await page.locator('#aiChatMessages').innerText();
        assert(!/Could not read/.test(t), 'AI could not read the job description');
        const pct = (t.match(/ATS match:\s*(\d+)%/) || [])[1];
        const terms = (t.match(/(\d+) of (\d+) key terms/) || [])[0] || '';
        s.flags.atsMatch = true;
        return pct + '% match (' + terms + ')';
      } finally {
        if (!s.flags.atsMatch) await backToMenu().catch(() => {});
      }
    }, { severity: 'major', needs: ['chat'], timeout: 100000 });

    await s.step('AI tool: "Tailor my résumé to this job" rewrites it for the JD (live AI)', async () => {
      try {
        const before = await page.locator('#resumeOutput').innerText();
        await page.locator('#aiChatMessages button', { hasText: 'Tailor my résumé' }).last().click();
        await page.waitForFunction(() => /Tailored to this job|couldn.t|failed/i.test(document.getElementById('aiChatMessages').innerText), null, { timeout: 120000, polling: 500 });
        const t = await page.locator('#aiChatMessages').innerText();
        assert(/Tailored to this job/.test(t), 'tailoring did not finish: ' + t.replace(/\s+/g, ' ').slice(-160));
        const after = await page.locator('#resumeOutput').innerText();
        assert(after !== before, 'résumé text did not change after tailoring');
        assert(after.toLowerCase().includes(P.lastName.toLowerCase()), 'candidate name lost after tailoring');
        return (t.match(/Updated: ([^\n.]+)/) || [])[1] || 'tailored';
      } finally {
        await backToMenu().catch(() => {});
      }
    }, { severity: 'major', needs: ['atsMatch'], timeout: 130000 });

    await s.step('AI tool: Bullet coach reviews bullets', async () => {
      try {
        await tool('Bullet coach').click();
        await page.waitForFunction(() => /Bullet coach/.test(document.getElementById('aiChatMessages').innerText) &&
          /strong|weak|metric|verb|improve|fix/i.test(document.getElementById('aiChatMessages').innerText.split('Bullet coach').pop()), null, { timeout: 60000, polling: 500 });
      } finally {
        await backToMenu().catch(() => {});
      }
    }, { severity: 'minor', needs: ['chat'], timeout: 70000 });

    await s.step('AI tool: Rewrite summary proposes a new summary (live AI)', async () => {
      try {
        await tool('Rewrite summary').click();
        // Each tool clears the chat and renders its own view; wait for it to finish loading.
        await page.waitForFunction(() => {
          const t = document.getElementById('aiChatMessages').innerText;
          return !/Or pick any tool/.test(t) && /summary/i.test(t) && t.length > 150 && !/thinking|writing…|generating|crafting/i.test(t.slice(-120));
        }, null, { timeout: 90000, polling: 500 });
        const t = await page.locator('#aiChatMessages').innerText();
        if (/couldn.t|error|try again/i.test(t)) warn('assistant replied with an error: ' + t.replace(/\s+/g, ' ').slice(0, 140));
      } finally {
        await backToMenu().catch(() => {});
      }
    }, { severity: 'minor', needs: ['chat'], timeout: 100000 });

    await s.step('Close the AI assistant', async () => {
      await page.locator('#aiCloseBtn').click();
      await page.locator('#aiChatPanel').waitFor({ state: 'hidden', timeout: 5000 });
    }, { severity: 'minor', needs: ['chat'] });

    // ── Cover letter ─────────────────────────────────────────────────────
    await s.step('Cover letter: fill company, role & job description, pick a tone', async () => {
      await A.closeTopOverlay(page);
      await page.locator('button[onclick="openCoverLetter()"]:visible').first().click();
      await page.locator('#cl-company').waitFor({ state: 'visible', timeout: 10000 });
      await A.type(page, '#cl-company', 'Razorpay');
      await A.type(page, '#cl-role', 'Senior Software Engineer');
      await page.locator('#cl-jd').fill(jobDescription);
      await page.locator('#clToneChips .chip', { hasText: 'Enthusiastic' }).click();
      assert(await page.locator('#clToneChips .chip.selected', { hasText: 'Enthusiastic' }).count(), 'tone chip did not select');
      s.flags.clForm = true;
    }, { severity: 'major', needs: ['generated'] });

    await s.step('Cover letter: generate with AI (live)', async () => {
      await page.locator('#clGenBtn').click();
      await page.locator('#clOutput').waitFor({ state: 'visible', timeout: 90000 });
      await page.waitForFunction(() => (document.getElementById('clText').innerText || document.getElementById('clText').value || '').trim().length > 200, null, { timeout: 90000, polling: 500 });
      const t = await page.locator('#clText').evaluate(e => e.innerText || e.value);
      assert(!/error|failed|try again/i.test(t.slice(0, 120)), 'cover letter shows an error: ' + t.slice(0, 120));
      s.flags.cl = true;
      return t.trim().split(/\s+/).length + ' words';
    }, { severity: 'major', needs: ['clForm'], timeout: 100000 });

    await s.step('Cover letter: download as DOC', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('button[onclick="downloadCoverLetterDoc()"]').click()]);
      const body = fs.readFileSync(await dl.path(), 'utf8');
      assert(body.length > 500, 'cover letter DOC is only ' + body.length + ' bytes');
      return dl.suggestedFilename();
    }, { severity: 'minor', needs: ['cl'] });

  }, { description: 'Publishing & opening the share link, cover-letter generation and the AI refine tools.' });
};
