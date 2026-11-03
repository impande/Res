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

/* The role's "head" word (Owner in "Product Owner", Analyst in "Data Analyst") must
 * be in the job title for it to count as a real match; a shared modifier alone
 * ("Product Designer" for a Product Owner) does not. */
const HEAD_SYN = { developer: ['engineer', 'programmer'], engineer: ['developer'], manager: ['lead', 'head'], executive: ['associate', 'officer'] };
function scoreJob(job, s) {
  const text = (job.title + ' ' + job.description).toLowerCase();
  const matched = s.skills.filter((k) => k.length > 1 && text.includes(k.toLowerCase()));
  const rw = words(s.role), tw = new Set(words(job.title));
  const titleHit = rw.length ? rw.filter((w) => tw.has(w)).length / rw.length : 0;
  const head = rw[rw.length - 1];
  const headHit = !head || tw.has(head) || (HEAD_SYN[head] || []).some((w) => tw.has(w));
  return { score: Math.round(titleHit * 60 + Math.min(matched.length, 8) * 5) + (headHit ? 40 : 0), matched: matched.slice(0, 4), head: headHit };
}

function rank(jobs, s) {
  jobs = jobs.filter((x) => x.title && x.url);
  jobs.forEach((job) => { const m = scoreJob(job, s); job.match = m.score; job.matched = m.matched; job.head = m.head; });
  const seen = new Set();
  jobs = jobs.filter((x) => { const k = (x.title + '|' + x.company).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  // Freshness matters as much as fit: listings Jooble saw in the last 24-48h are far
  // less likely to be closed on the source site (e.g. "job expired" on Naukri).
  jobs.forEach((x) => { const d = Date.parse(x.created); x.ageH = d ? Math.max(0, (Date.now() - d) / 36e5) : null; x.rank = x.match + (x.ageH == null ? 0 : x.ageH < 24 ? 25 : x.ageH < 48 ? 12 : 0); });
  jobs.sort((a, b) => (b.rank - a.rank) || String(b.created).localeCompare(String(a.created)));
  // Real matches first; only pad with near matches when there are fewer than 3.
  const good = jobs.filter((x) => x.head);
  return good.length >= 3 ? good : good.concat(jobs.filter((x) => !x.head && x.match > 0));
}
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/* Jooble keys are issued per site, so try the India site first, then the global
 * one (with ", India" in the location). JOOBLE_HOST pins a single host. */
async function joobleCall(host, key, s, location) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch('https://' + host + '/api/' + encodeURIComponent(key), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ keywords: s.role, location: location, page: '1' })
    });
    if (!r.ok) { console.error('[jobs] jooble', host, r.status); return null; }
    const j = await r.json();
    return Array.isArray(j.jobs) ? j.jobs : [];
  } catch (e) { console.error('[jobs] jooble failed', host, e && e.message); return null; }
  finally { clearTimeout(t); }
}
/* Best-effort liveness check on the listing pages we are about to send (Jooble's own
 * pages; we never scrape the source boards). Drops listings Jooble has removed (404/410)
 * or marks as closed. Unknown / slow / redirecting pages are kept — we can't confirm
 * them either way. Checks the top N in parallel with a short timeout. */
const CLOSED_RE = /no longer (available|active|accepting)|job (has )?expired|this (job|vacancy|position) (is|has been) (closed|filled|removed)|vacancy (is )?closed|position (has been )?filled/i;
async function alive(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Resume4uJobAlerts/1.0)' } });
    if (r.status === 404 || r.status === 410) return false;
    if (r.status === 200) { const html = (await r.text()).slice(0, 60000); return !CLOSED_RE.test(html); }
    return true;                                   // redirects to the source / other: can't tell → keep
  } catch (e) { return true; }                     // timeout / network: keep
  finally { clearTimeout(t); }
}
async function verifyLinks(jobs, n) {
  if (!jobs.length) return jobs;
  const head = jobs.slice(0, n), rest = jobs.slice(n);
  const ok = await Promise.all(head.map((j) => alive(j.url)));
  const dropped = ok.filter((x) => !x).length;
  if (dropped) console.log('[jobs] dropped', dropped, 'closed listing(s)');
  return head.filter((j, i) => ok[i]).concat(rest);
}

async function fetchJooble(s, opts) {
  const key = process.env.JOOBLE_API_KEY;
  const pinned = (process.env.JOOBLE_HOST || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const tries = pinned ? [[pinned, s.city || 'India']]
    : [['in.jooble.org', s.city || 'India'], ['jooble.org', s.city ? s.city + ', India' : 'India']];
  const maxMs = ((opts && opts.maxDays) || 3) * 864e5;
  for (const [host, loc] of tries) {
    const raw = await joobleCall(host, key, s, loc);
    if (!raw || !raw.length) continue;
    const jobs = raw.map((x) => ({
      id: 'jb:' + String(x.id || x.link || ''),
      title: strip(x.title), company: strip(x.company), location: strip(x.location),
      url: x.link || '', description: strip(x.snippet), created: x.updated || ''
    })).filter((x) => { const d = Date.parse(x.created); return !d || Date.now() - d < maxMs; });
    const ranked = await verifyLinks(rank(jobs, s), (opts && opts.verify) || 8);
    if (ranked.length) return { jobs: ranked, host: host };
  }
  return null;
}

async function fetchJobs(search, opts) {
  const s = search || {};
  const links = searchLinks(s.role, s.city);
  if (!s.role) return { source: 'links', jobs: [], links };
  if (process.env.JOOBLE_API_KEY) {
    const jb = await fetchJooble(s, opts);
    if (jb) return { source: 'jooble', host: jb.host, jobs: jb.jobs, links };
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
    lines.push('💼 *' + list.length + ' fresh job' + (list.length === 1 ? '' : 's') + ' for ' + search.role + where + '* — matched to your ' + ((search.skills || []).length ? 'resume' : 'role') + '\n');
    list.forEach((j, i) => {
      lines.push((i + 1) + '. *' + j.title + '*' + (j.company ? ' — ' + j.company : '') + (j.location ? ' · ' + j.location : ''));
      if (j.matched && j.matched.length) lines.push('   ✅ Matches: ' + j.matched.join(', '));
      if (j.ageH != null) lines.push('   🕒 ' + (j.ageH < 24 ? 'Posted today' : j.ageH < 48 ? 'Posted yesterday' : 'Posted ' + Math.round(j.ageH / 24) + ' days ago'));
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

/* "product manager" -> "Product Manager" (leaves "UX lead at SaaS" etc. alone if the user typed capitals) */
function titleCase(t) { t = String(t || '').trim(); return /[A-Z]/.test(t) ? t : t.replace(/(^|[\s\-\/])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }

/* "jobs data analyst in pune" -> { role, city } */
function parseJobQuery(text) {
  const t = String(text || '').trim().replace(/^(job alerts?|find jobs?|search jobs?|daily jobs|jobs?)\b\s*(for|of)?\b\s*/i, '');
  if (!t) return {};
  const onlyCity = t.match(/^in\s+(.+)$/i);           // "jobs in pune" -> keep the resume's role
  if (onlyCity) return { city: titleCase(onlyCity[1]) };
  const m = t.match(/^(.+?)\s+in\s+(.+)$/i);
  return m ? { role: titleCase(m[1]), city: titleCase(m[2]) } : { role: titleCase(t) };
}

module.exports = { deriveSearch, fetchJobs, formatJobs, searchLinks, parseJobQuery, scoreJob, titleCase };
