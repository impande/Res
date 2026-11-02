/* job-alerts.js — daily WhatsApp job alerts (scheduled 03:30 UTC = 09:00 IST
 * in netlify.toml). For each subscriber (set jobalerts:subs, prefs at
 * jobalert:<phone>), fetch fresh matched jobs, drop ones already sent
 * (jobseen:<phone>), and message them.
 *
 * WhatsApp rule: free-form messages are only allowed within 24h of the user's
 * last message (lastseen:<phone>, written by whatsapp.js). Outside that window
 * we send an approved TEMPLATE instead, if configured:
 *   WA_JOB_ALERT_TEMPLATE       template name approved in WhatsApp Manager
 *   WA_JOB_ALERT_TEMPLATE_LANG  its language code (default "en")
 * The template body must take 3 params: {{1}} first name, {{2}} how many new
 * jobs, {{3}} the role — e.g. "Hi {{1}}, {{2}} new {{3}} jobs matching your
 * resume are ready. Reply JOBS to see them." Without a template, users outside
 * the 24h window are skipped (never an error).
 *
 * Scheduled functions only fire on the PUBLISHED deploy. To test on UAT:
 *   GET /.netlify/functions/job-alerts?key=<WHATSAPP_VERIFY_TOKEN>&to=<phone>
 */
const JOBS = require('../lib/jobs.js');
const GRAPH = 'https://graph.facebook.com/v21.0';

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/' + cmd.map(encodeURIComponent).join('/'), { headers: { Authorization: 'Bearer ' + tok } });
    const j = await r.json().catch(() => ({}));
    return j && j.result;
  } catch (e) { console.error('[job-alerts] redis failed', e && e.message); return null; }
}
async function wa(payload) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) { console.log('[job-alerts] NOT SENT (no WhatsApp env):', JSON.stringify(payload).slice(0, 200)); return false; }
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({ messaging_product: 'whatsapp' }, payload))
  });
  if (!r.ok) console.error('[job-alerts] send failed', r.status, (await r.text().catch(() => '')).slice(0, 300));
  return r.ok;
}
const sendText = (to, body) => wa({ to, type: 'text', text: { body } });
const sendTemplate = (to, name, lang, params) => wa({
  to, type: 'template',
  template: { name, language: { code: lang }, components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t).slice(0, 60) })) }] }
});

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  let body = {}; try { body = JSON.parse((event && event.body) || '{}'); } catch (e) {}
  const scheduled = !!body.next_run;
  if (!scheduled) {
    const tok = process.env.WHATSAPP_VERIFY_TOKEN || '';
    if (!tok || q.key !== tok) return { statusCode: 401, body: 'unauthorized' };
  }
  // Preview (token-guarded, sends nothing): check the job source and see the exact
  // message, e.g. ?key=<token>&preview=1&role=Product%20Owner&city=Pune
  if (!scheduled && q.preview) {
    const search = JOBS.deriveSearch({}, { role: JOBS.titleCase(q.role || 'Data Analyst'), city: JOBS.titleCase(q.city || '') });
    const res = await JOBS.fetchJobs(search, { maxDays: 3 });
    return {
      statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        source: res.source,
        jooble_key_set: !!process.env.JOOBLE_API_KEY,
        template_set: process.env.WA_JOB_ALERT_TEMPLATE || null,
        listings: res.jobs.length,
        message: '☀️ Good morning! ' + JOBS.formatJobs(search, res)
      }, null, 2)
    };
  }
  const t0 = Date.now();
  const only = q.to ? String(q.to).replace(/\D/g, '') : '';
  const subs = only ? [only] : ((await redis(['SMEMBERS', 'jobalerts:subs'])) || []);
  const TEMPLATE = process.env.WA_JOB_ALERT_TEMPLATE || '', TLANG = process.env.WA_JOB_ALERT_TEMPLATE_LANG || 'en';
  const report = { subscribers: subs.length, sent: 0, template: 0, skipped_window: 0, no_new: 0, errors: 0, stopped_early: false };

  for (const from of subs) {
    if (Date.now() - t0 > 24000) { report.stopped_early = true; break; } // scheduled fns have a short time limit
    try {
      const raw = await redis(['GET', 'jobalert:' + from]);
      if (!raw) { await redis(['SREM', 'jobalerts:subs', from]); continue; }
      const pref = JSON.parse(raw);
      const search = { role: pref.role, city: pref.city, skills: pref.skills || [] };
      const res = await JOBS.fetchJobs(search, { maxDays: 2 });
      let fresh = res.jobs;
      if (res.source !== 'links') {
        const seen = new Set((await redis(['SMEMBERS', 'jobseen:' + from])) || []);
        fresh = fresh.filter((j) => !seen.has(j.id));
        if (!fresh.length) { report.no_new++; continue; }
      }
      const last = Number(await redis(['GET', 'lastseen:' + from])) || 0;
      const inWindow = Date.now() - last < 23.5 * 3600 * 1000;
      let ok = false;
      if (inWindow) {
        ok = await sendText(from, '☀️ Good morning! ' + JOBS.formatJobs(search, { source: res.source, jobs: fresh, links: res.links }));
        if (ok) report.sent++;
      } else if (TEMPLATE) {
        const first = String(pref.name || '').trim().split(/\s+/)[0] || 'there';
        ok = await sendTemplate(from, TEMPLATE, TLANG, [first, fresh.length ? String(Math.min(fresh.length, 5)) : 'New', search.role]);
        if (ok) report.template++;
      } else { report.skipped_window++; continue; }
      if (ok && fresh.length) {
        await redis(['SADD', 'jobseen:' + from].concat(fresh.slice(0, 5).map((j) => j.id)));
        await redis(['EXPIRE', 'jobseen:' + from, '1209600']);
      }
      if (!ok) report.errors++;
    } catch (e) { report.errors++; console.error('[job-alerts] subscriber failed', e && e.message); }
  }
  console.log('[job-alerts] run', JSON.stringify(report));
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) };
};
