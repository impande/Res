/* generate-background.js — runs a long AI request (e.g. writing a full resume) as
 * a Netlify BACKGROUND function, so it is not cut off at 26 s. The page POSTs the
 * same body it would send to /generate plus a `jobId`, gets 202 immediately, then
 * polls GET /.netlify/functions/career-tools?job=<jobId> for { status, result }.
 * result has the same shape /generate returns: { text } (or { text:'', error }).
 */
const { runAI } = require('../lib/ai-generate.js');
const core = require('../lib/career-core.js');

exports.handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const jobId = String(body.jobId || '');
  if (!core.JOB_RE.test(jobId)) return { statusCode: 400, body: JSON.stringify({ error: 'bad job id' }) };
  delete body.jobId;

  await core.setJob(jobId, { status: 'running', at: Date.now() });
  try {
    const out = await runAI(body, { mode: 'bg' });
    const job = out.status === 200
      ? { status: 'done', result: out.payload }
      : { status: 'error', error: out.payload.error || 'AI error', code: out.status };
    await core.setJob(jobId, job);
    // If this platform ran us synchronously (no background support), the page
    // can use this response directly.
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(job) };
  } catch (e) {
    console.error('[generate-bg] failed', e && e.message);
    await core.setJob(jobId, { status: 'error', error: 'Something went wrong. Please try again.' });
    return { statusCode: 500, body: '' };
  }
};
