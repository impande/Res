'use strict';
/*
 * Razorpay webhook — the robust recovery layer for the "UPI charged but no
 * download" bug.
 *
 * When a payment is captured, Razorpay POSTs here (server-to-server), which is
 * reliable even if the browser's checkout success handler never ran (the exact
 * failure that charged users without delivering a PDF). We verify the webhook
 * signature, then record a 24h "paid" flag keyed by the account uid/email that
 * was attached to the order as notes. The client polls `check-paid` and, when it
 * sees the flag, unlocks the download for free — so a captured payment can never
 * lead to a second charge.
 *
 * Setup required (one-time, by the site owner):
 *   1. Razorpay Dashboard → Settings → Webhooks → Add:
 *        URL:    https://resume4u.help/.netlify/functions/razorpay-webhook
 *        Events: payment.captured   (order.paid optional)
 *        Secret: <choose a strong secret>
 *   2. Netlify env var RAZORPAY_WEBHOOK_SECRET = <same secret>.
 *
 * Storage: Upstash Redis (already configured for this site). No Firebase Admin
 * credentials are needed.
 */
const crypto = require('crypto');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PAID_TTL_SECONDS = 90000; // ~25h, so a 24h access window never expires early

// Run one Upstash REST command, e.g. redisCmd(['SET', key, val, 'EX', '90000']).
async function redisCmd(args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + REDIS_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json();
}

function normEmail(e) { return String(e || '').trim().toLowerCase(); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const raw = event.body || '';

  // Without a configured secret we cannot verify authenticity — do nothing
  // (never trust an unverified payment) but ack so Razorpay stops retrying.
  if (!secret) {
    console.warn('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set — ignoring event');
    return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'secret-not-configured' }) };
  }

  // Verify the signature over the RAW body.
  try {
    const sig = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    // timingSafeEqual needs equal-length buffers.
    const a = Buffer.from(sig || '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, reason: 'bad-signature' }) };
    }
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, reason: 'verify-error' }) };
  }

  let body;
  try { body = JSON.parse(raw); } catch (e) { return { statusCode: 400, body: 'Bad JSON' }; }

  const evt = body && body.event;
  // Only act on a real capture. (order.paid carries the same payment entity.)
  if (evt !== 'payment.captured' && evt !== 'order.paid') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: evt || 'unknown' }) };
  }

  try {
    const pay = body.payload && body.payload.payment && body.payload.payment.entity;
    if (!pay) return { statusCode: 200, body: JSON.stringify({ ok: true, note: 'no-payment-entity' }) };

    const notes = pay.notes || {};
    const uid = notes.uid ? String(notes.uid).slice(0, 128) : '';
    const email = normEmail(notes.email || pay.email);
    const nowMs = Date.now();

    // Write a paid flag under every key we can tie to this account, TTL ~25h.
    const writes = [];
    if (uid) writes.push(redisCmd(['SET', 'r4u:paid:uid:' + uid, String(nowMs), 'EX', String(PAID_TTL_SECONDS)]));
    if (email) writes.push(redisCmd(['SET', 'r4u:paid:email:' + email, String(nowMs), 'EX', String(PAID_TTL_SECONDS)]));

    if (!writes.length) {
      // Payment captured but no account identifier on the order — nothing to key
      // access to. Ack anyway; the browser handler path still covers this case.
      return { statusCode: 200, body: JSON.stringify({ ok: true, note: 'no-account-key' }) };
    }
    await Promise.all(writes);
    return { statusCode: 200, body: JSON.stringify({ ok: true, recorded: { uid: !!uid, email: !!email } }) };
  } catch (e) {
    console.error('[razorpay-webhook]', e && e.message);
    // Ack so Razorpay doesn't hammer retries; the client poll is a backstop.
    return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'handler-error' }) };
  }
};
