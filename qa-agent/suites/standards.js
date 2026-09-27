'use strict';
/*
 * Web standards every production site should meet, beyond "the features work":
 *   a11y      WCAG 2.1 AA (axe-core), keyboard use, 320px reflow
 *   perf      Core Web Vitals (LCP, CLS, TBT), page weight — desktop + throttled mobile
 *   seo       per-page title/description/H1/canonical/lang/OG/Twitter/JSON-LD/alt text
 *   security  HTTPS redirect, security headers, mixed content, leaked secrets, cookies
 *   links     broken internal/external links, real 404s, legal pages, manifest
 *   browsers  Safari (WebKit) and Firefox smoke test of the builder
 */
const path = require('path');
const { assert, warn, skip } = require('../lib/harness');
const A = require('../lib/app');
const E = require('../lib/env');

const AXE = require.resolve('axe-core/axe.min.js');

async function sitemapUrls(req, base) {
  const r = await req.get(base + '/sitemap.xml');
  if (!r.ok()) return [base + '/'];
  return [...(await r.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim().replace(/^https?:\/\/[^/]+/, base));
}

const short = u => u.replace(/^https?:\/\/[^/]+/, '') || '/';

// ─────────────────────────────────────────────────────────────── accessibility
async function a11y(audit, { base }) {
  await audit.suite('Standards — Accessibility (WCAG 2.1 AA)', async (s, page) => {
    const scan = async label => {
      await page.addScriptTag({ path: AXE });
      const res = await page.evaluate(() => window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'],
      }));
      const v = res.violations;
      const serious = v.filter(x => x.impact === 'critical' || x.impact === 'serious');
      const fmt = xs => xs.map(x => `${x.id} ×${x.nodes.length} (${x.impact})`).join(', ');
      if (serious.length) throw new Error(`${label}: ${fmt(serious)}${v.length > serious.length ? ' · also: ' + fmt(v.filter(x => !serious.includes(x))) : ''}`);
      if (v.length) warn(`${label}: ${fmt(v)}`);
      return 'no WCAG AA violations';
    };

    await s.step('Homepage passes axe-core WCAG 2.1 AA', async () => {
      await A.openHome(page, base);
      s.flags.home = true;
      return scan('home');
    }, { severity: 'major' });

    await s.step('Builder steps 1–8 pass axe-core WCAG 2.1 AA', async () => {
      await page.locator('button[onclick="startBuild()"]').first().click();
      const problems = [];
      for (let n = 1; n <= 8; n++) {
        await A.clickSidebar(page, n);
        try { await scan('step ' + n); } catch (e) { problems.push(e.message); }
      }
      if (problems.some(p => /\((critical|serious)\)/.test(p))) throw new Error(problems.join(' | '));
      if (problems.length) warn(problems.join(' | '));
      return '8 steps clean';
    }, { severity: 'major', needs: ['home'], timeout: 120000 });

    await s.step('Keyboard only: Tab reaches "Generate Your First Resume", focus is visible, Enter opens builder', async () => {
      await A.openHome(page, base);
      let found = false, visible = false;
      for (let i = 0; i < 40 && !found; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const e = document.activeElement; if (!e) return {};
          const cs = getComputedStyle(e);
          return { cta: e.getAttribute('onclick') === 'startBuild()', ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' };
        });
        if (f.cta) { found = true; visible = f.ring; }
      }
      assert(found, 'main CTA is not reachable with the Tab key');
      await page.keyboard.press('Enter');
      await page.locator('#firstName').waitFor({ state: 'visible', timeout: 5000 });
      if (!visible) warn('CTA is keyboard-reachable but shows no visible focus ring (WCAG 2.4.7)');
    }, { severity: 'major', needs: ['home'] });

    await s.step('Reflow: usable at 320px width / 400% zoom without sideways scrolling (WCAG 1.4.10)', async () => {
      await page.setViewportSize({ width: 320, height: 640 });
      const bad = [];
      await A.openHome(page, base);
      let px = await A.horizontalOverflow(page); if (px > 2) bad.push(`home +${px}px`);
      await page.locator('button[onclick="startBuild()"]').first().click();
      for (const n of [1, 2, 6, 8]) {
        await page.evaluate(k => goToStep(k), n);   // read-only reach; navigation itself is tested elsewhere
        await page.waitForTimeout(300);
        px = await A.horizontalOverflow(page); if (px > 2) bad.push(`step ${n} +${px}px`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      assert(!bad.length, 'content scrolls sideways at 320px: ' + bad.join(', '));
    }, { severity: 'minor', needs: ['home'] });

    await s.step('Every page: <html lang>, zoom not disabled, images have alt text', async () => {
      const urls = await sitemapUrls(page.context().request, base);
      const bad = [];
      for (const u of urls) {
        await page.goto(u, { waitUntil: 'domcontentloaded' });
        const r = await page.evaluate(() => ({
          lang: document.documentElement.getAttribute('lang'),
          zoomLocked: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test((document.querySelector('meta[name=viewport]') || {}).content || ''),
          noAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        }));
        if (!r.lang) bad.push(short(u) + ' no lang');
        if (r.zoomLocked) bad.push(short(u) + ' disables pinch-zoom');
        if (r.noAlt) bad.push(`${short(u)} ${r.noAlt} img without alt`);
      }
      assert(!bad.length, bad.join(' · '));
      return urls.length + ' pages';
    }, { severity: 'minor', timeout: 120000 });
  }, { description: 'axe-core WCAG 2.1 AA scans, keyboard navigation, 320px reflow, lang/zoom/alt text on every page.' });
}

// ─────────────────────────────────────────────────────────────── performance
const VITALS_INIT = () => {
  window.__v = { lcp: 0, cls: 0, tbt: 0 };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__v.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
};

async function measure(page, url) {
  await page.addInitScript(VITALS_INIT);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    const bytes = res.reduce((a, r) => a + (r.transferSize || 0), nav.transferSize || 0);
    return { lcp: Math.round(window.__v.lcp), cls: +window.__v.cls.toFixed(3), tbt: Math.round(window.__v.tbt),
      ttfb: Math.round(nav.responseStart || 0), load: Math.round(nav.loadEventEnd || 0), kb: Math.round(bytes / 1024), requests: res.length + 1,
      htmlKb: Math.round((nav.encodedBodySize || 0) / 1024) };
  });
}

function judge(m, label) {
  // Google's Core Web Vitals thresholds ("good" / "needs improvement" / "poor").
  const poor = [], meh = [];
  if (m.lcp > 4000) poor.push(`LCP ${m.lcp}ms`); else if (m.lcp > 2500) meh.push(`LCP ${m.lcp}ms`);
  if (m.cls > 0.25) poor.push(`CLS ${m.cls}`); else if (m.cls > 0.1) meh.push(`CLS ${m.cls}`);
  if (m.tbt > 600) poor.push(`TBT ${m.tbt}ms`); else if (m.tbt > 200) meh.push(`TBT ${m.tbt}ms`);
  if (m.ttfb > 1800) meh.push(`TTFB ${m.ttfb}ms`);
  if (m.kb > 3000) meh.push(`page weight ${m.kb}KB`);
  const line = `LCP ${m.lcp}ms · CLS ${m.cls} · TBT ${m.tbt}ms · TTFB ${m.ttfb}ms · ${m.kb}KB in ${m.requests} requests (HTML ${m.htmlKb}KB)`;
  if (poor.length) throw new Error(`${label} is POOR on ${poor.join(', ')} — ${line}`);
  if (meh.length) warn(`${label} needs improvement: ${meh.join(', ')} — ${line}`);
  return line;
}

async function perf(audit, { base, env }) {
  await audit.suite('Standards — Performance (Core Web Vitals)', async (s, page) => {
    await s.step('Homepage, desktop', async () => judge(await measure(page, base + '/'), 'desktop'), { severity: 'major', timeout: 90000 });

    await s.step('Homepage, mid-range phone on 4G (4× CPU slowdown)', async () => {
      const ctx = await audit.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' });
      try {
        const p = await ctx.newPage();
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
        return judge(await measure(p, base + '/'), 'mobile');
      } finally { await ctx.close(); }
    }, { severity: 'major', timeout: 150000 });

    await s.step('Every landing page loads in under 3s (desktop)', async () => {
      const urls = (await sitemapUrls(page.context().request, base)).filter(u => short(u) !== '/');
      const slow = [];
      for (const u of urls) {
        const t = Date.now();
        await page.goto(u, { waitUntil: 'load', timeout: 45000 });
        const ms = Date.now() - t;
        if (ms > 3000) slow.push(`${short(u)} ${ms}ms`);
      }
      if (slow.length) warn('slow pages: ' + slow.join(', '));
      return urls.length + ' pages checked';
    }, { severity: 'minor', timeout: 240000 });

    await s.step('Static assets are compressed and cacheable', async () => {
      E.needsDeployed(env, 'Netlify compression & cache headers');
      const req = page.context().request;
      const bad = [];
      const home = await req.get(base + '/', { headers: { 'Accept-Encoding': 'gzip, br' } });
      const enc = home.headers()['content-encoding'];
      if (!enc) bad.push('HTML not compressed (no gzip/br)');
      const html = await home.text();
      const js = (html.match(/src="(\/?app\.js[^"]*)"/) || [])[1];
      for (const asset of [js && '/' + js.replace(/^\//, ''), '/og-image.png', '/favicon-192.png'].filter(Boolean)) {
        const r = await req.get(base + asset);
        const cc = r.headers()['cache-control'] || '';
        if (/no-store|max-age=0\b/.test(cc) || !cc) bad.push(`${asset.split('?')[0]} cache-control "${cc || 'none'}"`);
      }
      if (bad.length) warn(bad.join(' · '));
      return 'HTML encoding: ' + (enc || 'none');
    }, { severity: 'minor' });
  }, { description: 'LCP, CLS, TBT, TTFB and page weight vs Google thresholds; compression and caching.' });
}

// ─────────────────────────────────────────────────────────────── SEO
async function seo(audit, { base }) {
  await audit.suite('Standards — SEO & social sharing', async (s, page) => {
    const urls = await sitemapUrls(page.context().request, base);
    const titles = {};

    await s.step('Every page: title, description, one H1, canonical, lang, viewport', async () => {
      const bad = [];
      for (const u of urls) {
        await page.goto(u, { waitUntil: 'domcontentloaded' });
        const m = await page.evaluate(() => {
          const q = (sel, a = 'content') => { const e = document.querySelector(sel); return e ? (e.getAttribute(a) || '') : null; };
          return { title: document.title.trim(), desc: q('meta[name="description"]'), h1: document.querySelectorAll('h1').length,
            canonical: q('link[rel="canonical"]', 'href'), lang: document.documentElement.lang, viewport: q('meta[name="viewport"]'),
            robots: q('meta[name="robots"]') };
        });
        const p = short(u); titles[m.title] = (titles[m.title] || []).concat(p);
        if (m.title.length < 10 || m.title.length > 70) bad.push(`${p} title ${m.title.length} chars`);
        if (!m.desc) bad.push(`${p} no meta description`); else if (m.desc.length < 50 || m.desc.length > 170) bad.push(`${p} description ${m.desc.length} chars`);
        if (m.h1 !== 1) bad.push(`${p} has ${m.h1} <h1>`);
        if (!m.canonical) bad.push(`${p} no canonical`); else if (!/^https:\/\//.test(m.canonical)) bad.push(`${p} canonical not absolute https`);
        if (!m.viewport) bad.push(`${p} no viewport meta`);
        if (m.robots && /noindex/i.test(m.robots)) bad.push(`${p} is NOINDEX`);
      }
      const dup = Object.entries(titles).filter(([, ps]) => ps.length > 1).map(([t, ps]) => `"${t.slice(0, 40)}" on ${ps.join(', ')}`);
      if (dup.length) bad.push('duplicate titles: ' + dup.join('; '));
      if (bad.some(b => /NOINDEX|no meta description|no canonical/.test(b))) throw new Error(bad.join(' · '));
      if (bad.length) warn(bad.join(' · '));
      return urls.length + ' pages';
    }, { severity: 'major', timeout: 180000 });

    await s.step('Social previews: Open Graph + Twitter card tags, OG image loads (1200×630)', async () => {
      const bad = []; const images = new Set();
      for (const u of urls) {
        await page.goto(u, { waitUntil: 'domcontentloaded' });
        const m = await page.evaluate(() => Object.fromEntries(['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']
          .map(k => [k, (document.querySelector(`meta[property="${k}"], meta[name="${k}"]`) || {}).content || ''])));
        const missing = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length) bad.push(`${short(u)} missing ${missing.join(', ')}`);
        if (m['og:image']) images.add(m['og:image']);
      }
      for (const img of images) {
        const p2 = await page.context().newPage();
        try {
          const r = await p2.goto(img.replace(/^https?:\/\/[^/]+/, base));
          if (!r || !r.ok()) { bad.push(`og:image ${short(img)} HTTP ${r && r.status()}`); continue; }
          const dim = await p2.evaluate(() => { const i = document.querySelector('img'); return i ? [i.naturalWidth, i.naturalHeight] : [0, 0]; });
          if (dim[0] < 1200 || dim[1] < 600) bad.push(`og:image ${short(img)} is ${dim.join('×')} (recommended 1200×630)`);
        } finally { await p2.close(); }
      }
      if (bad.some(b => /og:image .* HTTP|missing og:title|missing og:image/.test(b))) throw new Error(bad.join(' · '));
      if (bad.length) warn(bad.join(' · '));
    }, { severity: 'minor', timeout: 180000 });

    await s.step('Structured data (JSON-LD) is valid JSON with @context/@type', async () => {
      const bad = []; let blocks = 0;
      for (const u of urls) {
        await page.goto(u, { waitUntil: 'domcontentloaded' });
        const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
        for (const j of raw) {
          blocks++;
          try { const d = JSON.parse(j); const items = [].concat(d['@graph'] || d); if (!items.every(x => x['@type'])) bad.push(`${short(u)} JSON-LD item without @type`); if (!d['@context']) bad.push(`${short(u)} JSON-LD without @context`); }
          catch (e) { bad.push(`${short(u)} invalid JSON-LD: ${e.message.slice(0, 60)}`); }
        }
      }
      assert(!bad.length, bad.join(' · '));
      if (!blocks) warn('no structured data on any page');
      return blocks + ' JSON-LD blocks valid';
    }, { severity: 'minor', timeout: 180000 });

    await s.step('robots.txt allows crawling and points to the sitemap', async () => {
      const r = await page.context().request.get(base + '/robots.txt');
      const t = await r.text();
      assert(/Sitemap:\s*https?:\/\/\S+sitemap\.xml/i.test(t), 'robots.txt has no Sitemap: line');
      assert(!/User-agent:\s*\*\s*\n\s*Disallow:\s*\/\s*$/im.test(t), 'robots.txt blocks all crawlers');
    }, { severity: 'major' });
  }, { description: 'Titles, descriptions, H1, canonical, noindex, duplicates, OG/Twitter previews, JSON-LD, robots.' });
}

// ─────────────────────────────────────────────────────────────── security
async function security(audit, { base, env }) {
  await audit.suite('Standards — Security & privacy', async (s, page) => {
    const req = page.context().request;

    await s.step('HTTP redirects to HTTPS', async () => {
      if (!base.startsWith('https://')) skip('environment-limited: target is not served over https (local server)');
      const r = await req.get(base.replace('https://', 'http://') + '/', { maxRedirects: 0 });
      assert([301, 308].includes(r.status()) && /^https:/.test(r.headers()['location'] || ''), `http:// → HTTP ${r.status()} ${r.headers()['location'] || ''}`);
    }, { severity: 'major' });

    await s.step('Security headers (HSTS, nosniff, clickjacking, referrer, CSP)', async () => {
      E.needsDeployed(env, 'Netlify response headers');
      const h = (await req.get(base + '/')).headers();
      const miss = [], soft = [];
      if (!/max-age=\d{7,}/.test(h['strict-transport-security'] || '')) miss.push('Strict-Transport-Security (≥ 1 year)');
      if ((h['x-content-type-options'] || '').toLowerCase() !== 'nosniff') miss.push('X-Content-Type-Options: nosniff');
      if (!h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] || '')) miss.push('X-Frame-Options or CSP frame-ancestors (clickjacking)');
      if (!h['referrer-policy']) soft.push('Referrer-Policy');
      if (!h['content-security-policy']) soft.push('Content-Security-Policy');
      if (!h['permissions-policy']) soft.push('Permissions-Policy');
      if (miss.length) throw new Error('missing: ' + miss.join(', ') + (soft.length ? ' · also recommended: ' + soft.join(', ') : ''));
      if (soft.length) warn('recommended: ' + soft.join(', '));
    }, { severity: 'major' });

    await s.step('No mixed content, no insecure cookies', async () => {
      const insecure = [];
      page.on('request', r => { if (/^http:\/\//.test(r.url()) && !/localhost|127\.0\.0\.1/.test(r.url())) insecure.push(r.url().slice(0, 90)); });
      await A.openHome(page, base);
      await page.locator('button[onclick="startBuild()"]').first().click();
      await page.waitForTimeout(2000);
      const cookies = (await page.context().cookies()).filter(c => base.includes(c.domain.replace(/^\./, '')));
      const badC = cookies.filter(c => base.startsWith('https') && (!c.secure || c.sameSite === 'None' && !c.secure)).map(c => c.name);
      assert(!insecure.length, 'insecure http:// requests: ' + insecure.join(', '));
      assert(!badC.length, 'cookies without Secure: ' + badC.join(', '));
    }, { severity: 'major' });

    await s.step('No private keys or server secrets in public files', async () => {
      const html = await (await req.get(base + '/')).text();
      const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u) || u.startsWith(base));
      const bodies = [['index.html', html]];
      for (const s2 of srcs) bodies.push([s2, await (await req.get(s2.startsWith('http') ? s2 : base + '/' + s2.replace(/^\//, ''))).text()]);
      const PATTERNS = [
        [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'], [/AKIA[0-9A-Z]{16}/, 'AWS access key'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
        [/gh[pousr]_[A-Za-z0-9]{36}/, 'GitHub token'], [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'], [/sk_live_[A-Za-z0-9]{20,}/, 'Stripe secret'],
        [/RAZORPAY_KEY_SECRET\s*[:=]\s*['"][A-Za-z0-9]{10,}/, 'Razorpay secret'], [/PDFSHIFT_API_KEY\s*[:=]\s*['"][A-Za-z0-9]/, 'PDFShift key'],
      ];
      const hits = [];
      for (const [name, body] of bodies) for (const [re, what] of PATTERNS) if (re.test(body)) hits.push(`${what} in ${name}`);
      assert(!hits.length, 'SECRET EXPOSED: ' + hits.join(', '));
      return bodies.length + ' files scanned';
    }, { severity: 'critical' });

    await s.step('Backend rejects bad requests (no stack traces, method limits)', async () => {
      E.needsDeployed(env, 'Netlify functions');
      const fn = base + '/.netlify/functions/generate';
      const get = await req.get(fn);
      assert(get.status() === 405, 'GET on the AI endpoint → HTTP ' + get.status() + ' (expected 405)');
      const bad = await req.post(fn, { data: '{not json', headers: { 'Content-Type': 'application/json' } });
      const t = await bad.text();
      assert(bad.status() >= 400 && bad.status() < 600, 'malformed JSON → HTTP ' + bad.status());
      assert(!/at \w+ \(|node_modules|\/var\/task/.test(t), 'error response leaks a stack trace: ' + t.slice(0, 120));
    }, { severity: 'minor' });
  }, { description: 'HTTPS, security headers, mixed content, cookies, secret leaks and backend hardening.' });
}

// ─────────────────────────────────────────────────────────────── links & compliance
async function links(audit, { base }) {
  await audit.suite('Standards — Links, 404s & legal pages', async (s, page) => {
    const req = page.context().request;
    const urls = await sitemapUrls(req, base);
    const internal = new Set(), external = new Set();

    await s.step('No broken internal links on any page', async () => {
      for (const u of urls) {
        await page.goto(u, { waitUntil: 'domcontentloaded' });
        const hrefs = await page.$$eval('a[href]', as => as.map(a => a.href));
        for (const h of hrefs) {
          if (!/^https?:/.test(h)) continue;
          const clean = h.split('#')[0];
          if (clean.startsWith(base) || /resume4u\.help/.test(clean)) internal.add(clean.replace(/^https?:\/\/(www\.)?resume4u\.help/, base));
          else external.add(clean);
        }
      }
      const broken = [];
      await Promise.all([...internal].map(async l => { const r = await req.get(l, { timeout: 30000 }).catch(() => null); if (!r || r.status() >= 400) broken.push(`${r ? r.status() : 'ERR'} ${short(l)}`); }));
      assert(!broken.length, broken.length + ' broken: ' + broken.slice(0, 10).join(', '));
      return internal.size + ' internal links OK';
    }, { severity: 'major', timeout: 240000 });

    await s.step('External links resolve', async () => {
      const broken = [];
      await Promise.all([...external].slice(0, 60).map(async l => {
        const r = await req.get(l, { timeout: 20000, maxRedirects: 5 }).catch(() => null);
        // Many sites (LinkedIn, WhatsApp) block bots with 403/429/999 — only real "gone" codes count.
        if (!r) broken.push('ERR ' + l.slice(0, 70)); else if ([404, 410].includes(r.status()) || r.status() >= 500) broken.push(r.status() + ' ' + l.slice(0, 70));
      }));
      if (broken.length) warn(broken.join(', '));
      return external.size + ' external links';
    }, { severity: 'minor', timeout: 120000 });

    await s.step('Unknown URL returns a real 404 (not a "soft 404")', async () => {
      const r = await req.get(base + '/qa-audit-no-such-page-' + Date.now());
      assert(r.status() === 404, 'missing page returns HTTP ' + r.status() + ' — search engines will index junk URLs');
    }, { severity: 'minor' });

    await s.step('Legal pages: Privacy Policy, Terms, Refund/Cancellation, Contact', async () => {
      // Required by Razorpay for live payments, by Google for OAuth sign-in, and
      // by India's DPDP Act 2023 for sites collecting personal data.
      await A.openHome(page, base);
      const found = await page.evaluate(() => {
        const as = [...document.querySelectorAll('a[href]')].map(a => (a.innerText + ' ' + a.getAttribute('href')).toLowerCase());
        const has = re => as.some(t => re.test(t));
        return { privacy: has(/privacy/), terms: has(/terms|conditions/), refund: has(/refund|cancell?ation/), contact: has(/contact|mailto:|wa\.me/) };
      });
      const missing = Object.entries(found).filter(([, v]) => !v).map(([k]) => k);
      assert(!missing.filter(m => m !== 'contact').length, 'no link to: ' + missing.join(', ') + ' — required for Razorpay payments, Google sign-in and India\'s DPDP Act');
      if (missing.includes('contact')) warn('no contact link');
    }, { severity: 'major' });

    await s.step('Web app manifest is valid (name, icons, start_url, theme)', async () => {
      const r = await req.get(base + '/site.webmanifest');
      assert(r.ok(), 'manifest HTTP ' + r.status());
      const m = JSON.parse(await r.text());
      const miss = ['name', 'short_name', 'start_url', 'display', 'theme_color', 'background_color'].filter(k => !m[k]);
      const sizes = (m.icons || []).map(i => i.sizes);
      if (!sizes.includes('192x192')) miss.push('192×192 icon');
      if (!sizes.includes('512x512')) miss.push('512×512 icon');
      if (miss.length) warn('manifest missing: ' + miss.join(', '));
    }, { severity: 'minor' });
  }, { description: 'Broken internal/external links, real 404s, legally required pages and the PWA manifest.' });
}

// ─────────────────────────────────────────────────────────────── other browsers
async function browsers(audit, { base, mockAi }) {
  const pw = require('playwright');
  for (const [name, type, dev] of [['Safari (WebKit, iPhone)', 'webkit', 'iPhone 13'], ['Firefox (desktop)', 'firefox', null]]) {
    let browser;
    try { browser = await pw[type].launch(); } catch (e) { browser = null; }
    const prev = audit.browser;
    if (browser) audit.browser = browser;
    await audit.suite('Standards — ' + name, async (s, page) => {
      if (!browser) {
        await s.step('Browser available', async () => skip(`environment-limited: ${type} is not installed on this runner (CI installs it)`), { severity: 'minor' });
        return;
      }
      await s.step('Homepage loads without JavaScript errors', async () => {
        await A.openHome(page, base);
        await page.waitForTimeout(1500);
        assert(!s.pageErrors.length, 'JS errors: ' + s.pageErrors.slice(0, 3).join(' | '));
        s.flags.home = true;
      }, { severity: 'critical' });
      await s.step('Builder: fill basic info, move through steps, live preview shows it', async () => {
        await page.locator('button[onclick="startBuild()"]').first().click();
        for (const [id, v] of [['firstName', 'Qa'], ['lastName', 'Browser'], ['jobTitle', 'Engineer'], ['email', 'qa.audit@example.com']]) await A.type(page, '#' + id, v);
        for (const n of [2, 3, 4, 5, 6, 7, 8]) await A.goNext(page, n);
        await page.locator('#previewFab:visible, button[onclick="openPreviewModal()"]:visible').first().click();
        await page.waitForFunction(() => /Browser/i.test((document.getElementById('previewModalBody') || {}).innerText || ''), null, { timeout: 10000 });
        assert(!s.pageErrors.length, 'JS errors: ' + s.pageErrors.slice(0, 3).join(' | '));
        if (dev) { const px = await A.horizontalOverflow(page); assert(px <= 2, `sideways scroll ${px}px on iPhone Safari`); }
      }, { severity: 'critical', needs: ['home'], timeout: 90000 });
    }, { contextOptions: dev ? { ...pw.devices[dev] } : {}, description: 'Builder smoke test in a non-Chromium engine (no AI call).' });
    audit.browser = prev;
    if (browser) await browser.close();
  }
}

module.exports = { a11y, perf, seo, security, links, browsers };
