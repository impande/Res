'use strict';

const PRICING = {
  IN: { currency: 'INR', amount: 900 },
  US: { currency: 'USD', amount: 199 }, CA: { currency: 'USD', amount: 199 },
  GB: { currency: 'GBP', amount: 179 },
  DE: { currency: 'EUR', amount: 199 }, FR: { currency: 'EUR', amount: 199 },
  IT: { currency: 'EUR', amount: 199 }, ES: { currency: 'EUR', amount: 199 },
  NL: { currency: 'EUR', amount: 199 }, BE: { currency: 'EUR', amount: 199 },
  AT: { currency: 'EUR', amount: 199 }, PT: { currency: 'EUR', amount: 199 },
  CH: { currency: 'EUR', amount: 199 }, SE: { currency: 'EUR', amount: 199 },
  NO: { currency: 'EUR', amount: 199 }, DK: { currency: 'EUR', amount: 199 },
  FI: { currency: 'EUR', amount: 199 }, PL: { currency: 'EUR', amount: 199 },
  CZ: { currency: 'EUR', amount: 199 }, HU: { currency: 'EUR', amount: 199 },
  RO: { currency: 'EUR', amount: 199 }, IE: { currency: 'EUR', amount: 199 },
  GR: { currency: 'EUR', amount: 199 }, SK: { currency: 'EUR', amount: 199 },
  AU: { currency: 'AUD', amount: 149 }, NZ: { currency: 'AUD', amount: 149 },
};
const DEFAULT = { currency: 'USD', amount: 99 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const country = (body.country || '').toUpperCase().trim();
    const pricing = PRICING[country] || DEFAULT;

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay credentials not configured');

    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: pricing.amount,
        currency: pricing.currency,
        receipt: 'r4u_' + Date.now(),
        notes: { country },
      }),
    });

    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error('Razorpay: ' + JSON.stringify(order));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        orderId: order.id,
        amount: pricing.amount,
        currency: pricing.currency,
        displayPrice: formatPrice(pricing.currency, pricing.amount),
        keyId,
      }),
    };
  } catch (err) {
    console.error('[create-order]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

function formatPrice(currency, amountInSmallest) {
  const sym = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$' }[currency] || '';
  const n = amountInSmallest / 100;
  return sym + (Number.isInteger(n) ? n : n.toFixed(2));
}
