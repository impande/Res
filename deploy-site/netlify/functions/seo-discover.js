// Auto-discovery for the SEO submissions dashboard — powered by Claude.
//
// Instead of a paid data API (Semrush/SerpAPI) or a hardcoded list that needs a
// redeploy to change, this asks the Anthropic API to generate a FRESH batch of
// relevant submission targets on demand:
//   • directories → real listing/directory sites that fit a resume SaaS
//   • quora       → common resume/job questions worth answering
// The dashboard sends the names it already has so each run returns new ones.
// Reuses the same ANTHROPIC_API_KEY wiring as generate.js. Token-gated.
//
// Honest note: Claude generates these from its training knowledge, so a URL may
// occasionally be a homepage rather than the exact submit page, or a site may
// have changed — you review each target before submitting anyway.

const SITE = 'https://resume4u.help';
const PRODUCT = 'resume4u.help — a free, AI-powered resume builder (ATS-friendly resumes, cover letters, and a portfolio website builder) for students and professionals.';

// TEMP UAT login (see seo-submissions.js). The SEO_ADMIN_TOKEN env var wins when
// set; remove this before production.
const UAT_FALLBACK = 'uat-resume4u-Kq7Zp9Xm2L';

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': (origin && origin !== 'null') ? origin : '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-seo-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

function promptFor(channel, exclude) {
  const avoid = (exclude && exclude.length)
    ? `\n\nDo NOT include any of these, which are already on the list:\n${exclude.slice(0, 80).map(n => '- ' + n).join('\n')}`
    : '';

  if (channel === 'quora') {
    return `Return ONLY valid JSON: {"targets":[{"name":"","url":"","authority":"","note":""}, ...]}.

List 15 common, high-interest Quora questions about resumes, ATS, cover letters, or job searching where a genuinely helpful answer that mentions ${SITE} would fit naturally.
For each item:
- "name": "Quora — <the exact question>"
- "url": a Quora search URL: https://www.quora.com/search?q=<the question, URL-encoded>
- "authority": "high"
- "note": one short tip for answering it well
PRODUCT: ${PRODUCT}${avoid}`;
  }

  return `Return ONLY valid JSON: {"targets":[{"name":"","url":"","authority":"","note":""}, ...]}.

List 15 real, currently-active online directories or listing sites where the product below can submit for a backlink and exposure. Give a good mix of: SaaS directories, AI-tool directories, startup/launch directories, and career/job/resume-related listings.
For each item:
- "name": the site's name
- "url": its "submit"/"add your product" page if you know it, otherwise the homepage
- "authority": "high" | "med" | "low" (your estimate of the site's domain authority)
- "note": one short line on what the site wants, or a submission tip
Rules: only legitimate sites (NO link farms, NO paid-only link schemes). Prefer sites that accept a free listing.
PRODUCT: ${PRODUCT}${avoid}`;
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const CORS = cors(origin);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const expected = process.env.SEO_ADMIN_TOKEN || UAT_FALLBACK;
  const token = event.headers['x-seo-token'] || event.headers['X-Seo-Token'] || '';
  if (token !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ candidates: [], note: 'Add ANTHROPIC_API_KEY to your Netlify environment variables, then redeploy.' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const channel = body.channel === 'quora' ? 'quora' : 'directory';
    const exclude = Array.isArray(body.exclude) ? body.exclude : [];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        system: 'You output only valid JSON matching the requested shape — no markdown fences, no commentary. Only suggest real, legitimate websites you are confident exist.',
        messages: [{ role: 'user', content: promptFor(channel, exclude) }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return { statusCode: response.status, headers: CORS, body: JSON.stringify({ candidates: [], note: data.error?.message || 'API error' }) };

    let text = (data.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch { return { statusCode: 200, headers: CORS, body: JSON.stringify({ candidates: [], note: 'Could not parse the generated list — try again.' }) }; }

    const rows = Array.isArray(parsed) ? parsed : (parsed.targets || []);
    const have = new Set(exclude.map(n => slug(channel + '-' + n)));
    const candidates = [];
    for (const r of rows) {
      if (!r || !r.name) continue;
      let url = r.url || '';
      if (channel === 'quora' && !url) url = 'https://www.quora.com/search?q=' + encodeURIComponent(String(r.name).replace(/^Quora\s*[—-]\s*/i, ''));
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      const id = slug(channel + '-' + r.name);
      if (have.has(id)) continue;
      have.add(id);
      candidates.push({
        id, channel, name: String(r.name).slice(0, 120), url,
        authority: ['high', 'med', 'low'].includes(r.authority) ? r.authority : (channel === 'quora' ? 'high' : 'med'),
        care: channel === 'quora' ? 'high' : 'med',
        notes: String(r.note || '').slice(0, 220),
        source: 'ai', discoveredAt: new Date().toISOString(),
      });
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ candidates, note: candidates.length ? '' : 'No new targets came back — try again in a moment.' }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ candidates: [], note: err.message }) };
  }
};
