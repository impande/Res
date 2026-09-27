'use strict';
/*
 * Minimal audit harness.
 *
 * Unlike a unit-test runner, an audit must keep going after a failure so the
 * morning report shows *everything* that is broken, not just the first thing.
 * Each suite gets a fresh browser context (a brand-new visitor), and each step
 * is recorded as pass / fail / warn / skip with its duration. A failing step
 * saves a screenshot; a step whose prerequisite failed is skipped, not failed,
 * so one root cause doesn't show up as twenty red rows.
 */
const fs = require('fs');
const path = require('path');

class SkipError extends Error {}
class WarnError extends Error {}

// Third-party noise that says nothing about the site's health.
const NOISE = [
  /google-analytics|googletagmanager|doubleclick|clarity\.ms|facebook|hotjar/i,
  /favicon\.ico/i,
  /net::ERR_ABORTED/i,              // navigations cancelling in-flight requests
  /ResizeObserver loop/i,
];
const isNoise = s => NOISE.some(re => re.test(s));

class Suite {
  constructor(audit, name, opts) {
    this.audit = audit;
    this.name = name;
    this.opts = opts;
    this.steps = [];
    this.flags = {};                // shared state between steps, e.g. flags.generated
    this.pageErrors = [];
    this.consoleErrors = [];
    this.failedRequests = [];
    this.apiCalls = [];             // { url, status, ms }
    this.envSuppressed = 0;         // errors caused only by the runner's network, not the site
    this.started = Date.now();
  }

  // Attach listeners that collect JS errors, console errors, failed and slow requests.
  watch(page) {
    const tag = page === this.page ? '' : '[popup] ';
    const envNoise = s => { if (this.audit.isEnvNoise && this.audit.isEnvNoise(s)) { this.envSuppressed++; return true; } return false; };
    page.on('pageerror', e => { const m = tag + (e.message || String(e)); if (!isNoise(m)) this.pageErrors.push(m.slice(0, 400)); });
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = tag + m.text();
      if (!isNoise(t) && !envNoise(t)) this.consoleErrors.push(t.slice(0, 400));
    });
    page.on('requestfailed', r => {
      const u = r.url(); const f = (r.failure() && r.failure().errorText) || '';
      if (!isNoise(u + ' ' + f) && !envNoise(u + ' ' + f)) this.failedRequests.push((f + ' ' + r.method() + ' ' + u).slice(0, 300));
    });
    const t0 = new Map();
    page.on('request', r => { if (/\/\.netlify\/functions\/|firestore\.googleapis|api\.github\.com/.test(r.url())) t0.set(r, Date.now()); });
    page.on('requestfinished', async r => {
      if (!t0.has(r)) return;
      const ms = Date.now() - t0.get(r); t0.delete(r);
      let status = 0; try { const res = await r.response(); status = res ? res.status() : 0; } catch (e) {}
      this.apiCalls.push({ url: r.url().replace(/\?.*$/, '').replace(/^https?:\/\/[^/]+/, ''), method: r.method(), status, ms });
    });
  }

  /**
   * Run one user-visible check.
   *   severity: 'critical' (core journey broken) | 'major' | 'minor'
   *   needs:    flag names that must be truthy, else the step is skipped
   *   timeout:  hard cap for the step (ms)
   */
  async step(name, fn, { severity = 'major', needs = [], timeout = 60000 } = {}) {
    const rec = { name, severity, status: 'pass', ms: 0, detail: '', screenshot: null };
    this.steps.push(rec);
    const missing = [].concat(needs).filter(f => !this.flags[f]);
    if (missing.length) {
      rec.status = 'skip'; rec.detail = 'prerequisite failed: ' + missing.join(', ');
      this.audit.log(`   ↷ ${name} (skipped — ${rec.detail})`);
      return undefined;
    }
    const t = Date.now();
    let timer;
    try {
      const out = await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after ' + Math.round(timeout / 1000) + 's')), timeout); }),
      ]);
      if (typeof out === 'string' && out) rec.detail = out;   // a step may return a note
      return out;
    } catch (e) {
      if (e instanceof SkipError) { rec.status = 'skip'; rec.detail = e.message; }
      else if (e instanceof WarnError) { rec.status = 'warn'; rec.detail = e.message; }
      else { rec.status = 'fail'; rec.detail = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 500); }
      if (rec.status !== 'skip') rec.screenshot = await this.shot(name);
      return undefined;
    } finally {
      clearTimeout(timer);
      rec.ms = Date.now() - t;
      const icon = { pass: '✔', fail: '✘', warn: '!', skip: '↷' }[rec.status];
      this.audit.log(`   ${icon} ${name} (${rec.ms}ms)${rec.detail ? ' — ' + rec.detail : ''}`);
    }
  }

  async shot(label) {
    if (!this.page || this.page.isClosed()) return null;
    const file = (this.name + '-' + label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90) + '.png';
    const full = path.join(this.audit.shotDir, file);
    try { await this.page.screenshot({ path: full, timeout: 8000 }); return file; } catch (e) { return null; }
  }
}

class Audit {
  constructor(opts) {
    this.opts = opts;
    this.suites = [];
    this.outDir = opts.outDir;
    this.shotDir = path.join(this.outDir, 'screenshots');
    fs.mkdirSync(this.shotDir, { recursive: true });
    this.logLines = [];
  }

  log(s) { console.log(s); this.logLines.push(s); }

  /** Run a suite in a fresh browser context (a new visitor with empty storage). */
  async suite(name, fn, { contextOptions = {}, description = '' } = {}) {
    const s = new Suite(this, name, {});
    s.description = description;
    this.suites.push(s);
    this.log(`\n▶ ${name}`);
    let ctx;
    try {
      ctx = await this.browser.newContext({ acceptDownloads: true, ...contextOptions });
      ctx.setDefaultTimeout(20000);
      s.context = ctx;
      s.page = await ctx.newPage();
      s.watch(s.page);
      ctx.on('page', p => { if (p !== s.page) s.watch(p); });
      if (this.opts.beforePage) await this.opts.beforePage(s.page, ctx);
      await fn(s, s.page);
    } catch (e) {
      // A crash outside any step still has to show up in the report.
      s.steps.push({ name: 'suite crashed', severity: 'critical', status: 'fail', ms: 0,
        detail: (e && e.message ? e.message : String(e)).split('\n')[0], screenshot: await s.shot('crash') });
      this.log('   ✘ suite crashed — ' + (e && e.message));
    } finally {
      s.ms = Date.now() - s.started;
      if (ctx) await ctx.close().catch(() => {});
    }
    return s;
  }
}

const skip = msg => { throw new SkipError(msg); };
const warn = msg => { throw new WarnError(msg); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

module.exports = { Audit, Suite, skip, warn, assert, SkipError, WarnError };
