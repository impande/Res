'use strict';
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = JSON.parse(event.body || '{}');
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing payment fields' }) };
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ verified: expected === razorpay_signature }),
    };
  } catch (err) {
    console.error('[verify-payment]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
