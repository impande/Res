// Generates submission copy for the SEO submissions dashboard.
//
// Given a target (a directory, a bookmarking site, or a Quora question) it asks
// Claude for ready-to-paste copy so each submission is a one-click paste instead
// of 15 minutes of writing. Reuses the same ANTHROPIC_API_KEY / Messages API
// wiring as generate.js. Token-gated like seo-submissions.js.

const SITE = 'https://resume4u.help';

// A compact, reusable description of the product so drafts are accurate.
const PRODUCT = `resume4u.help is a free, AI-powered resume builder. It creates ATS-friendly
resumes and cover letters, offers a portfolio website builder, and works for students building a
first resume as well as experienced professionals. Key angles: free to use, ATS optimization,
AI writing help, professional templates, quick export to PDF.`;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': (origin && origin !== 'null') ? origin : '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-seo-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function promptFor(target) {
  const base = `You are helping with off-page marketing for ${SITE}.\n\nPRODUCT:\n${PRODUCT}\n\n`;

  if (target.channel === 'quora') {
    return base +
`TASK: Draft a Quora answer for this question or topic: "${target.name}"
(link/search: ${target.url}).

Rules:
- Answer the question genuinely and completely FIRST. Be actually useful to a real person.
- Mention resume4u.help at most once, naturally, near the end — never spammy, never the opening line.
- Sound like a knowledgeable human, not marketing copy. No hype words ("revolutionary", "game-changing").
- 150–250 words.

Return ONLY valid JSON, no prose, in this shape:
{"answer":"<the full answer text, with the mention woven in>","disclosure":"<one short sentence the user can add to disclose they built the tool>"}`;
  }

  // directory / bookmarking
  return base +
`TASK: Write submission copy to list ${SITE} on "${target.name}" (${target.url}).

Return ONLY valid JSON, no prose, in this exact shape:
{
  "tagline": "<max 60 chars, punchy>",
  "short": "<~140 chars, one clear sentence>",
  "medium": "<~250 chars, 1–2 sentences>",
  "long": "<~600 chars, 3–4 sentences covering who it's for + key features>",
  "tags": ["<5-8 lowercase tags, no # >"],
  "category": "<the single best category to pick on this platform>"
}
Write plain factual copy. No emojis unless a bookmarking site, no ALL CAPS, no invented statistics.`;
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const CORS = cors(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const expected = process.env.SEO_ADMIN_TOKEN;
  if (!expected) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Add SEO_ADMIN_TOKEN to your Netlify environment variables, then redeploy.' }) };
  const token = event.headers['x-seo-token'] || event.headers['X-Seo-Token'] || '';
  if (token !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Add ANTHROPIC_API_KEY to your Netlify environment variables, then redeploy.' }) };

  try {
    const target = (JSON.parse(event.body || '{}')).target;
    if (!target || !target.name) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing target' }) };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'You output only valid JSON, exactly matching the requested shape. No markdown fences, no commentary.',
        messages: [{ role: 'user', content: promptFor(target) }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || 'API error' }) };

    let text = (data.content?.[0]?.text || '').trim();
    // Strip accidental code fences, then parse.
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let draft;
    try { draft = JSON.parse(text); }
    catch { draft = { raw: text }; }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ draft }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
