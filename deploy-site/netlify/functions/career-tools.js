/* career-tools.js — companion to career-tools-background.js.
 *   GET  ?job=<id>           -> poll a background job's status / result
 *   POST { tool, input }     -> fast synchronous run (fallback when background
 *                               functions aren't available); uses quicker
 *                               model/effort settings to finish inside 26s.
 */
const core = require('../lib/career-core.js');

const H = { 'content-type': 'application/json', 'cache-control': 'no-store' };

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const id = (event.queryStringParameters || {}).job || '';
    if (!core.JOB_RE.test(id)) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'bad job id' }) };
    const job = await core.getJob(id);
    return { statusCode: 200, headers: H, body: JSON.stringify(job || { status: 'pending' }) };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const rl = await core.rateLimit(event);
  if (!rl.ok) return { statusCode: 429, headers: H, body: JSON.stringify({ status: 'error', error: rl.message }) };
  const out = await core.runTool(String(body.tool || ''), body.input || {}, 'fast');
  return {
    statusCode: out.ok ? 200 : (out.status || 500),
    headers: H,
    body: JSON.stringify(out.ok ? { status: 'done', result: out.result } : { status: 'error', error: out.error })
  };
};
