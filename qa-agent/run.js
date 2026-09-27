#!/usr/bin/env node
'use strict';
/*
 * resume4u live audit agent.
 *
 * Replays the journeys real users take on the LIVE site in a real Chromium,
 * collects every failure / JS error / slow API call, writes an HTML + JSON
 * report and emails it.
 *
 *   node run.js                       # full audit of https://resume4u.help, email report
 *
 * Environment:
 *   BASE_URL      site to audit                     (default https://resume4u.help)
 *   SUITES        comma list to run a subset, e.g. "health,build,mobile"
 *   SEND_EMAIL    0 to skip email                   (default 1)
 *   REPORT_TO     recipient                         (default 2ashishpandey@gmail.com)
 *   SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT   mail account (see README)
 *   PUBLISH       0 to skip steps that publish public pages (/r/, /p/)  (default 1)
 *   MOCK_AI       1 = fake AI answers; ONLY for developing the agent locally
 *   HEADFUL       1 = show the browser
 *   OUT_DIR       where reports go                  (default ./reports/<timestamp>)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Audit } = require('./lib/harness');
const fixtures = require('./lib/fixtures');
const { writeReport } = require('./lib/report');
const { sendReport } = require('./lib/mailer');

const env = process.env;
const base = (env.BASE_URL || 'https://resume4u.help').replace(/\/+$/, '');
const mockAi = env.MOCK_AI === '1';
const publish = env.PUBLISH !== '0';
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(env.OUT_DIR || path.join(__dirname, 'reports', ts));

const SUITES = {
  health:    () => require('./suites/site-health'),
  build:     () => require('./suites/journey-build'),
  share:     () => require('./suites/journey-share'),
  portfolio: () => require('./suites/journey-portfolio'),
  import:    () => require('./suites/journey-import'),
  mobile:    () => require('./suites/journey-mobile'),
  edge:      () => require('./suites/edge-cases'),
  // web standards
  a11y:      () => require('./suites/standards').a11y,
  perf:      () => require('./suites/standards').perf,
  seo:       () => require('./suites/standards').seo,
  security:  () => require('./suites/standards').security,
  links:     () => require('./suites/standards').links,
  browsers:  () => require('./suites/standards').browsers,
};

(async () => {
  const wanted = (env.SUITES || Object.keys(SUITES).join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const unknown = wanted.filter(w => !SUITES[w]);
  if (unknown.length) { console.error('Unknown suite(s): ' + unknown.join(', ') + '. Known: ' + Object.keys(SUITES).join(', ')); process.exit(2); }

  const started = new Date();
  const browser = await chromium.launch({ headless: env.HEADFUL !== '1' });
  const audit = new Audit({
    outDir,
    beforePage: async page => {
      page.on('dialog', d => d.dismiss().catch(() => {}));   // never hang on alert()/confirm()
      if (mockAi) await require('./lib/mock-ai').install(page, s => audit.log(s));
    },
  });
  audit.browser = browser;

  const fileDir = path.join(outDir, 'fixtures');
  fs.mkdirSync(fileDir, { recursive: true });
  const files = { photo: fixtures.makePhotoPng(fileDir), resumePdf: await fixtures.makeResumePdf(browser, fileDir) };

  console.log(`resume4u live audit → ${base}${mockAi ? '  [MOCK_AI — not a real audit]' : ''}`);
  // Which third-party hosts can this runner reach? (see lib/env.js)
  const envInfo = await require('./lib/env').probe(browser, base);
  if (mockAi) {   // these are faked offline, so they are not a limitation
    const faked = ['firestore', 'github'].concat(env.MOCK_CDN_DIR ? ['pdfjs'] : []);
    envInfo.unreachable = envInfo.unreachable.filter(k => !faked.includes(k));
  }
  audit.env = envInfo;
  if (envInfo.unreachable.length) {
    const hosts = envInfo.unreachable.map(envInfo.hostOf);
    const re = new RegExp(hosts.map(h => h.replace(/\./g, '\\.')).join('|') + '|ERR_TUNNEL_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID|ERR_PROXY_CONNECTION_FAILED');
    audit.isEnvNoise = s => re.test(s);
    console.log('Environment-limited (unreachable from this runner): ' + hosts.join(', '));
  }
  const opts = { base, mockAi, publish, files, env: envInfo };
  for (const name of wanted) await SUITES[name]()(audit, opts);
  await browser.close();

  const meta = { base, started, finished: new Date(), mockAi, publish, suitesRun: wanted,
    envLimited: envInfo.unreachable.map(envInfo.hostOf), localTarget: envInfo.local, ci: envInfo.ci,
    buildId: audit.buildId, templateCount: audit.templateCount, atsScore: audit.atsScore, generateMs: audit.generateMs,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '' };
  const report = writeReport(audit, meta);
  console.log(`\n${report.summaryLine}\nReport: ${report.htmlPath}`);

  if (env.SEND_EMAIL !== '0') {
    try { await sendReport(report, { to: env.REPORT_TO || '2ashishpandey@gmail.com' }); console.log('Email sent to ' + (env.REPORT_TO || '2ashishpandey@gmail.com')); }
    catch (e) { console.error('EMAIL FAILED: ' + e.message); process.exitCode = 3; }
  }
  // Non-zero exit when something critical broke, so the GitHub run turns red too.
  if (report.totals.criticalFails) process.exitCode = process.exitCode || 1;
})().catch(e => { console.error(e); process.exit(1); });
