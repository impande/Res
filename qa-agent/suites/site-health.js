'use strict';
/* Site health: every public URL, static assets, third-party dependencies the
 * builder needs, and side-effect-free backend endpoints. */
const { assert, warn } = require('../lib/harness');
const { openHome } = require('../lib/app');
const E = require('../lib/env');

module.exports = async function siteHealth(audit, { base, mockAi, env }) {
  await audit.suite('Site health & SEO pages', async (s, page) => {
    const req = page.context().request;

    await s.step('Homepage loads fast with correct title', async () => {
      const t = Date.now();
      await openHome(page, base);
      const ms = Date.now() - t;
      const title = await page.title();
      assert(/resume/i.test(title), 'unexpected <title>: ' + title);
      s.flags.home = true;
      if (ms > 8000) warn(`homepage took ${ms}ms to become interactive`);
      return `interactive in ${ms}ms`;
    }, { severity: 'critical' });

    await s.step('Live build stamp is present', async () => {
      const stamp = await page.evaluate(() => (document.getElementById('_buildStamp') || {}).innerText || '');
      audit.buildId = stamp.replace(/^build\s*/i, '').trim();
      if (/__BUILD_ID__/.test(stamp)) warn('build id placeholder not replaced (' + stamp + ') — is this a raw, un-built page?');
      return audit.buildId || 'no stamp';
    }, { severity: 'minor', needs: ['home'] });

    await s.step('Hero, sidebar steps and CTAs render', async () => {
      const steps = await page.locator('li[onclick^="goToStep("]:visible').count();
      assert(steps === 8, `expected 8 wizard steps in the sidebar, saw ${steps}`);
      assert(await page.locator('button[onclick="openPortfolioBuilder()"]:visible').count(), 'portfolio CTA missing');
      assert(await page.locator('#_authBtn:visible').count(), 'sign-in button missing');
    }, { severity: 'major', needs: ['home'] });

    let urls = [];
    await s.step('sitemap.xml is valid and lists pages', async () => {
      const r = await req.get(base + '/sitemap.xml');
      assert(r.ok(), 'sitemap HTTP ' + r.status());
      const xml = await r.text();
      urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
      assert(urls.length >= 5, 'sitemap has only ' + urls.length + ' URLs');
      return urls.length + ' URLs';
    }, { severity: 'major' });

    await s.step('Every sitemap page returns 200 with a title & description', async () => {
      const bad = [];
      await Promise.all(urls.map(async u => {
        const url = u.replace(/^https?:\/\/[^/]+/, base);    // test the target deployment
        try {
          const r = await req.get(url, { timeout: 30000 });
          const html = r.ok() ? await r.text() : '';
          if (!r.ok()) bad.push(`${r.status()} ${url}`);
          else if (!/<title>[^<]{5,}<\/title>/i.test(html)) bad.push('no <title>: ' + url);
          else if (!/<meta\s+name=["']description["']/i.test(html)) bad.push('no meta description: ' + url);
        } catch (e) { bad.push('error ' + url + ': ' + e.message.slice(0, 80)); }
      }));
      assert(!bad.length, bad.length + ' page(s) broken: ' + bad.slice(0, 6).join(' | '));
      return urls.length + ' pages OK';
    }, { severity: 'major', timeout: 120000 });

    await s.step('Static assets: robots, manifest, favicons, OG image, service worker', async () => {
      const paths = ['/robots.txt', '/site.webmanifest', '/favicon.svg', '/favicon-192.png', '/apple-touch-icon.png', '/og-image.png', '/sw.js', '/llms.txt'];
      const bad = [];
      for (const p of paths) { const r = await req.get(base + p); if (!r.ok()) bad.push(r.status() + ' ' + p); }
      assert(!bad.length, 'missing: ' + bad.join(', '));
    }, { severity: 'minor' });

    await s.step('Shared-link viewers /r/ and /p/ are served', async () => {
      for (const p of ['/r/does-not-exist-qa', '/p/does-not-exist-qa']) {
        const r = await req.get(base + p);
        assert(r.status() < 500, `${p} → HTTP ${r.status()}`);
      }
    }, { severity: 'major' });

    await s.step('Third-party scripts reachable (Firebase, Razorpay)', async () => {
      const deps = [['firebase', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js'],
        ['firebase', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js'],
        ['razorpay', 'https://checkout.razorpay.com/v1/checkout.js']];
      const testable = deps.filter(([k]) => !(env && env.unreachable.includes(k)));
      if (!testable.length) E.needs(env, ...new Set(deps.map(d => d[0])));
      const bad = [];
      for (const [, d] of testable) { try { const r = await req.get(d, { timeout: 20000 }); if (!r.ok()) bad.push(r.status() + ' ' + d); } catch (e) { bad.push('unreachable ' + d); } }
      assert(!bad.length, bad.join(' | '));
      const limited = deps.length - testable.length;
      return testable.length + ' OK' + (limited ? ` · ${limited} environment-limited` : '');
    }, { severity: 'major' });

    await s.step('Backend: generate function is up (CORS preflight + paid-status check)', async () => {
      E.needsDeployed(env, 'Netlify functions');
      if (mockAi) return 'mock mode — skipped live backend probe';
      const fn = base + '/.netlify/functions/generate';
      const pre = await req.fetch(fn, { method: 'OPTIONS', headers: { Origin: base } });
      assert(pre.status() === 204, 'OPTIONS → HTTP ' + pre.status());
      // 'check-paid' is read-only and never grants access, so it is safe to call daily.
      const r = await req.post(fn, { data: { action: 'check-paid', email: 'qa.audit@example.com' }, headers: { Origin: base } });
      assert(r.ok(), 'check-paid → HTTP ' + r.status());
      const j = await r.json();
      assert(j.paid === false, 'unexpected paid flag for the audit account: ' + JSON.stringify(j));
    }, { severity: 'critical' });
  }, { description: 'Every public page, asset and dependency the site relies on.' });
};
