/* jobs.js — job matching for WhatsApp ("jobs", "job alerts") and the daily
 * job-alerts function.
 *
 * Sources, first one configured wins:
 *   1. Jooble     JOOBLE_API_KEY (free, no card: jooble.org/api/about).
 *                 Optional JOOBLE_HOST (default in.jooble.org, India listings).
 *   2. Adzuna     ADZUNA_APP_ID + ADZUNA_APP_KEY.
 * Results are ranked by how well they match the user's resume (skills found in
 * the listing + title similarity). With no keys it falls back to fresh,
 * pre-filtered search links on Naukri, LinkedIn, Indeed and foundit for the
 * user's role + city — still useful, never fake listings.
 */

const STOP = new Set(['and', 'the', 'of', 'for', 'in', 'at', 'a', 'an', 'to', 'with', 'senior', 'junior', 'sr', 'jr', 'lead', 'ii', 'iii', 'i']);
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w && !STOP.has(w));

/* Role / city / skills for a WhatsApp profile (bot-built or web-linked shape). */
function deriveSearch(p, override) {
  p = p || {};
  const o = override || {};
  const exp = (p.experience && p.experience[0]) || (p.experiences && p.experiences[0]) || {};
  let role = o.role || p.jobTitle || p.role || exp.title || String(exp.role || '').split(/\s+at\s+/i)[0] || '';
  let city = o.city || p.location || p.city || '';
  city = String(city).split(',')[0].trim();
  const skills = (Array.isArray(p.skills) ? p.skills : String(p.skills || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 25);
  return { role: String(role).trim().slice(0, 80), city: city.slice(0, 60), skills };
}

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function searchLinks(role, city) {
  const q = encodeURIComponent(role || 'jobs'), l = encodeURIComponent(city || 'India');
  return [
    ['Naukri', 'https://www.naukri.com/' + slug(role || 'jobs') + '-jobs' + (city ? '-in-' + slug(city) : '') + '?jobAge=1'],
    ['LinkedIn', 'https://www.linkedin.com/jobs/search/?keywords=' + q + '&location=' + l + '&f_TPR=r86400'],
    ['Indeed', 'https://in.indeed.com/jobs?q=' + q + (city ? '&l=' + l : '') + '&fromage=1'],
    ['foundit', 'https://www.foundit.in/srp/results?query=' + q + (city ? '&locations=' + l : '')]
  ];
}

function scoreJob(job, s) {
  const text = (job.title + ' ' + job.description).toLowerCase();
  const matched = s.skills.filter((k) => k.length > 1 && text.includes(k.toLowerCase()));
  const rw = words(s.role), tw = new Set(words(job.title));
  const titleHit = rw.length ? rw.filter((w) => tw.has(w)).length / rw.length : 0;
  return { score: Math.round(titleHit * 60 + Math.min(matched.length, 8) * 5), matched: matched.slice(0, 4) };
}

function rank(jobs, s) {
  jobs = jobs.filter((x) => x.title && x.url);
  jobs.forEach((job) => { const m = scoreJob(job, s); job.match = m.score; job.matched = m.matched; });
  const seen = new Set();
  jobs = jobs.filter((x) => { const k = (x.title + '|' + x.company).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  jobs.sort((a, b) => (b.match - a.match) || String(b.created).localeCompare(String(a.created)));
  // Prefer listings that actually match; only pad with unmatched ones if few match.
  const good = jobs.filter((x) => x.match > 0);
  return good.length >= 3 ? good : good.concat(jobs.filter((x) => x.match === 0));
}
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function fetchJooble(s, opts) {
  const key = process.env.JOOBLE_API_KEY;
  const host = (process.env.JOOBLE_HOST || 'in.jooble.org').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://' + host + '/api/' + encodeURIComponent(key), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ keywords: s.role, location: s.city || 'India', page: '1' })
    });
    if (!r.ok) { console.error('[jobs] jooble', r.status); return null; }
    const j = await r.json();
    const maxMs = ((opts && opts.maxDays) || 3) * 864e5;
    const jobs = (j.jobs || []).map((x) => ({
      id: 'jb:' + String(x.id || x.link || ''),
      title: strip(x.title), company: strip(x.company), location: strip(x.location),
      url: x.link || '', description: strip(x.snippet), created: x.updated || ''
    })).filter((x) => { const d = Date.parse(x.created); return !d || Date.now() - d < maxMs; });
    return rank(jobs, s);
  } catch (e) { console.error('[jobs] jooble failed', e && e.message); return null; }
  finally { clearTimeout(t); }
}

async function fetchJobs(search, opts) {
  const s = search || {};
  const links = searchLinks(s.role, s.city);
  if (!s.role) return { source: 'links', jobs: [], links };
  if (process.env.JOOBLE_API_KEY) {
    const jobs = await fetchJooble(s, opts);
    if (jobs && jobs.length) return { source: 'jooble', jobs, links };
  }
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return { source: 'links', jobs: [], links };
  const params = new URLSearchParams({
    app_id: id, app_key: key, results_per_page: '30', what: s.role, max_days_old: String((opts && opts.maxDays) || 3),
    sort_by: 'date', 'content-type': 'application/json'
  });
  if (s.city) params.set('where', s.city);
  try {
    const r = await fetch('https://api.adzuna.com/v1/api/jobs/in/search/1?' + params.toString());
    if (!r.ok) { console.error('[jobs] adzuna', r.status); return { source: 'links', jobs: [], links }; }
    const j = await r.json();
    const jobs = (j.results || []).map((x) => ({
      id: String(x.id || x.redirect_url || ''),
      title: strip(x.title), company: (x.company && x.company.display_name) || '',
      location: (x.location && x.location.display_name) || '', url: x.redirect_url || '',
      description: strip(x.description), created: x.created || ''
    }));
    return { source: 'adzuna', jobs: rank(jobs, s), links };
  } catch (e) {
    console.error('[jobs] adzuna failed', e && e.message);
    return { source: 'links', jobs: [], links };
  }
}

/* WhatsApp-formatted message (plain text, WhatsApp *bold*). */
function formatJobs(search, res, opts) {
  const o = opts || {};
  const where = search.city ? ' in ' + search.city : '';
  const lines = [];
  const list = (res.jobs || []).slice(0, o.limit || 5);
  if (list.length) {
    lines.push('💼 *' + list.length + ' fresh jobs for ' + search.role + where + '* — matched to your resume\n');
    list.forEach((j, i) => {
      lines.push((i + 1) + '. *' + j.title + '*' + (j.company ? ' — ' + j.company : '') + (j.location ? ' · ' + j.location : ''));
      if (j.matched && j.matched.length) lines.push('   ✅ Matches: ' + j.matched.join(', '));
      lines.push('   🔗 ' + j.url);
    });
    lines.push('\nMore (posted in the last 24h): ' + res.links.slice(0, 2).map((l) => l[0] + ' ' + l[1]).join('\n'));
  } else {
    lines.push('💼 *Fresh jobs for ' + (search.role || 'you') + where + '* (posted in the last 24h):\n');
    res.links.forEach((l) => lines.push('• ' + l[0] + ': ' + l[1]));
    if (search.skills && search.skills.length) lines.push('\nTip: add these from your resume to the search to narrow it: ' + search.skills.slice(0, 4).join(', '));
  }
  if (o.footer !== false) lines.push('\nReply *job alerts* for a daily list · *stop alerts* to stop · *jobs <role> in <city>* to search something else.');
  return lines.join('\n');
}

/* "jobs data analyst in pune" -> { role, city } */
function parseJobQuery(text) {
  const t = String(text || '').trim().replace(/^(job alerts?|find jobs?|search jobs?|daily jobs|jobs?)\b\s*(for|of)?\b\s*/i, '');
  if (!t) return {};
  const onlyCity = t.match(/^in\s+(.+)$/i);           // "jobs in pune" -> keep the resume's role
  if (onlyCity) return { city: onlyCity[1].trim() };
  const m = t.match(/^(.+?)\s+in\s+(.+)$/i);
  return m ? { role: m[1].trim(), city: m[2].trim() } : { role: t };
}

module.exports = { deriveSearch, fetchJobs, formatJobs, searchLinks, parseJobQuery, scoreJob };
