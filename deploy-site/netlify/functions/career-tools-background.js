/* career-tools-background.js — runs a free career tool (ATS check, LinkedIn,
 * interview prep, regional resume, biodata) as a Netlify BACKGROUND function,
 * so the best models can take as long as they need (no 26s cap). The page
 * POSTs { jobId, tool, input } here, gets 202 immediately, then polls
 * GET /.netlify/functions/career-tools?job=<jobId> for the result in Redis.
 */
const core = require('../lib/career-core.js');

exports.handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const jobId = String(body.jobId || '');
  if (!core.JOB_RE.test(jobId)) return { statusCode: 400, body: JSON.stringify({ error: 'bad job id' }) };

  // Same resume already scored → same score, instantly (and not counted against limits).
  if (body.tool === 'ats_check') {
    const hit = await core.cachedAts(body.input || {});
    if (hit) { await core.setJob(jobId, { status: 'done', result: hit }); return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', result: hit }) }; }
  }
  const rl = await core.rateLimit(event, { mult: body.input && body.input.source === 'builder' ? 3 : 1 });
  if (!rl.ok) { await core.setJob(jobId, { status: 'error', error: rl.message }); return { statusCode: 429, body: '' }; }

  await core.setJob(jobId, { status: 'running', at: Date.now() });
  try {
    const out = await core.runTool(String(body.tool || ''), body.input || {}, 'full');
    await core.setJob(jobId, out.ok ? { status: 'done', result: out.result } : { status: 'error', error: out.error });
    // If this platform ran us synchronously (no background support), the page can
    // use this response directly.
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(out.ok ? { status: 'done', result: out.result } : { status: 'error', error: out.error }) };
  } catch (e) {
    console.error('[career-bg] failed', e && e.message);
    await core.setJob(jobId, { status: 'error', error: 'Something went wrong. Please try again.' });
    return { statusCode: 500, body: '' };
  }
};
