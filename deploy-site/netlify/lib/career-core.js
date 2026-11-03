/* career-core.js — shared engine for the free public career tools
 * (ATS checker, LinkedIn optimizer, interview prep, regional-language resume,
 * government-job biodata). Used by:
 *   - functions/career-tools-background.js  (heavy job, no 26s cap -> Redis)
 *   - functions/career-tools.js             (poll results + fast sync fallback)
 *
 * Design:
 *   - Each tool = a purpose-built system prompt + a JSON schema enforced with
 *     structured outputs (output_config.format), so responses always parse.
 *   - Model per tool, with a fast variant (lower effort / quicker model) for the
 *     synchronous fallback path that has to finish inside Netlify's 26s limit.
 *   - ATS score is computed HERE, deterministically, from the model's per-area
 *     grades (fixed weights + length / no-bullet caps) so the same resume gets
 *     the same score every time.
 *   - Per-IP and global daily rate limits (Upstash), because these pages are
 *     public and free.
 */

const API = 'https://api.anthropic.com/v1/messages';
const crypto = require('crypto');

/* ------------------------------------------------------------------ redis */
async function rcmd(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return { ok: false, result: null };
  try {
    const r = await fetch(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, result: j && j.result };
  } catch (e) {
    console.error('[career] redis failed', e && e.message);
    return { ok: false, result: null };
  }
}
async function rpipe(cmds) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify(cmds)
    });
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j.map((x) => x && x.result) : null;
  } catch (e) {
    console.error('[career] redis pipeline failed', e && e.message);
    return null;
  }
}

/* ----------------------------------------------------------- rate limits */
function clientIp(event) {
  const h = (event && event.headers) || {};
  const ip = h['x-nf-client-connection-ip'] || h['client-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || '';
  return String(ip).trim() || 'unknown';
}
// Fails OPEN if Redis is unavailable (the tools keep working; logged).
async function rateLimit(event, opts) {
  const ip = clientIp(event).replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64) || 'unknown';
  const now = new Date();
  const hour = now.toISOString().slice(0, 13), day = now.toISOString().slice(0, 10);
  const mult = (opts && opts.mult) || 1;   // builder users re-score after edits
  const PER_HOUR = parseInt(process.env.TOOLS_PER_HOUR || '8', 10) * mult;
  const PER_DAY = parseInt(process.env.TOOLS_PER_DAY || '25', 10) * mult;
  const GLOBAL = parseInt(process.env.TOOLS_DAILY_CAP || '3000', 10);
  const kh = 'ct:rl:h:' + hour + ':' + ip, kd = 'ct:rl:d:' + day + ':' + ip, kg = 'ct:rl:g:' + day;
  const res = await rpipe([
    ['SET', kh, '0', 'EX', '3700', 'NX'], ['INCR', kh],
    ['SET', kd, '0', 'EX', '90000', 'NX'], ['INCR', kd],
    ['SET', kg, '0', 'EX', '90000', 'NX'], ['INCR', kg]
  ]);
  if (!res) return { ok: true };
  const h = Number(res[1]) || 0, d = Number(res[3]) || 0, g = Number(res[5]) || 0;
  if (g > GLOBAL) return { ok: false, message: 'Our free tools are very busy today. Please try again tomorrow, or build your resume in the free builder.' };
  if (h > PER_HOUR) return { ok: false, message: 'You have used the free tools a lot this hour. Please try again in a little while.' };
  if (d > PER_DAY) return { ok: false, message: "You have reached today's free limit. Please come back tomorrow." };
  return { ok: true };
}

/* ------------------------------------------------------------- job store */
const JOB_RE = /^[a-f0-9]{16,40}$/;
async function setJob(id, obj) { if (JOB_RE.test(id)) await rcmd(['SET', 'ct:job:' + id, JSON.stringify(obj), 'EX', '3600']); }
async function getJob(id) {
  if (!JOB_RE.test(id || '')) return null;
  const r = await rcmd(['GET', 'ct:job:' + id]);
  if (!r.result) return null;
  try { return JSON.parse(r.result); } catch (e) { return null; }
}

/* ------------------------------------------------------- ATS score cache
 * One engine scores both the builder (step 8) and the upload checker. A result
 * is cached against a fingerprint of the resume TEXT that ignores order,
 * spacing, line breaks, bullets and case (the characters, sorted) — so the same
 * resume read from the builder page or extracted from its PDF gets the SAME
 * score, and re-checking an unchanged resume never drifts. Any real edit changes
 * the fingerprint and re-grades. */
function atsKey(i) {
  const chars = String(i.resumeText || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const fp = Array.from(chars).sort().join('');
  return 'ct:ats:v1:' + crypto.createHash('sha256')
    .update(fp + '|' + (i.pageCount || 0) + '|' + String(i.targetRole || '').toLowerCase().trim()).digest('hex');
}
async function cachedAts(rawInput) {
  const i = cleanInput(rawInput);
  if (i.resumeText.length < 120) return null;
  const r = await rcmd(['GET', atsKey(i)]);
  if (!r.result) return null;
  try { return JSON.parse(r.result); } catch (e) { return null; }
}

/* ------------------------------------------------------------ input prep */
const clip = (s, n) => String(s == null ? '' : s).replace(/\u0000/g, '').trim().slice(0, n);
function cleanInput(raw) {
  const i = raw || {};
  return {
    resumeText: clip(i.resumeText, 24000),
    pageCount: Math.max(0, Math.min(20, parseInt(i.pageCount, 10) || 0)),
    targetRole: clip(i.targetRole, 120),
    jobPost: clip(i.jobPost, 9000),
    language: clip(i.language, 40),
    tone: clip(i.tone, 40)
  };
}

/* --------------------------------------------------------------- schemas */
const S = (type, extra) => Object.assign({ type }, extra || {});
const OBJ = (props, req) => ({ type: 'object', properties: props, required: req || Object.keys(props), additionalProperties: false });
const ARR = (items) => ({ type: 'array', items });
const STR = S('string'), INT = S('integer'), BOOL = S('boolean');
const AREA = OBJ({ score: INT, note: STR });

const ATS_AREAS = [
  // key, label, weight
  ['parseability', 'Parseability & contact', 15],
  ['structure', 'Structure & sections', 10],
  ['impact', 'Impact & quantified results', 25],
  ['verbs', 'Action verbs & clarity', 15],
  ['skills', 'Skills & keywords', 15],
  ['experience', 'Experience depth', 10],
  ['length', 'Length & formatting', 10]
];

const SCHEMAS = {
  ats_check: OBJ({
    candidate_name: STR,
    target_role: STR,
    years_experience: INT,
    verdict: STR,
    summary: STR,
    has_achievement_bullets: BOOL,
    placeholder_count: INT,
    areas: OBJ(Object.fromEntries(ATS_AREAS.map(([k]) => [k, AREA]))),
    strengths: ARR(STR),
    fixes: ARR(OBJ({ priority: S('string', { enum: ['high', 'medium', 'low'] }), issue: STR, fix: STR })),
    missing_keywords: ARR(STR)
  }),
  linkedin: OBJ({
    target_role: STR,
    headlines: ARR(OBJ({ style: STR, text: STR })),
    about: STR,
    top_skills: ARR(STR),
    experience: ARR(OBJ({ title: STR, company: STR, description: STR })),
    featured_ideas: ARR(STR),
    profile_tips: ARR(STR)
  }),
  interview: OBJ({
    role: STR,
    company: STR,
    fit_summary: STR,
    questions: ARR(OBJ({ category: STR, question: STR, why_asked: STR, answer_outline: STR })),
    gaps_to_prepare: ARR(STR),
    questions_to_ask: ARR(STR)
  }),
  translate: OBJ({
    language: STR,
    name: STR,
    title: STR,
    contact: ARR(STR),
    summary: STR,
    experience: ARR(OBJ({ title: STR, company: STR, dates: STR, bullets: ARR(STR) })),
    education: ARR(OBJ({ degree: STR, institution: STR, year: STR, score: STR })),
    skills: ARR(STR),
    languages: ARR(STR),
    section_titles: OBJ({ summary: STR, experience: STR, education: STR, skills: STR, languages: STR, contact: STR })
  }),
  biodata: OBJ({
    full_name: STR, father_name: STR, mother_name: STR, dob: STR, gender: STR, category: STR,
    nationality: STR, religion: STR, marital_status: STR, mobile: STR, email: STR,
    permanent_address: STR, correspondence_address: STR, objective: STR,
    languages_known: ARR(STR),
    education: ARR(OBJ({ exam: STR, board: STR, year: STR, percentage: STR, subjects: STR })),
    experience: ARR(OBJ({ post: STR, organisation: STR, from: STR, to: STR })),
    skills: ARR(STR),
    hobbies: ARR(STR)
  })
};

/* --------------------------------------------------------------- prompts */
const GROUND = 'Use ONLY facts present in the resume. Never invent employers, titles, dates, degrees, metrics, tools or achievements. Where a number would clearly help but is missing, write [X] for the candidate to fill in.';

const SYSTEM = {
  ats_check: 'You are a strict, consistent ATS (Applicant Tracking System) screener and a veteran technical recruiter. You grade resumes the same way every time against a fixed rubric, reward specific quantified achievements, and penalise vagueness, filler, unfinished placeholders and over-length. You respond only with the requested JSON.',
  linkedin: 'You are a LinkedIn profile strategist who has optimised thousands of profiles for recruiter search in India and globally. You write in a confident, human first-person voice, front-load keywords recruiters search for, and never exaggerate. ' + GROUND,
  interview: 'You are a senior hiring manager and interview coach. You predict the questions a real interviewer for this exact role would ask this exact candidate, and coach STAR answers built from the candidate\'s real experience. ' + GROUND,
  translate: 'You are a professional resume translator for Indian job markets. You produce natural, professional resumes in the target language (not word-for-word translation), using the register employers in that language actually use. You never add or remove facts.',
  biodata: 'You are a precise data-extraction assistant. You copy facts from a resume into a government-job biodata form exactly as written. If a field is not in the resume, return an empty string (or empty list). Never guess dates of birth, category, religion, parents\' names or addresses.'
};

function resumeBlock(i) {
  return 'RESUME' + (i.pageCount ? ' (printed length: ' + i.pageCount + ' page' + (i.pageCount > 1 ? 's' : '') + ')' : '') + ':\n"""\n' + i.resumeText + '\n"""';
}

const PROMPTS = {
  ats_check: (i) => [
    'Run a resume-only ATS readiness check (there is no job description).',
    i.targetRole ? 'The candidate is targeting: ' + i.targetRole + '.' : 'Infer the candidate\'s target role from the resume.',
    '',
    'Grade EACH area from 0 to 100 with a one-line note citing what you saw:',
    '- parseability: standard section headings, clean single-column text, full contact (email, phone, city, LinkedIn).',
    '- structure: clear Summary / Experience / Education / Skills sections in a sensible order, consistent dates.',
    '- impact: share of bullets with concrete numbers or outcomes. Bullets that are duties ("responsible for") score low. Each [X]-style placeholder is an unfinished bullet.',
    '- verbs: bullets start with strong, varied action verbs; concise; no first-person pronouns or filler.',
    '- skills: role-relevant hard skills are listed AND evidenced in the bullets.',
    '- experience: depth and progression of roles relative to the target role.',
    '- length: about 1 page under 5 years of experience; 2 pages acceptable for 10+ years; 3+ pages is a real problem.',
    '',
    'Calibration (apply strictly, be consistent): 35-55 weak or incomplete, 56-74 average, 75-84 good, 85-92 strong, 93+ exceptional and rare.',
    'Set has_achievement_bullets=false if the experience section has no real achievement bullets. Count placeholder_count = number of [X] / [N] style placeholders.',
    'strengths: 2-4 short points. fixes: 4-6 items ordered by impact; each "issue" quotes or names the exact problem and each "fix" is a concrete rewrite or action. ' + GROUND,
    'missing_keywords: up to 10 role-relevant skills or keywords that are commonly expected for the target role but absent from the resume.',
    'verdict: max 8 words. summary: 2 sentences.',
    '',
    resumeBlock(i)
  ].join('\n'),

  linkedin: (i) => [
    'Optimise this person\'s LinkedIn profile from their resume.',
    'The text below may be a resume OR an export of their current LinkedIn profile (sections like "Top Skills", "Summary", "Experience" with durations such as "2 years 3 months"). Treat either as their career facts; if it is a LinkedIn export, improve on what they already have rather than repeating it.',
    'Target role: ' + (i.targetRole || 'infer it from the resume') + '.' + (i.tone ? ' Preferred tone: ' + i.tone + '.' : ''),
    '',
    '- headlines: exactly 3 options, each max 220 characters, styles "Keyword-rich", "Value-led", "Story". Use the "Role | Specialism | Proof point" pattern where it fits.',
    '- about: first person, 1,300-2,000 characters. The first two lines must hook (they show before "see more"). Then 2-3 short paragraphs with real achievements and numbers from the resume, the keywords recruiters search for, and a closing line inviting contact. No emojis, no hashtags.',
    '- top_skills: 10 skills using LinkedIn\'s standard skill names, most important first.',
    '- experience: one entry per role in the resume (max 5), with a LinkedIn-style description of 3-5 short lines starting with action verbs.',
    '- featured_ideas: 3 concrete things to pin in the Featured section.',
    '- profile_tips: 5 specific, practical tips for this person (custom URL, banner, Open to Work settings, recommendations, etc.).',
    GROUND,
    '',
    resumeBlock(i)
  ].join('\n'),

  interview: (i) => [
    'Prepare this candidate for an interview.',
    i.jobPost ? 'JOB POST:\n"""\n' + i.jobPost + '\n"""' : 'Target role: ' + (i.targetRole || 'infer from the resume') + ' (no job post given; use typical requirements for this role).',
    '',
    'Produce exactly 12 questions a real interviewer for THIS role would ask THIS candidate:',
    '- 3 "Role & technical" questions drawn from the job requirements',
    '- 3 "Resume deep-dive" questions about specific projects, numbers or claims in their resume',
    '- 3 "Behavioural" questions (answer with STAR)',
    '- 2 "Situational" questions',
    '- 1 "HR" question (motivation, notice period or salary)',
    'For each: why_asked (1 sentence, what the interviewer is testing) and answer_outline (max 90 words, a STAR-style outline built from the candidate\'s REAL experience; use [X] where they must add a number).',
    'fit_summary: 2-3 sentences on where the candidate is strongest for this role and the main gaps. gaps_to_prepare: 3-5 things to brush up on. questions_to_ask: 4 smart questions the candidate can ask the interviewer.',
    'Use the role and company names from the job post if present, otherwise empty strings for company.',
    GROUND,
    '',
    resumeBlock(i)
  ].join('\n'),

  translate: (i) => [
    'Rewrite this resume in ' + (i.language || 'Hindi') + '.',
    '- Use natural, professional ' + (i.language || 'Hindi') + ' as used in job applications in India, not literal word-for-word translation.',
    '- Keep in English / Latin script: company and institution names, product and brand names, email, phone, URLs, and technical terms people search in English (e.g. Python, SQL, Excel, AWS, SEO).',
    '- Keep numbers, percentages and dates in Western digits (0-9).',
    '- Do not add, remove or exaggerate any fact. Keep every role, bullet, degree and skill.',
    '- section_titles: the standard section headings in ' + (i.language || 'Hindi') + '.',
    '- language: the language name written in that language (e.g. हिन्दी).',
    '',
    resumeBlock(i)
  ].join('\n'),

  biodata: (i) => [
    'Fill a government-job biodata from this resume. Copy values exactly as written. Leave anything not present as an empty string or empty list.',
    'education: list each qualification (e.g. 10th, 12th, Graduation, Post-Graduation) with board/university, year of passing, percentage/CGPA and main subjects when present.',
    'experience: each job with post (designation), organisation, from and to.',
    'objective: one short formal career objective sentence based only on the resume (no invented facts); empty if the resume has no work or education details.',
    '',
    resumeBlock(i)
  ].join('\n')
};

/* --------------------------------------------------------------- routing */
// full = background path (no time cap, best quality). fast = synchronous
// fallback that must finish in < 26s.
const MODELS = {
  ats_check: { full: ['claude-opus-5-5', null], fast: ['claude-sonnet-5-5', 'low'], fallback: 'claude-sonnet-4-6' },
  linkedin:  { full: ['claude-sonnet-5-5', null], fast: ['claude-sonnet-5-5', 'low'], fallback: 'claude-sonnet-4-6' },
  interview: { full: ['claude-sonnet-5-5', null], fast: ['claude-sonnet-5-5', 'low'], fallback: 'claude-sonnet-4-6' },
  translate: { full: ['claude-sonnet-5-5', 'medium'], fast: ['claude-haiku-5-5', 'low'], fallback: 'claude-haiku-4-5-20251001' },
  biodata:   { full: ['claude-haiku-5-5', 'low'], fast: ['claude-haiku-5-5', 'low'], fallback: 'claude-haiku-4-5-20251001' }
};
const TOOLS = Object.keys(MODELS);

function validate(tool, i) {
  if (!TOOLS.includes(tool)) return 'Unknown tool.';
  if (i.resumeText.length < 120) return 'Please upload your resume PDF or paste your resume text (it looks empty or too short).';
  if (tool === 'interview' && !i.jobPost && !i.targetRole) return 'Paste the job post (or at least the job title) so we can tailor the questions.';
  if (tool === 'translate' && !i.language) return 'Choose a language.';
  return null;
}

/* ----------------------------------------------------------- model call */
async function callAnthropic(body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, status: 500, error: 'ANTHROPIC_API_KEY not set' };
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: (j.error && j.error.message) || ('HTTP ' + r.status) };
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, status: 502, error: e && e.message };
  }
}

function extractJson(data) {
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  const t = (blocks.find((b) => b && b.type === 'text') || {}).text || '';
  try { return JSON.parse(t); } catch (e) {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return null;
}

async function runTool(tool, rawInput, mode) {
  const i = cleanInput(rawInput);
  const err = validate(tool, i);
  if (err) return { ok: false, status: 400, error: err };
  const cfg = MODELS[tool];
  const [model, effort] = mode === 'fast' ? cfg.fast : cfg.full;
  const body = {
    model,
    max_tokens: mode === 'fast' ? 7000 : 16000,
    system: SYSTEM[tool],
    messages: [{ role: 'user', content: PROMPTS[tool](i) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMAS[tool] } }
  };
  if (effort) body.output_config.effort = effort;

  let res = await callAnthropic(body);
  if (!res.ok) {
    // Known-good fallback: older model, no effort setting (Haiku 4.5 rejects it).
    console.error('[career] primary failed', tool, model, res.status, res.error);
    const fb = Object.assign({}, body, { model: cfg.fallback, output_config: { format: body.output_config.format } });
    res = await callAnthropic(fb);
  }
  if (!res.ok) return { ok: false, status: 502, error: 'The AI service is busy right now. Please try again in a moment.' };
  const stop = res.data.stop_reason;
  if (stop === 'refusal') return { ok: false, status: 422, error: 'We could not process this document. Please check it is a resume and try again.' };
  const json = extractJson(res.data);
  if (!json) return { ok: false, status: 502, error: stop === 'max_tokens' ? 'Your resume is very long; please trim it and try again.' : 'Could not read the AI response. Please try again.' };
  const result = tool === 'ats_check' ? finalizeAts(json, i) : json;
  if (tool === 'ats_check') await rcmd(['SET', atsKey(i), JSON.stringify(result), 'EX', String(60 * 60 * 24 * 30)]);
  return { ok: true, result, model: res.data.model || body.model };
}

/* ----------------------------------------- deterministic ATS score */
function clamp(n, lo, hi) { n = Number(n); if (!isFinite(n)) n = lo; return Math.max(lo, Math.min(hi, Math.round(n))); }
function finalizeAts(j, i) {
  const areas = j.areas || {};
  let sum = 0, wsum = 0;
  const breakdown = ATS_AREAS.map(([k, label, w]) => {
    const a = areas[k] || {};
    const s = clamp(a.score, 0, 100);
    sum += s * w; wsum += w;
    return { key: k, label, weight: w, score: s, note: String(a.note || '') };
  });
  let score = clamp(sum / (wsum || 1), 0, 100);
  const caps = [];
  const pages = i.pageCount || 0;
  if (pages >= 4) { score = Math.min(score, 62); caps.push('Over-length: ' + pages + ' pages caps the score at 62.'); }
  else if (pages === 3) { score = Math.min(score, 78); caps.push('3 pages caps the score at 78 — aim for 1-2 pages.'); }
  if (j.has_achievement_bullets === false) { score = Math.min(score, 45); caps.push('No achievement bullets caps the score at 45.'); }
  const ph = clamp(j.placeholder_count, 0, 99);
  if (ph > 0) { score = Math.max(0, score - Math.min(10, ph * 2)); caps.push(ph + ' unfinished placeholder' + (ph > 1 ? 's' : '') + ' ([X]) lower the score.'); }
  score = Math.min(score, 96); // nothing is perfect
  const band = score >= 93 ? 'Exceptional' : score >= 85 ? 'Strong' : score >= 75 ? 'Good' : score >= 56 ? 'Average' : 'Needs work';
  const fixes = (Array.isArray(j.fixes) ? j.fixes : []).map((f) => ({ priority: String(f.priority || 'medium').toLowerCase(), issue: String(f.issue || ''), fix: String(f.fix || '') }));
  const order = { high: 0, medium: 1, low: 2 };
  fixes.sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
  return {
    score, band, caps, breakdown,
    candidate_name: String(j.candidate_name || ''),
    target_role: String(j.target_role || i.targetRole || ''),
    years_experience: clamp(j.years_experience, 0, 60),
    verdict: String(j.verdict || ''),
    summary: String(j.summary || ''),
    strengths: (j.strengths || []).map(String).slice(0, 4),
    fixes: fixes.slice(0, 6),
    missing_keywords: (j.missing_keywords || []).map(String).slice(0, 10),
    pages
  };
}

module.exports = { TOOLS, runTool, rateLimit, setJob, getJob, JOB_RE, finalizeAts, cleanInput, validate, SCHEMAS, PROMPTS, MODELS, cachedAts, atsKey };
