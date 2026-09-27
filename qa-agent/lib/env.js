'use strict';
/*
 * Environment probe: which third-party hosts can THIS runner reach?
 *
 * The audit must not report "your site is broken" when the machine running it
 * simply has no route to a CDN (sandboxes, corporate proxies). Checks that need
 * an unreachable host are downgraded:
 *   - on GitHub Actions (open egress) → WARN: the host really is unreachable,
 *     which may be an outage worth knowing about, but it isn't this site's code;
 *   - anywhere else                   → SKIP, labelled "environment-limited".
 * Checks against a localhost target also skip server-config assertions
 * (security headers, compression, Netlify functions) that only exist on Netlify.
 */
const { skip, warn } = require('./harness');

const HOSTS = {
  firebase: 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  razorpay: 'https://checkout.razorpay.com/v1/checkout.js',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  fonts: 'https://fonts.googleapis.com/css2?family=Inter',
  firestore: 'https://firestore.googleapis.com/',
  github: 'https://api.github.com/',
  google: 'https://accounts.google.com/',
};

async function probe(browser, base) {
  // Probe through the browser's own network stack — the route the page uses.
  // A no-cors fetch resolves (opaque) if the host answers and rejects on a
  // network/TLS/proxy failure.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const out = await page.evaluate(async hosts => {
    const res = {};
    await Promise.all(Object.entries(hosts).map(async ([k, url]) => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
      try { await fetch(url, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' }); res[k] = true; }
      catch (e) { res[k] = false; }
      clearTimeout(t);
    }));
    return res;
  }, HOSTS);
  await ctx.close();
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(base);
  return {
    local,
    ci: !!process.env.GITHUB_ACTIONS,
    reachable: out,
    unreachable: Object.keys(out).filter(k => !out[k]),
    hostOf: k => new URL(HOSTS[k]).host,
  };
}

/** Call at the top of a step that needs these hosts. */
function needs(env, ...keys) {
  if (!env) return;
  const missing = keys.filter(k => env.unreachable.includes(k));
  if (!missing.length) return;
  const hosts = missing.map(env.hostOf).join(', ');
  if (env.ci) warn(`${hosts} unreachable from the CI runner — possible third-party outage; step not run`);
  skip(`environment-limited: ${hosts} unreachable from this runner`);
}

/** Call at the top of a step that asserts Netlify server config. */
function needsDeployed(env, what) {
  if (env && env.local) skip(`environment-limited: ${what} only exists on the deployed site (target is a local server)`);
}

module.exports = { probe, needs, needsDeployed, HOSTS };
