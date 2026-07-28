// Auto-discovery for the SEO submissions dashboard.
//
// Finds NEW submission targets instead of relying only on the curated seed list:
//   • directories → the referring domains of competitor resume builders, via the
//     Semrush Analytics API. A directory that already links to a rival is a
//     directory that will likely accept resume4u — relevance is proven, not guessed.
//   • quora       → real, current questions matching your topics, via a search
//     source (SerpAPI if configured, else a keyless DuckDuckGo fallback).
//
// Returns candidates only; it never writes. The dashboard reviews them and calls
// seo-submissions `addMany` to queue the ones worth doing. The final Submit on any
// platform is still a human click.
//
// Env (all optional — each path degrades to a clear message if its key is absent):
//   SEO_ADMIN_TOKEN  (required, same gate as the other functions)
//   SEMRUSH_API_KEY  (directories discovery)
//   SERPAPI_KEY      (better Quora discovery; without it a keyless fallback is used)

// TEMP UAT login (see seo-submissions.js). The SEO_ADMIN_TOKEN env var wins when
// set; remove this before production.
const UAT_FALLBACK = 'uat-resume4u-Kq7Zp9Xm2L';

const DEFAULT_COMPETITORS = ['zety.com', 'novoresume.com', 'resume.io', 'kickresume.com', 'enhancv.com', 'resumegenius.com'];

const DEFAULT_QUORA_QUERIES = [
  'best free resume builder',
  'how to make an ATS resume',
  'resume for first job no experience',
  'how to write a cover letter',
  'best resume format 2026',
];

// Domains that are never useful submission "directories" — social, search, big
// platforms, and the competitors themselves.
const BLOCK = new Set([
  'facebook.com','twitter.com','x.com','linkedin.com','youtube.com','instagram.com',
  'pinterest.com','reddit.com','google.com','wikipedia.org','amazon.com','medium.com',
  'github.com','apple.com','microsoft.com','t.co','bit.ly','tumblr.com','quora.com',
  ...DEFAULT_COMPETITORS,
]);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': (origin && origin !== 'null') ? origin : '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-seo-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function rootDomain(host) {
  host = String(host).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return host;
}

// ── Directories via Semrush referring-domains ────────────────────────────────
async function discoverDirectories(competitors) {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    return { candidates: [], note: 'Add SEMRUSH_API_KEY (a Semrush Analytics API subscription) to enable directory discovery. The curated list still works without it.' };
  }
  const tally = new Map(); // domain -> { count, ascore }
  for (const comp of competitors) {
    const params = new URLSearchParams({
      key, type: 'backlinks_refdomains', target: comp, target_type: 'root_domain',
      export_columns: 'domain,domain_ascore,backlinks_num', display_limit: '150', display_sort: 'domain_ascore_desc',
    });
    let text;
    try {
      const r = await fetch('https://api.semrush.com/analytics/v1/?' + params.toString());
      text = await r.text();
      if (!r.ok || /ERROR/i.test(text)) continue; // skip this competitor, keep going
    } catch { continue; }

    const lines = text.trim().split('\n');
    lines.shift(); // header
    for (const line of lines) {
      const [domain, ascore] = line.split(';');
      const d = rootDomain(domain || '');
      if (!d || BLOCK.has(d)) continue;
      const prev = tally.get(d) || { count: 0, ascore: 0 };
      prev.count += 1;
      prev.ascore = Math.max(prev.ascore, parseInt(ascore, 10) || 0);
      tally.set(d, prev);
    }
  }

  const candidates = [...tally.entries()]
    // Prefer domains linking to MORE than one competitor (stronger relevance signal)
    // or high-authority single links.
    .filter(([, v]) => v.count >= 2 || v.ascore >= 40)
    .sort((a, b) => (b[1].count - a[1].count) || (b[1].ascore - a[1].ascore))
    .slice(0, 40)
    .map(([domain, v]) => ({
      id: slug('directory-' + domain),
      channel: 'directory',
      name: domain,
      url: 'https://' + domain,
      authority: v.ascore >= 60 ? 'high' : v.ascore >= 35 ? 'med' : 'low',
      care: 'med',
      notes: `Links to ${v.count} competitor${v.count > 1 ? 's' : ''} · Semrush authority ${v.ascore}. Check for a submit/list page.`,
      source: 'semrush',
      discoveredAt: new Date().toISOString(),
    }));

  return { candidates, note: candidates.length ? '' : 'No new referring domains passed the relevance filter.' };
}

// ── Quora questions via search ───────────────────────────────────────────────
async function serpapiQuora(queries) {
  const key = process.env.SERPAPI_KEY;
  const found = new Map();
  for (const q of queries) {
    const params = new URLSearchParams({ engine: 'google', q: `site:quora.com ${q}`, num: '10', api_key: key });
    try {
      const r = await fetch('https://serpapi.com/search.json?' + params.toString());
      const j = await r.json();
      for (const res of (j.organic_results || [])) {
        if (res.link && /quora\.com\/[^/]+\/answers?|quora\.com\/[^/?]+$|quora\.com\/[^/]+\?/.test(res.link) === false && /quora\.com\//.test(res.link)) {
          found.set(res.link.split('?')[0], res.title || q);
        }
      }
    } catch { /* skip query */ }
  }
  return found;
}
async function ddgQuora(queries) {
  const found = new Map();
  for (const q of queries) {
    try {
      const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(`site:quora.com ${q}`), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; resume4u-seo/1.0)' },
      });
      const html = await r.text();
      // DuckDuckGo HTML wraps real URLs in a redirect; pull the uddg= param.
      const re = /uddg=([^&"']+)/g; let m;
      while ((m = re.exec(html))) {
        const url = decodeURIComponent(m[1]).split('?')[0];
        if (/^https?:\/\/[^/]*quora\.com\/[^/]+$/.test(url)) found.set(url, q);
      }
    } catch { /* skip query */ }
  }
  return found;
}
async function discoverQuora(queries) {
  const found = process.env.SERPAPI_KEY ? await serpapiQuora(queries) : await ddgQuora(queries);
  const candidates = [...found.entries()].slice(0, 40).map(([url, q]) => {
    const title = decodeURIComponent(url.split('/').pop().replace(/-/g, ' '));
    return {
      id: slug('quora-' + url.split('/').pop()),
      channel: 'quora',
      name: 'Quora — ' + (title.length > 3 ? title : q),
      url,
      authority: 'high',
      care: 'high',
      notes: `Matched "${q}". Draft a genuinely useful answer; mention resume4u once near the end.`,
      source: process.env.SERPAPI_KEY ? 'serpapi' : 'search',
      discoveredAt: new Date().toISOString(),
    };
  });
  return {
    candidates,
    note: candidates.length ? '' : 'No Quora questions found. For more reliable results add SERPAPI_KEY; the keyless fallback can be rate-limited.',
  };
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const CORS = cors(origin);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const expected = process.env.SEO_ADMIN_TOKEN || UAT_FALLBACK;
  const token = event.headers['x-seo-token'] || event.headers['X-Seo-Token'] || '';
  if (token !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const channel = body.channel === 'quora' ? 'quora' : 'directory';

    if (channel === 'directory') {
      const competitors = Array.isArray(body.competitors) && body.competitors.length ? body.competitors.map(rootDomain) : DEFAULT_COMPETITORS;
      return { statusCode: 200, headers: CORS, body: JSON.stringify(await discoverDirectories(competitors)) };
    }
    const queries = Array.isArray(body.queries) && body.queries.length ? body.queries : DEFAULT_QUORA_QUERIES;
    return { statusCode: 200, headers: CORS, body: JSON.stringify(await discoverQuora(queries)) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
