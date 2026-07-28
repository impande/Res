// Backend for the semi-automated SEO submissions dashboard (/seo-admin/).
//
// Stateless: validates the admin token and returns the curated seed list of
// submission targets. Working state (statuses, custom targets, cached drafts)
// is persisted client-side in the browser, so no server data store is needed.
// This is deliberately a "human-in-the-loop" tool: it curates targets and tracks
// status, but a human still clicks the final Submit on each platform. That keeps
// resume4u.help clear of Google link-spam penalties and keeps the accounts
// (Quora, directories, bookmarking sites) from being banned for automation.
//
// Auth: every request must carry `x-seo-token` matching the SEO_ADMIN_TOKEN
// Netlify env var. Client-side UI gating isn't a security boundary; this token is.

// TEMP UAT login. Lets the dashboard be tested on the branch deploy without
// setting a Netlify env var. The real SEO_ADMIN_TOKEN env var always wins when
// present. Remove this (or set the env var) before any production promotion.
const UAT_FALLBACK = 'uat-resume4u-Kq7Zp9Xm2L';

// ── Curated seed targets ────────────────────────────────────────────────────
// High-authority, legitimately relevant places for a resume/career SaaS tool.
// No link farms. "care: high" = read the platform's self-promo rules before you
// post, or it gets removed.
const SEED = [
  // ---- Product / SaaS / startup directories ----
  { channel: 'directory', name: 'Product Hunt',        url: 'https://www.producthunt.com/posts/new',            authority: 'high',   care: 'high', notes: 'Launch-style. Best on a Tue–Thu. Needs a good tagline + gallery images.' },
  { channel: 'directory', name: 'BetaList',            url: 'https://betalist.com/submit',                      authority: 'high',   care: 'med',  notes: 'For newer products. One-line pitch + screenshot.' },
  { channel: 'directory', name: 'SaaSHub',             url: 'https://www.saashub.com/submit-software',          authority: 'high',   care: 'low',  notes: 'Free listing; good for "alternatives" long-tail.' },
  { channel: 'directory', name: 'AlternativeTo',       url: 'https://alternativeto.net/',                       authority: 'high',   care: 'med',  notes: 'Add resume4u as an alternative to popular resume builders.' },
  { channel: 'directory', name: 'G2',                  url: 'https://www.g2.com/products/new',                  authority: 'high',   care: 'med',  notes: 'Vendor listing; seed a few real reviews after.' },
  { channel: 'directory', name: 'Capterra / GetApp',  url: 'https://www.capterra.com/vendors/sign-up',         authority: 'high',   care: 'med',  notes: 'Software category listing; strong for buyer-intent traffic.' },
  { channel: 'directory', name: 'Crunchbase',          url: 'https://www.crunchbase.com/',                      authority: 'high',   care: 'low',  notes: 'Create a company profile with the website link.' },
  { channel: 'directory', name: 'SaaSworthy',          url: 'https://www.saasworthy.com/',                      authority: 'med',    care: 'low',  notes: 'Free software listing.' },
  { channel: 'directory', name: 'Launching Next',      url: 'https://www.launchingnext.com/submit/',            authority: 'med',    care: 'low',  notes: 'Startup directory, quick submit.' },
  { channel: 'directory', name: 'Indie Hackers',       url: 'https://www.indiehackers.com/products',            authority: 'high',   care: 'med',  notes: 'Add as a product; share the build story for engagement.' },

  // ---- AI-tool directories (resume4u uses AI generation) ----
  { channel: 'directory', name: "There's An AI For That", url: 'https://theresanaiforthat.com/submit/',         authority: 'high',   care: 'med',  notes: 'Large AI-tools directory; category: resume/career.' },
  { channel: 'directory', name: 'Futurepedia',         url: 'https://www.futurepedia.io/submit-tool',           authority: 'high',   care: 'med',  notes: 'Paid fast-track exists; free queue is slow but fine.' },
  { channel: 'directory', name: 'Toolify',             url: 'https://www.toolify.ai/submit',                    authority: 'med',    care: 'low',  notes: 'AI tools directory.' },
  { channel: 'directory', name: 'Future Tools',        url: 'https://www.futuretools.io/submit-a-tool',         authority: 'med',    care: 'low',  notes: 'Curated AI tools.' },
  { channel: 'directory', name: 'Dang.ai',             url: 'https://dang.ai/submit',                           authority: 'med',    care: 'low',  notes: 'AI tools directory; quick free submit.' },
  { channel: 'directory', name: 'Openfuture AI',       url: 'https://www.openfuture.ai/',                       authority: 'med',    care: 'low',  notes: 'Large AI directory; free listing.' },
  { channel: 'directory', name: 'Toolpilot',           url: 'https://www.toolpilot.ai/',                        authority: 'low',    care: 'low',  notes: 'AI tools listing.' },

  // ---- More product/startup directories (free, quick, legit) ----
  { channel: 'directory', name: 'Startup Stash',       url: 'https://startupstash.com/add-startup/',            authority: 'high',   care: 'low',  notes: 'Well-known startup resource directory.' },
  { channel: 'directory', name: 'StartupBase',         url: 'https://startupbase.io/',                          authority: 'med',    care: 'low',  notes: 'Community startup directory; upvotes help.' },
  { channel: 'directory', name: '10words',             url: 'https://10words.io/submit',                        authority: 'med',    care: 'low',  notes: 'Describe the product in 10 words; fast submit.' },
  { channel: 'directory', name: 'Uneed',               url: 'https://www.uneed.best/submit-a-tool',             authority: 'med',    care: 'low',  notes: 'Daily tool directory; free + paid queues.' },
  { channel: 'directory', name: 'Fazier',              url: 'https://fazier.com/submit',                        authority: 'med',    care: 'low',  notes: 'Launch/directory hybrid; free listing.' },
  { channel: 'directory', name: 'Peerlist Launchpad',  url: 'https://peerlist.io/',                             authority: 'med',    care: 'med',  notes: 'Professional network; launch your project.' },
  { channel: 'directory', name: 'Crozdesk',            url: 'https://crozdesk.com/vendors',                     authority: 'med',    care: 'low',  notes: 'Software marketplace; vendor listing.' },
  { channel: 'directory', name: 'GoodFirms',           url: 'https://www.goodfirms.co/',                        authority: 'med',    care: 'low',  notes: 'Software + services directory; free profile.' },

  // ---- Social bookmarking / community (mostly referral traffic; low SEO value) ----
  { channel: 'bookmarking', name: 'Hacker News (Show HN)', url: 'https://news.ycombinator.com/submit',          authority: 'high',   care: 'high', notes: 'Title format: "Show HN: resume4u – …". Comment, do not just drop a link.' },
  { channel: 'bookmarking', name: 'Reddit r/resumes',  url: 'https://www.reddit.com/r/resumes/',                authority: 'high',   care: 'high', notes: 'Strict self-promo rules. Be helpful first; disclose you built it.' },
  { channel: 'bookmarking', name: 'Reddit r/jobs',     url: 'https://www.reddit.com/r/jobs/',                   authority: 'high',   care: 'high', notes: 'Only where a tool genuinely answers the thread.' },
  { channel: 'bookmarking', name: 'Reddit r/jobsearch', url: 'https://www.reddit.com/r/jobsearch/',             authority: 'high',   care: 'high', notes: 'Answer real questions; disclose you built the tool.' },
  { channel: 'bookmarking', name: 'Reddit r/careerguidance', url: 'https://www.reddit.com/r/careerguidance/',   authority: 'high',   care: 'high', notes: 'Helpful-first; link only when it fits the thread.' },
  { channel: 'bookmarking', name: 'Pinterest',         url: 'https://www.pinterest.com/pin-builder/',           authority: 'high',   care: 'low',  notes: 'Pin resume-template images linking back to a landing page.' },
  { channel: 'bookmarking', name: 'Flipboard',         url: 'https://flipboard.com/',                           authority: 'med',    care: 'low',  notes: 'Create a "Resume tips" magazine and flip your pages in.' },
  { channel: 'bookmarking', name: 'Mix',               url: 'https://mix.com/',                                 authority: 'low',    care: 'low',  notes: 'Quick save; minimal SEO value, some referral.' },

  // ---- Quora (drafts are for YOU to post manually; automation gets banned) ----
  { channel: 'quora', name: 'Quora — "best free resume builder"', url: 'https://www.quora.com/search?q=best%20free%20resume%20builder', authority: 'high', care: 'high', notes: 'Search seed. Add specific question URLs, then draft a genuinely useful answer.' },
  { channel: 'quora', name: 'Quora — "how to make an ATS resume"', url: 'https://www.quora.com/search?q=how%20to%20make%20an%20ATS%20resume', authority: 'high', care: 'high', notes: 'Answer the question fully; mention the tool once, near the end.' },
  { channel: 'quora', name: 'Quora — "resume for first job"',      url: 'https://www.quora.com/search?q=resume%20for%20first%20job',        authority: 'high', care: 'high', notes: 'Great fit for the /how-to-make-resume-for-first-job page.' },
  { channel: 'quora', name: 'Quora — "how to pass ATS scanner"',   url: 'https://www.quora.com/search?q=how%20to%20pass%20ATS%20resume%20scanner', authority: 'high', care: 'high', notes: 'High-intent; explain ATS then mention the tool once.' },
  { channel: 'quora', name: 'Quora — "best resume format"',        url: 'https://www.quora.com/search?q=best%20resume%20format',            authority: 'high', care: 'high', notes: 'Evergreen question with lots of views.' },
  { channel: 'quora', name: 'Quora — "how to write a cover letter"', url: 'https://www.quora.com/search?q=how%20to%20write%20a%20cover%20letter', authority: 'high', care: 'high', notes: 'Ties to the /cover-letter-generator page.' },
];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function seedTargets() {
  const now = new Date().toISOString();
  return SEED.map(t => ({
    id: slug(t.channel + '-' + t.name),
    channel: t.channel,
    name: t.name,
    url: t.url,
    authority: t.authority || 'med',
    care: t.care || 'low',
    notes: t.notes || '',
    status: 'todo',      // todo | drafted | submitted | live | rejected | skipped
    submittedUrl: '',    // the resulting backlink, filled in once live
    draft: null,         // generated copy, cached from seo-draft
    updatedAt: now,
  }));
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': (origin && origin !== 'null') ? origin : '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-seo-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const CORS = cors(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const expected = process.env.SEO_ADMIN_TOKEN || UAT_FALLBACK;
  const token = event.headers['x-seo-token'] || event.headers['X-Seo-Token'] || '';
  if (token !== expected) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Stateless: this function validates the token and returns the curated seed
  // list. All working state (statuses, custom targets, cached drafts) is persisted
  // client-side in the browser (localStorage), so the dashboard needs no server
  // storage — no Netlify Blobs setup required. If you later want state shared
  // across devices, this is where a server store (Blobs/Firestore) would slot back in.
  try {
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ targets: seedTargets(), updatedAt: new Date().toISOString() }) };
    }
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
