'use strict';
/* Builds the audit report as JSON + an email-safe HTML page (tables and inline
 * styles only — Gmail strips <style> blocks and ignores flex/grid). */
const fs = require('fs');
const path = require('path');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLORS = { pass: '#15803d', fail: '#b91c1c', warn: '#b45309', skip: '#6b7280' };
const LABEL = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP' };
const sec = ms => (ms / 1000).toFixed(1) + 's';

function totalsOf(suites) {
  const t = { pass: 0, fail: 0, warn: 0, skip: 0, criticalFails: 0, jsErrors: 0 };
  for (const s of suites) {
    for (const st of s.steps) { t[st.status]++; if (st.status === 'fail' && st.severity === 'critical') t.criticalFails++; }
    t.jsErrors += s.pageErrors.length;
  }
  t.total = t.pass + t.fail + t.warn + t.skip;
  return t;
}

function verdict(t) {
  if (t.criticalFails) return { text: 'CRITICAL — core user journey is broken', color: '#b91c1c', emoji: '🔴' };
  if (t.fail) return { text: 'Issues found — some features are broken', color: '#c2410c', emoji: '🟠' };
  if (t.warn || t.jsErrors) return { text: 'Healthy, with warnings', color: '#b45309', emoji: '🟡' };
  return { text: 'All live functionality working', color: '#15803d', emoji: '🟢' };
}

function uniq(a) { return [...new Set(a)]; }

function writeReport(audit, meta) {
  const suites = audit.suites;
  const totals = totalsOf(suites);
  const v = verdict(totals);
  const when = meta.started.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
  const dur = sec(meta.finished - meta.started);

  const problems = [];
  for (const s of suites) for (const st of s.steps) if (st.status === 'fail' || st.status === 'warn') problems.push({ suite: s.name, ...st });
  problems.sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) ||
    ['critical', 'major', 'minor'].indexOf(a.severity) - ['critical', 'major', 'minor'].indexOf(b.severity));

  const api = [];
  for (const s of suites) for (const c of s.apiCalls) api.push(c);
  const byEndpoint = {};
  for (const c of api) {
    const k = c.method + ' ' + c.url.replace(/\/portfolios\/[^/]+$/, '/portfolios/:slug').replace(/\/users\/[^/]+$/, '/users/:name');
    (byEndpoint[k] = byEndpoint[k] || []).push(c);
  }

  const summaryLine = `${v.emoji} ${totals.pass}/${totals.total} checks passed · ${totals.fail} failed · ${totals.warn} warnings · ${totals.skip} skipped (${dur})`;

  const td = 'padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;';
  const th = 'padding:8px 10px;border-bottom:2px solid #ddd;font-size:12px;text-align:left;color:#555;text-transform:uppercase;letter-spacing:.04em;';
  const isEnv = st => st.status === 'skip' && /^environment-limited/.test(st.detail || '');
  const pill = (txt, bg) => `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:${bg}">${txt}</span>`;
  const badge = st => typeof st === 'string' ? pill(LABEL[st], COLORS[st]) : isEnv(st) ? pill('ENV', '#64748b') : pill(LABEL[st.status], COLORS[st.status]);
  const envSkips = suites.reduce((n, s) => n + s.steps.filter(isEnv).length, 0);
  const envSuppressed = suites.reduce((n, s) => n + (s.envSuppressed || 0), 0);
  const stat = (n, label, color) => `<td align="center" style="padding:12px 4px;background:#fafafa;border-radius:8px"><div style="font-size:26px;font-weight:800;color:${color}">${n}</div><div style="font-size:12px;color:#666">${label}</div></td>`;

  let html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>resume4u audit — ${esc(when)}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 10px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#b45309;padding:20px 24px;color:#fff">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">resume4u.help · daily live audit</div>
  <div style="font-size:22px;font-weight:800;margin-top:4px">${v.emoji} ${esc(v.text)}</div>
  <div style="font-size:13px;margin-top:6px;opacity:.9">${esc(when)} · ${esc(meta.base)} · ran ${dur}${meta.buildId ? ' · build ' + esc(meta.buildId) : ''}</div>
</td></tr>`;
  if ((meta.envLimited && meta.envLimited.length) || meta.localTarget) {
    html += `<tr><td style="padding:12px 24px;background:#eef2f7;color:#334155;font-size:13px"><b>External-dependency checks are environment-limited.</b> `
      + (meta.envLimited && meta.envLimited.length ? `This runner cannot reach ${esc(meta.envLimited.join(', '))}. ` : '')
      + (meta.localTarget ? 'The target is a local server, so Netlify-only checks (headers, compression, functions) were not run. ' : '')
      + `${envSkips} check(s) marked <b>ENV</b> were skipped and ${envSuppressed} network error(s) from those hosts were left out — these say nothing about the site itself.</td></tr>`;
  }
  if (meta.mockAi) html += `<tr><td style="padding:12px 24px;background:#fef3c7;color:#92400e;font-size:13px"><b>MOCK_AI run</b> — AI answers were simulated. This is a self-test of the agent, not an audit of the live site.</td></tr>`;

  html += `<tr><td style="padding:20px 24px"><table width="100%" cellpadding="0" cellspacing="6" style="table-layout:fixed"><tr>
    ${stat(totals.pass, 'passed', COLORS.pass)}${stat(totals.fail, 'failed', COLORS.fail)}${stat(totals.warn, 'warnings', COLORS.warn)}${stat(totals.skip, 'skipped', COLORS.skip)}${stat(totals.jsErrors, 'JS errors', totals.jsErrors ? COLORS.fail : COLORS.pass)}
  </tr></table>
  <div style="font-size:13px;color:#444;margin-top:10px">
    ${meta.generateMs ? 'AI résumé generation: <b>' + sec(meta.generateMs) + '</b> · ' : ''}${meta.templateCount ? 'Templates: <b>' + meta.templateCount + '</b> · ' : ''}${meta.atsScore != null ? 'ATS score of test résumé: <b>' + meta.atsScore + '/100</b>' : ''}
  </div></td></tr>`;

  // What needs attention
  html += `<tr><td style="padding:0 24px 8px"><h2 style="font-size:16px;margin:8px 0">What needs attention</h2>`;
  if (!problems.length) html += `<p style="font-size:14px;color:#15803d;margin:0 0 12px">Nothing — every scenario passed. ✅</p>`;
  else {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr><th style="${th}width:70px">Status</th><th style="${th}width:34%">Where</th><th style="${th}">Problem</th></tr>`;
    for (const p of problems) {
      html += `<tr><td style="${td}">${badge(p)}<div style="font-size:11px;color:#777;margin-top:3px">${esc(p.severity)}</div></td>
        <td style="${td}"><b>${esc(p.name)}</b><div style="color:#777;font-size:12px">${esc(p.suite)}</div></td>
        <td style="${td}">${esc(p.detail)}${p.screenshot ? `<div style="font-size:11px;color:#777;margin-top:4px">📎 screenshot: ${esc(p.screenshot)}</div>` : ''}</td></tr>`;
    }
    html += `</table>`;
  }
  html += `</td></tr>`;

  // Per-journey detail
  html += `<tr><td style="padding:8px 24px"><h2 style="font-size:16px;margin:8px 0">Every scenario tested</h2>`;
  for (const s of suites) {
    const t = totalsOf([s]);
    const col = t.fail ? COLORS.fail : t.warn ? COLORS.warn : COLORS.pass;
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px;border-left:4px solid ${col}">
      <tr><td style="padding:6px 10px;background:#fafafa"><b style="font-size:14px">${esc(s.name)}</b>
      <span style="font-size:12px;color:#666"> — ${t.pass}/${t.total} passed · ${sec(s.ms || 0)}</span>
      ${s.description ? `<div style="font-size:12px;color:#777">${esc(s.description)}</div>` : ''}</td></tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">`;
    for (const st of s.steps) {
      html += `<tr><td style="${td}width:52px">${badge(st)}</td><td style="${td}">${esc(st.name)}${st.detail ? `<div style="font-size:12px;color:${st.status === 'pass' ? '#666' : COLORS[st.status]}">${esc(st.detail)}</div>` : ''}</td><td style="${td}width:54px;color:#888;text-align:right">${sec(st.ms)}</td></tr>`;
    }
    html += `</table>`;
    const errs = uniq(s.pageErrors), cons = uniq(s.consoleErrors), reqs = uniq(s.failedRequests);
    if (errs.length || cons.length || reqs.length) {
      html += `<div style="font-size:12px;background:#fef2f2;border-radius:6px;padding:8px 10px;margin:6px 0;color:#7f1d1d;word-break:break-all">`;
      if (errs.length) html += `<b>JavaScript errors (${errs.length}):</b><br>${errs.slice(0, 8).map(esc).join('<br>')}<br>`;
      if (cons.length) html += `<b>Console errors (${cons.length}):</b><br>${cons.slice(0, 8).map(esc).join('<br>')}<br>`;
      if (reqs.length) html += `<b>Failed network requests (${reqs.length}):</b><br>${reqs.slice(0, 8).map(esc).join('<br>')}`;
      html += `</div>`;
    }
  }
  html += `</td></tr>`;

  // Backend latency
  if (Object.keys(byEndpoint).length) {
    html += `<tr><td style="padding:8px 24px 16px"><h2 style="font-size:16px;margin:8px 0">Backend calls made by the browser</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr><th style="${th}width:46%">Endpoint</th><th style="${th}">Calls</th><th style="${th}">Errors</th><th style="${th}">Avg</th><th style="${th}">Slowest</th></tr>`;
    for (const [k, cs] of Object.entries(byEndpoint).sort()) {
      const errs = cs.filter(c => c.status >= 400 || c.status === 0).length;
      const avg = cs.reduce((a, c) => a + c.ms, 0) / cs.length;
      const max = Math.max(...cs.map(c => c.ms));
      html += `<tr><td style="${td}font-family:monospace;font-size:12px">${esc(k)}</td><td style="${td}">${cs.length}</td><td style="${td}color:${errs ? COLORS.fail : '#333'}">${errs}</td><td style="${td}">${sec(avg)}</td><td style="${td}">${sec(max)}</td></tr>`;
    }
    html += `</table></td></tr>`;
  }

  html += `<tr><td style="padding:14px 24px 22px;font-size:12px;color:#777;border-top:1px solid #eee">
    ${meta.runUrl ? `Full logs, screenshots &amp; this report: <a href="${esc(meta.runUrl)}" style="color:#b45309">${esc(meta.runUrl)}</a><br>` : ''}
    Suites: ${esc(meta.suitesRun.join(', '))}${envSkips ? ' · Environment-limited checks: ' + envSkips : ''} · Publishing test pages: ${meta.publish ? 'on' : 'off'} · Payments are never completed by the agent.
  </td></tr></table></td></tr></table></body></html>`;

  fs.mkdirSync(audit.outDir, { recursive: true });
  const htmlPath = path.join(audit.outDir, 'report.html');
  const jsonPath = path.join(audit.outDir, 'report.json');
  fs.writeFileSync(htmlPath, html);
  const json = { meta, totals, verdict: v.text, suites: suites.map(s => ({ name: s.name, ms: s.ms, steps: s.steps, envSuppressed: s.envSuppressed || 0,
    pageErrors: uniq(s.pageErrors), consoleErrors: uniq(s.consoleErrors), failedRequests: uniq(s.failedRequests), apiCalls: s.apiCalls })) };
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  fs.writeFileSync(path.join(audit.outDir, 'run.log'), audit.logLines.join('\n'));

  const subject = `${v.emoji} resume4u audit ${meta.started.toISOString().slice(0, 10)}: ${totals.pass}/${totals.total} passed` +
    (totals.fail ? `, ${totals.fail} failed` : '') + (totals.warn ? `, ${totals.warn} warnings` : '') + (meta.mockAi ? ' [MOCK]' : '');
  const screenshots = problems.filter(p => p.screenshot).map(p => path.join(audit.shotDir, p.screenshot)).filter(f => fs.existsSync(f));
  return { html, htmlPath, jsonPath, subject, summaryLine, totals, screenshots, outDir: audit.outDir };
}

module.exports = { writeReport };
