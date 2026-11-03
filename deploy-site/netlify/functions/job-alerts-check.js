/* job-alerts-check.js — the HTTP entry point for job-alert setup checks.
 *
 * Netlify does not allow SCHEDULED functions to be called by URL (job-alerts is
 * scheduled daily at 03:30 UTC, so opening it in a browser returns 403). This
 * unscheduled twin runs the same handler for the token-guarded links:
 *   ?key=<WHATSAPP_VERIFY_TOKEN>&preview=1&role=Product%20Owner&city=Pune  → preview (sends nothing)
 *   ?key=<WHATSAPP_VERIFY_TOKEN>&stt=1                                     → voice-answer key check
 *   ?key=<WHATSAPP_VERIFY_TOKEN>&to=<phone>                                → send today's alert to one subscriber
 */
const run = require('./job-alerts.js').handler;
exports.handler = async (event, context) => {
  // Never let a body impersonate the scheduler from this URL.
  const ev = Object.assign({}, event, { body: '' });
  return run(ev, context);
};
