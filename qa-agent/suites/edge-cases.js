'use strict';
/* Journey F — the unhappy paths: missing required fields, non-English names,
 * pasted HTML (must never execute), plus sign-in and the payment gateway —
 * opened to prove they work, never completed. */
const { assert, warn } = require('../lib/harness');
const A = require('../lib/app');

module.exports = async function edgeCases(audit, { base, mockAi }) {
  await audit.suite('Journey F — Validation, security, sign-in & payment gateway', async (s, page) => {
    await s.step('Generate with an empty form → friendly "Required" message, back to step 1', async () => {
      await A.openHome(page, base);
      await page.locator('button[onclick="startBuild()"]').first().click();
      await A.clickSidebar(page, 8);
      await page.locator('#generateBtn').click();
      await page.waitForFunction(() => /Required/i.test([...document.querySelectorAll('.val-banner')].map(b => b.innerText).join(' ')), null, { timeout: 8000 });
      const msg = await page.locator('.val-banner:visible').first().innerText();
      for (const f of ['First Name', 'Last Name', 'Email']) assert(msg.includes(f), `"Required" message does not mention ${f}: ${msg}`);
      assert((await A.activeStep(page)) === 1, 'user not taken back to step 1 to fix the fields');
      return msg.trim();
    }, { severity: 'major' });

    const evil = { first: '<img src=x onerror="window.__xss=1">Ana', last: 'शर्मा O\'Brien & Co', title: '<script>window.__xss2=1</script>Engineer' };
    await s.step('Hindi / apostrophe / ampersand names generate correctly (live AI)', async () => {
      await A.type(page, '#firstName', evil.first);
      await A.type(page, '#lastName', evil.last);
      await A.type(page, '#jobTitle', evil.title);
      await A.type(page, '#email', 'qa.audit@example.com');
      await A.clickSidebar(page, 8);
      const txt = await A.generateAndSettle(page, 'शर्मा');
      assert(txt.includes("O'Brien & Co"), 'special characters were mangled: ' + txt.slice(0, 120));
      s.flags.generated = true;
    }, { severity: 'major', timeout: 150000 });

    await s.step('Security: HTML typed into fields is shown as text, never executed', async () => {
      await page.locator('#previewFab:visible').click().catch(() => {});
      await page.waitForTimeout(800);
      await A.closeTopOverlay(page);
      const r = await page.evaluate(() => ({ xss: window.__xss, xss2: window.__xss2, injectedImg: document.querySelectorAll('#resumeOutput img[src="x"], #previewModalBody img[src="x"]').length }));
      assert(!r.xss && !r.xss2 && !r.injectedImg, 'user input was executed as HTML/JS (XSS): ' + JSON.stringify(r));
      assert((await page.locator('#resumeOutput').innerText()).includes('<img'), 'markup was silently dropped instead of shown as text');
    }, { severity: 'critical', needs: ['generated'] });

    await s.step('Guest draft after a page reload (informational)', async () => {
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const kept = await page.locator('#firstName').inputValue().catch(() => '');
      return kept ? 'draft restored after reload' : 'not kept — guests must sign in to save (by design)';
    }, { severity: 'minor' });

    await s.step('"Sign in" opens Google sign-in (not completed)', async () => {
      if (mockAi) return 'mock mode — Firebase is not reachable offline';
      const btn = page.locator('#_authBtn:visible, button[onclick="signInWithGoogle()"]:visible').first();
      const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null),
        btn.click(),
      ]);
      if (!popup) {
        // Some browsers get a full-page redirect instead of a popup.
        await page.waitForURL(/accounts\.google\.com|\/__\/auth\//, { timeout: 10000 }).catch(() => {});
        assert(/accounts\.google\.com|\/__\/auth\//.test(page.url()), 'no Google sign-in popup or redirect');
        return 'redirect: ' + new URL(page.url()).host;
      }
      await popup.waitForURL(/accounts\.google\.com|\/__\/auth\//, { timeout: 15000 }).catch(() => {});
      const url = popup.url();
      await popup.close().catch(() => {});
      assert(/accounts\.google\.com|\/__\/auth\//.test(url), 'sign-in popup went to an unexpected page: ' + url.slice(0, 100));
      return 'popup: ' + new URL(url).host;
    }, { severity: 'major', timeout: 40000 });

    await s.step('Payment gateway: "Pay & Download PDF" opens Razorpay checkout (not paid)', async () => {
      if (mockAi) return 'mock mode — Razorpay is not reachable offline';
      // A fresh visitor again: build the smallest valid résumé.
      await A.openHome(page, base);
      await page.locator('button[onclick="startBuild()"]').first().click();
      for (const [id, v] of [['firstName', 'Qa'], ['lastName', 'Payment'], ['jobTitle', 'Engineer'], ['email', 'qa.audit@example.com']]) await A.type(page, '#' + id, v);
      await A.clickSidebar(page, 8);
      await A.generateAndSettle(page, 'Payment');
      await page.locator('button[onclick="downloadPDF()"]:visible').first().click();
      await page.locator('#payModal').waitFor({ state: 'visible', timeout: 10000 });
      const order = page.waitForResponse(r => /\.netlify\/functions\/(generate|create-order)/.test(r.url()) && /create-order/.test(r.request().postData() || r.url()), { timeout: 20000 }).catch(() => null);
      await page.locator('#payModal button[onclick^="startRazorpayPayment"], #payModal button:has-text("Pay")').first().click();
      const frame = page.locator('iframe.razorpay-checkout-frame, iframe[src*="razorpay"]').first();
      const opened = await frame.waitFor({ state: 'visible', timeout: 25000 }).then(() => true, () => false);
      const res = await order;
      const orderNote = res ? `order API HTTP ${res.status()}` : 'no order API call';
      assert(opened, 'Razorpay checkout did not open (' + orderNote + ')');
      if (res && res.status() === 501) warn('checkout opened, but server-side orders are off (RAZORPAY_KEY_SECRET not set) — UPI/QR payments may not confirm');
      return 'checkout opened · ' + orderNote;
    }, { severity: 'critical', timeout: 200000 });
  }, { description: 'Required-field validation, Unicode, XSS safety, guest reload, Google sign-in and Razorpay checkout.' });
};
