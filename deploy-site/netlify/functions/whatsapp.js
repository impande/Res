/* WhatsApp Resume Co-pilot — webhook (Meta WhatsApp Cloud API).
 *
 * Builds a resume one reply at a time, in the gaps of someone's day: the bot asks
 * ONE question, the user sends ONE answer, Claude polishes it into resume-grade
 * wording, and the draft assembles in the background. At the end it hands back a
 * link to finish/download on resume4u.help.
 *
 * STATUS: reference scaffold. It is inert until you connect WhatsApp (env vars
 * below). Conversation state uses Upstash Redis (same provider the app already
 * uses); without it, state falls back to in-memory and resets on cold start —
 * fine for a smoke test, not for production.
 *
 * Required env vars (Netlify → Site settings → Environment):
 *   WHATSAPP_TOKEN            - permanent access token from Meta
 *   WHATSAPP_PHONE_NUMBER_ID  - the sending number's ID
 *   WHATSAPP_VERIFY_TOKEN     - any secret string; also paste it in Meta webhook setup
 *   ANTHROPIC_API_KEY         - reused for the AI polish
 *   UPSTASH_REDIS_REST_URL    - (recommended) for durable conversation state
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Meta setup: create a WhatsApp app, add this function's URL as the webhook
 * callback (field: "messages"), use WHATSAPP_VERIFY_TOKEN as the verify token.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
// Base URL for the finish link. Derive it from the host the webhook was called
// on, so the ?r= loader that handles the handoff is always on the SAME deploy as
// this function: a UAT branch-deploy keeps the link on UAT, production keeps it
// on prod. Netlify's CONTEXT/DEPLOY_PRIME_URL aren't reliably in the function
// runtime, but the request host always is.
function siteBase(event) {
  var h = '';
  try { h = (event && event.headers && (event.headers.host || event.headers.Host)) || ''; } catch (e) {}
  if (h === 'resume4help.netlify.app') return 'https://resume4u.help'; // canonical prod domain
  if (h) return 'https://' + h;
  return process.env.R4U_SITE_URL || 'https://resume4u.help';
}
const _mem = {};        // in-memory fallback conversation state (per warm instance)
const _memProfile = {}; // in-memory fallback saved resume (per warm instance)

/* ---- durable state (Upstash Redis REST, optional) ---- */
async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  // Fail soft: if the REST call can't be made (wrong URL, Upstash down), fall
  // back to in-memory state instead of throwing and breaking the whole handler.
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/' + cmd.map(encodeURIComponent).join('/'), {
      headers: { Authorization: 'Bearer ' + tok }
    });
    const j = await r.json().catch(() => ({}));
    return j && j.result;
  } catch (e) {
    console.error('[whatsapp] redis fetch failed:', e && e.message);
    return null;
  }
}
async function getState(from) {
  const v = await redis(['GET', 'wa:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return _mem[from] || { step: 0, mode: 'idle', data: { experiences: [] } };
}
async function setState(from, state) {
  _mem[from] = state;
  await redis(['SET', 'wa:' + from, JSON.stringify(state), 'EX', '86400']); // 24h TTL
}
// A finished resume, remembered per phone number so returning users can edit it.
async function getProfile(from) {
  const v = await redis(['GET', 'profile:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return _memProfile[from] || null;
}
async function setProfile(from, data) {
  _memProfile[from] = data;
  await redis(['SET', 'profile:' + from, JSON.stringify(data), 'EX', '7776000']); // 90 days
}

/* ---- Support tickets (one number serves the bot AND human support) ----
   A support conversation is stored at ticket:<from> and the open ones are tracked
   in the set tickets:open, so the owner can read/reply from the admin page. */
async function getTicket(from) {
  const v = await redis(['GET', 'ticket:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return null;
}
async function appendTicket(from, who, text, name) {
  let t = await getTicket(from);
  if (!t) t = { from: from, name: name || '', status: 'open', messages: [], createdAt: Date.now() };
  if (name && !t.name) t.name = name;
  t.status = 'open';
  t.messages.push({ who: who, text: text, ts: Date.now() });
  if (t.messages.length > 100) t.messages = t.messages.slice(-100);
  t.updatedAt = Date.now();
  await redis(['SET', 'ticket:' + from, JSON.stringify(t), 'EX', '2592000']); // 30 days
  await redis(['SADD', 'tickets:open', from]);
  return t;
}

/* ---- the conversation script ---- */
// Each step: a question to send, and how to store the user's answer.
const STEPS = [
  { ask: "Hi! 👋 I'm your Resume4U co-pilot. I'll build your resume one quick question at a time — reply whenever you get a minute.\n\n📄 Already have a resume? Just send it here as a PDF (or a clear photo) and I'll import it.\n\nOtherwise, let's start: what's your full name?",
    save: (d, t) => { d.name = t; } },
  { ask: (d) => `Nice to meet you, ${firstName(d.name)}! What role are you aiming for? (e.g. "Backend Developer")`,
    save: (d, t) => { d.role = t; } },
  { ask: "How many years of experience do you have? (a number is fine — 0 for fresher)",
    save: (d, t) => { d.years = t; } },
  { ask: "What's your most recent job title and company? (e.g. \"Analyst at Infosys\")",
    save: (d, t) => { d.lastRole = t; } },
  { ask: "In one message, tell me 1–3 things you actually did or achieved there — plain words are fine, I'll sharpen them. 💪",
    save: async (d, t) => { d.experiences.push({ role: d.lastRole, bullets: await polishBullets(t, d.role) }); } },
  { ask: "Your highest qualification + institute? (e.g. \"B.Tech, IIT Delhi, 2024\")",
    save: (d, t) => { d.education = t; } },
  { ask: "Finally — list your key skills, comma-separated. (e.g. \"Python, SQL, React\")",
    save: (d, t) => { d.skills = t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean); } }
];

function firstName(n) { return (n || '').trim().split(/\s+/)[0] || 'there'; }

/* ---- AI polish (Anthropic) ---- */
async function claude(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens || 400, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json().catch(() => ({}));
  const c = j && j.content;
  return (Array.isArray(c) ? (c[0] && c[0].text) || '' : '').trim();
}
async function polishBullets(raw, role) {
  const out = await claude(
    `Turn the candidate's plain-language notes into 1-3 strong resume bullet points for a "${role || 'professional'}" role. ` +
    `Start each with a strong verb, keep each under 22 words, don't invent numbers they didn't give (use [X]% / [N]+ placeholders where a metric would help). ` +
    `Output ONLY the bullets, one per line, no preamble.\n\nNOTES: ${raw}`, 400
  );
  return out ? out.split('\n').map((s) => s.replace(/^[-•\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3)
             : [raw];
}

/* ---- import an existing resume (PDF or photo) via Claude ---- */
async function fetchMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token || !mediaId) return null;
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: 'Bearer ' + token } });
  const mj = await meta.json().catch(() => ({}));
  if (!mj || !mj.url) return null;
  const bin = await fetch(mj.url, { headers: { Authorization: 'Bearer ' + token } });
  if (!bin.ok) return null;
  const buf = Buffer.from(await bin.arrayBuffer());
  return { base64: buf.toString('base64'), mime: mj.mime_type || 'application/pdf' };
}
async function claudeExtractResume(base64, mime) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !base64) return null;
  const isPdf = /pdf/i.test(mime || '');
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: base64 } };
  const instruction = { type: 'text', text:
    'Extract this resume into STRICT JSON with exactly these keys and nothing else: ' +
    '{"name":"","role":"","years":"","education":"","skills":[],"experiences":[{"role":"","bullets":[]}]}. ' +
    'role = the person\'s current or target job title. years = total years of experience as a short string. ' +
    'experiences: one object per job (most recent first), role = "Title at Company", bullets = 2-4 concise achievement bullets keeping the resume\'s own wording. ' +
    'skills = flat array of individual skills. Use "" or [] where unknown. Output ONLY the JSON object — no markdown, no preamble.' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: [fileBlock, instruction] }] })
  });
  const j = await r.json().catch(() => ({}));
  const c = j && j.content;
  let txt = (Array.isArray(c) ? (c[0] && c[0].text) || '' : '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[0]);
    if (!Array.isArray(data.experiences)) data.experiences = [];
    if (!Array.isArray(data.skills)) data.skills = [];
    return data;
  } catch (e) { return null; }
}

/* ---- a short human summary of the collected resume ---- */
function summarize(d) {
  const parts = [];
  if (d.name) parts.push('👤 ' + d.name);
  if (d.role) parts.push('🎯 ' + d.role);
  if (d.years) parts.push('🕒 ' + d.years + ' yrs experience');
  if (Array.isArray(d.experiences) && d.experiences.length) parts.push('💼 ' + d.experiences.length + ' role(s)');
  if (Array.isArray(d.skills) && d.skills.length) parts.push('🛠️ ' + d.skills.slice(0, 8).join(', ') + (d.skills.length > 8 ? '…' : ''));
  if (d.education) parts.push('🎓 ' + d.education);
  return parts.join('\n') || '(nothing captured yet)';
}

/* ---- apply a plain-language edit command to the resume data ---- */
/* Parse an "add experience" value into {title, co, header, bullets}. A " — " (or
   " - ") separates the role header from the achievement bullets. With NO separator
   the whole thing is the header ("Senior PM at Bajaj Finserv") and there are no
   bullets — so a role+company never lands in the bullets field. */
function parseExp(raw) {
  let body = (raw || '').trim(), header = body, bulletsText = '';
  const parts = body.split(/\s[-–—]\s/);
  if (parts.length > 1) { header = parts[0].trim(); bulletsText = parts.slice(1).join(' - '); }
  let title = header, co = '';
  const at = header.split(/\s+at\s+/i);
  if (at.length > 1) { title = at[0].trim(); co = at.slice(1).join(' at ').trim(); }
  const bullets = bulletsText ? bulletsText.split(/[\n;]/).map((s) => s.replace(/^[-•\s]+/, '').trim()).filter(Boolean) : [];
  return { title: title, co: co, header: header, bullets: bullets };
}

/* ---- experience-bullet helpers (shape-aware) ---- */
function expsOf(d, isWeb) { if (isWeb) { if (!Array.isArray(d.experience)) d.experience = []; return d.experience; } if (!Array.isArray(d.experiences)) d.experiences = []; return d.experiences; }
function roleLabel(e, isWeb) { if (!e) return '(role)'; if (isWeb) return (e.title || '(untitled role)') + (e.co ? (' at ' + e.co) : ''); return e.role || '(untitled role)'; }
function roleDetail(e, isWeb) { const bl = ((e && e.bullets) || []).map((b) => '• ' + b).join('\n'); return roleLabel(e, isWeb) + (bl ? ('\n' + bl) : ''); }
function eduLabel(e) { return [e && e.deg, e && e.sch, e && e.yr].filter(Boolean).join(', ') || '(education entry)'; }
function awardLabel(a) { return [a && a.name, a && a.org, a && a.year].filter(Boolean).join(', ') || '(award)'; }
function achLabel(k) { return (k && (k.title || k.desc)) || '(achievement)'; }
function addBulletTo(d, isWeb, idx, text) {
  const exps = expsOf(d, isWeb); const e = exps[idx]; if (!e) return null;
  if (!Array.isArray(e.bullets)) e.bullets = [];
  e.bullets.push(text); if (isWeb) e.desc = e.bullets.join('\n');
  return roleLabel(e, isWeb);
}
/* Strip a trailing "… -> add this to my latest experience" style instruction the
   user may append to the bullet text itself. */
function cleanBullet(s) { return (s || '').replace(/\s*[-–—]*>?\s*(add (this|it)|put (this|it)|to my)\b.*$/i, '').replace(/[-–—>\s]+$/, '').trim() || (s || '').trim(); }

/* "B.Tech, IIT Delhi, 2024" → {deg, sch, yr}. Year = a trailing 4-digit token. */
function parseEdu(raw) {
  const parts = (raw || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  let yr = '';
  if (parts.length && /^(19|20)\d{2}$/.test(parts[parts.length - 1])) yr = parts.pop();
  const deg = parts.shift() || '';
  const sch = parts.join(', ');
  return { deg: deg, sch: sch, yr: yr, gpa: '' };
}
/* "Best Employee, Acme, 2023" → {name, org, year}. */
function parseAward(raw) {
  const parts = (raw || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  let year = '';
  if (parts.length && /^(19|20)\d{2}$/.test(parts[parts.length - 1])) year = parts.pop();
  const name = parts.shift() || '';
  const org = parts.join(', ');
  return { name: name, org: org, year: year, desc: '' };
}
/* "Title — details" → {title, desc}; no separator → whole thing is the title. */
function parseAch(raw) {
  const m = (raw || '').trim().match(/^(.*?)\s*(?:[-–—:|]|\bis\b)\s+(.+)$/);
  if (m) return { title: m[1].trim(), desc: m[2].trim() };
  return { title: (raw || '').trim(), desc: '' };
}
/* "Jan 2020 - Present" / "2020 to 2024" → {start, end}. */
function parseDates(raw) {
  const parts = (raw || '').split(/\s*(?:[-–—]|to|until|till|—)\s*/i).map((s) => s.trim()).filter(Boolean);
  return { start: parts[0] || '', end: parts[1] || '' };
}

function applyEdit(d, text) {
  const t = (text || '').trim();
  let m;
  if (!Array.isArray(d.skills)) d.skills = [];
  if (!Array.isArray(d.experiences)) d.experiences = [];
  if ((m = t.match(/^name\s*[:=]\s*(.+)$/is))) { d.name = m[1].trim(); return 'name'; }
  if ((m = t.match(/^(?:role|title|target)\s*[:=]\s*(.+)$/is))) { d.role = m[1].trim(); return 'role'; }
  if ((m = t.match(/^(?:years|experience|exp)\s*[:=]\s*(.+)$/is))) { d.years = m[1].trim(); return 'years'; }
  if ((m = t.match(/^(?:education|qualification|degree)\s*[:=]\s*(.+)$/is))) { d.education = m[1].trim(); return 'education'; }
  if ((m = t.match(/^add\s+skills?\s*[:=]\s*(.+)$/is))) { d.skills = d.skills.concat(m[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean)); return 'skills'; }
  if ((m = t.match(/^skills?\s*[:=]\s*(.+)$/is))) { d.skills = m[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean); return 'skills'; }
  if ((m = t.match(/^add\s+(?:experience|job|role|position)\s*[:=]\s*(.+)$/is))) {
    const p = parseExp(m[1]);
    d.experiences.push({ role: p.header, bullets: p.bullets });
    return 'experience';
  }
  return null;
}

/* ---- cloud-shape (web account) summary + edit: a linked user's saved resume is
   kept in the full builder shape so nothing is flattened on the round-trip. ---- */
function summarizeCloud(d) {
  const parts = [];
  const nm = ((d.firstName || '') + ' ' + (d.lastName || '')).trim();
  if (nm) parts.push('👤 ' + nm);
  if (d.jobTitle) parts.push('🎯 ' + d.jobTitle);
  if (Array.isArray(d.experience) && d.experience.length) parts.push('💼 ' + d.experience.length + ' role(s)');
  if (Array.isArray(d.skills) && d.skills.length) parts.push('🛠️ ' + d.skills.slice(0, 8).join(', ') + (d.skills.length > 8 ? '…' : ''));
  if (Array.isArray(d.education) && d.education.length) { const e0 = d.education[0] || {}; const ed = [e0.deg, e0.sch].filter(Boolean).join(', '); if (ed) parts.push('🎓 ' + ed); }
  return parts.join('\n') || '(your saved resume)';
}
function applyEditCloud(d, text) {
  const t = (text || '').trim(); let m;
  if (!Array.isArray(d.skills)) d.skills = [];
  if (!Array.isArray(d.experience)) d.experience = [];
  const syncDesc = () => { d.experience.forEach((e) => { if (Array.isArray(e.bullets)) e.desc = e.bullets.join('\n'); }); };
  if ((m = t.match(/^name\s*[:=]\s*(.+)$/is))) { const sp = m[1].trim().split(/\s+/); d.firstName = sp.shift() || ''; d.lastName = sp.join(' '); return 'name'; }
  if ((m = t.match(/^(?:role|title|target)\s*[:=]\s*(.+)$/is))) { d.jobTitle = m[1].trim(); return 'role'; }
  if ((m = t.match(/^summary\s*[:=]\s*(.+)$/is))) { d.summary = m[1].trim(); return 'summary'; }
  if ((m = t.match(/^add\s+skills?\s*[:=]\s*(.+)$/is))) { d.skills = d.skills.concat(m[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean)); return 'skills'; }
  if ((m = t.match(/^skills?\s*[:=]\s*(.+)$/is))) { d.skills = m[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean); return 'skills'; }
  if ((m = t.match(/^add\s+bullet\s*[:=]\s*(.+)$/is))) {
    if (!d.experience.length) d.experience.push({ title: d.jobTitle || '', co: '', start: '', end: '', bullets: [] });
    const tgt = d.experience[0]; if (!Array.isArray(tgt.bullets)) tgt.bullets = [];
    tgt.bullets.push(m[1].trim()); syncDesc(); return 'bullet';
  }
  if ((m = t.match(/^add\s+(?:experience|job|role|position)\s*[:=]\s*(.+)$/is))) {
    const p = parseExp(m[1]);
    d.experience.unshift({ title: p.title, co: p.co, start: '', end: '', bullets: p.bullets, desc: p.bullets.join('\n') });
    return 'experience';
  }
  // ---- contact details ----
  if ((m = t.match(/^e-?mail\s*[:=]\s*(.+)$/is))) { d.email = m[1].trim(); return 'email'; }
  if ((m = t.match(/^(?:phone|mobile|contact\s*number)\s*[:=]\s*(.+)$/is))) { d.phone = m[1].trim(); return 'phone'; }
  if ((m = t.match(/^(?:location|city|address)\s*[:=]\s*(.+)$/is))) { d.location = m[1].trim(); return 'location'; }
  if ((m = t.match(/^linked-?in\s*[:=]\s*(.+)$/is))) { d.linkedin = m[1].trim(); return 'LinkedIn'; }
  if ((m = t.match(/^git-?hub\s*[:=]\s*(.+)$/is))) { d.github = m[1].trim(); return 'GitHub'; }
  // ---- education ----
  if ((m = t.match(/^add\s+(?:education|qualification|degree)\s*[:=]\s*(.+)$/is))) {
    if (!Array.isArray(d.education)) d.education = [];
    d.education.push(parseEdu(m[1])); return 'education';
  }
  // ---- award ----
  if ((m = t.match(/^add\s+award\s*[:=]\s*(.+)$/is))) {
    if (!Array.isArray(d.awards)) d.awards = [];
    d.awards.push(parseAward(m[1])); return 'award';
  }
  // ---- key achievement ----
  if ((m = t.match(/^add\s+(?:key\s+)?(?:achievement|highlight)\s*[:=]\s*(.+)$/is))) {
    if (!Array.isArray(d.keyAchievements)) d.keyAchievements = [];
    d.keyAchievements.push(parseAch(m[1])); return 'key achievement';
  }
  // ---- remove a skill ----
  if ((m = t.match(/^(?:remove|delete|drop)\s+skills?\s*[:=]\s*(.+)$/is))) {
    const target = m[1].trim().toLowerCase();
    const before = d.skills.length;
    d.skills = d.skills.filter((s) => String(s).trim().toLowerCase() !== target);
    return d.skills.length < before ? 'skills' : null;
  }
  return null;
}

/* ---- finish: stash the resume, remember it, hand back the finish link ---- */
async function finishAndLink(from, data, base) {
  const isWeb = data && data._src === 'web';
  const vid = (data && data._vid) ? String(data._vid) : null;      // the saved-version this edit belongs to
  const vlabel = (data && data._vlabel) ? String(data._vlabel) : null;
  let store = data;
  if (isWeb) { store = Object.assign({}, data); delete store._src; delete store._vid; delete store._vlabel; } // strip internal flags for the web loader
  const token = Math.random().toString(36).slice(2, 10);
  await redis(['SET', 'resume:' + token, JSON.stringify(store), 'EX', '604800']); // 7 days for the web loader
  await setProfile(from, data); // remember this person so they can edit later
  // Apply-on-next-web-visit: for a LINKED account edit, also stash the result at
  // wapending:<uid> so the signed-in website can detect it next time it loads and
  // offer to apply + save — the reliable path when WhatsApp's in-app browser
  // can't complete Google sign-in.
  if (isWeb) {
    try {
      const uid = await redis(['GET', 'wamap:' + from]);
      if (uid) await redis(['SET', 'wapending:' + uid, JSON.stringify({ resume: store, versionId: vid, versionLabel: vlabel, ts: Date.now() }), 'EX', '604800']);
    } catch (e) {}
  }
  await setState(from, { step: 0, mode: 'idle', data: { experiences: [] } });
  const nm = isWeb ? ((data.firstName || '').trim() || 'there') : firstName(data.name);
  await send(from,
    `🎉 All set, ${nm}! Your resume is ready.\n\n` +
    `👉 Finish & download (free): ${base || 'https://resume4u.help'}/?r=${token}\n\n` +
    (isWeb
      ? `Open it to review — or just open resume4u.help on your usual browser and it’ll ask to apply this change to your saved resume.\n\n`
      : `Open it to review your change, pick a template, and download — or download as PDF.\n\n`) +
    `Reply "edit" to change something else, or "new" to build another.`);
}

/* ---- WhatsApp send ---- */
async function send(to, text) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) { console.log('[whatsapp] NOT SENT — missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID. Would send to', to, ':', text); return; }
  const resp = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
  if (!resp.ok) {
    let body = ''; try { body = await resp.text(); } catch (e) {}
    console.error('[whatsapp] SEND FAILED', resp.status, body); // e.g. recipient not in allowed list, or token expired
  } else {
    console.log('[whatsapp] sent ok to', to);
  }
}

/* ---- main handler ---- */
exports.handler = async (event) => {
  // 1) Webhook verification (Meta calls this once with GET)
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    // One-time admin helpers, all guarded by the verify token so only the owner
    // can trigger them. The WABA id can come from ?waba=<id> (highest priority),
    // the WHATSAPP_WABA_ID env var, or the hardcoded fallback.
    const _admin = q.admin && q.key === process.env.WHATSAPP_VERIFY_TOKEN;
    // ?token=<override> lets a one-time admin call use a different token (e.g. the
    // Step-1 temporary token, which has full permission over the test WABA) when
    // the stored System User token can't manage the WhatsApp Business Account.
    const _tok = q.token || process.env.WHATSAPP_TOKEN || '';
    const wabaId = q.waba || process.env.WHATSAPP_WABA_ID || '2356692575145331';

    // whoami: ask Meta what this token can see. debug_token lists granular
    // scopes with target_ids, which include the WhatsApp Business Account id(s)
    // the token is allowed to act on — that's the id to use for ?waba=.
    if (_admin && q.admin === 'whoami') {
      try {
        const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(_tok)}&access_token=${encodeURIComponent(_tok)}`);
        return { statusCode: 200, body: 'debug_token ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'whoami error: ' + (e && e.message) };
      }
    }

    // wabas: discover the WhatsApp Business Account id via the Business API
    // (me/businesses -> owned/client WABAs). Fallback when the id isn't handy.
    if (_admin && q.admin === 'wabas') {
      try {
        let out = '';
        const biz = await fetch(`${GRAPH}/me/businesses?access_token=${encodeURIComponent(_tok)}`);
        const bizBody = await biz.text().catch(() => '');
        out += 'me/businesses ' + biz.status + ': ' + bizBody + '\n\n';
        try {
          const bj = JSON.parse(bizBody);
          const bid = bj && bj.data && bj.data[0] && bj.data[0].id;
          if (bid) {
            const owned = await fetch(`${GRAPH}/${bid}/owned_whatsapp_business_accounts?access_token=${encodeURIComponent(_tok)}`);
            out += 'owned_wabas ' + owned.status + ': ' + (await owned.text().catch(() => '')) + '\n\n';
            const client = await fetch(`${GRAPH}/${bid}/client_whatsapp_business_accounts?access_token=${encodeURIComponent(_tok)}`);
            out += 'client_wabas ' + client.status + ': ' + (await client.text().catch(() => ''));
          }
        } catch (e) { out += 'parse: ' + (e && e.message); }
        return { statusCode: 200, body: out };
      } catch (e) {
        return { statusCode: 200, body: 'wabas error: ' + (e && e.message) };
      }
    }

    // selftest: report which env vars are present (booleans, no secret values)
    // and whether the Upstash Redis state store round-trips. Used to diagnose the
    // "Oops — something hiccuped" path, which means the handler threw.
    if (_admin && q.admin === 'selftest') {
      const env = {
        WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
        WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN
      };
      let redisResult;
      try {
        const setr = await redis(['SET', 'wa:selftest', 'ok', 'EX', '60']);
        const getr = await redis(['GET', 'wa:selftest']);
        redisResult = 'set=' + JSON.stringify(setr) + ' get=' + JSON.stringify(getr);
      } catch (e) { redisResult = 'ERROR: ' + (e && e.message); }
      let aiResult;
      try {
        const a = await claude('Reply with the single word OK.', 10);
        aiResult = JSON.stringify(a);
      } catch (e) { aiResult = 'ERROR: ' + (e && e.message); }
      return { statusCode: 200, body: 'selftest env=' + JSON.stringify(env) + ' | redis=' + redisResult + ' | ai=' + aiResult };
    }

    // grant: assign a (system) user to the WABA with a task permission, so a
    // System User token can finally send/manage. Run with ?token=<a token that
    // already owns the WABA, e.g. the Step-1 temp token>. ?su=<user id> defaults
    // to the resume4u-whatsapp-bot system user; ?tasks= defaults to MANAGE.
    if (_admin && q.admin === 'grant') {
      const su = q.su || '61595837001313';
      const tasks = q.tasks || 'MANAGE';
      try {
        const url = `${GRAPH}/${wabaId}/assigned_users?user=${encodeURIComponent(su)}` +
          `&tasks=${encodeURIComponent('["' + tasks + '"]')}&access_token=${encodeURIComponent(_tok)}`;
        const r = await fetch(url, { method: 'POST' });
        return { statusCode: 200, body: 'grant (waba ' + wabaId + ' user ' + su + ' tasks ' + tasks + ') status ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'grant error: ' + (e && e.message) };
      }
    }

    // testsend: reproduce the bot's outbound reply (same token + phone-number id
    // the real send() uses) and return Meta's raw response, so a failing reply
    // shows its actual error. ?to=<intl number, no +>, optional ?pn= / ?token=.
    if (_admin && q.admin === 'testsend') {
      const phoneId = q.pn || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
      const to = q.to || '';
      try {
        const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + _tok, 'content-type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'Test from Resume4U co-pilot ✅' } })
        });
        return { statusCode: 200, body: 'testsend (pn ' + phoneId + ' to ' + to + ') status ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'testsend error: ' + (e && e.message) };
      }
    }

    // subscribe THIS app to the WhatsApp Business Account's webhooks
    // (POST /<WABA_ID>/subscribed_apps). This is the step that makes Meta route
    // the number's inbound messages to this webhook.
    if (_admin && q.admin === 'subscribe') {
      try {
        const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + _tok }
        });
        const body = await r.text().catch(() => '');
        return { statusCode: 200, body: 'subscribe_apps (waba ' + wabaId + ') status ' + r.status + ': ' + body };
      } catch (e) {
        return { statusCode: 200, body: 'subscribe_apps error: ' + (e && e.message) };
      }
    }
    // Let us read the current subscription from the browser too.
    if (_admin && q.admin === 'check') {
      try {
        const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          headers: { Authorization: 'Bearer ' + _tok }
        });
        return { statusCode: 200, body: 'subscribed_apps (waba ' + wabaId + ') GET ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'check error: ' + (e && e.message) };
      }
    }
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return { statusCode: 200, body: q['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'forbidden' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };

  // 2) Incoming message
  let msg;
  try {
    const body = JSON.parse(event.body || '{}');
    const v = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value;
    msg = v && v.messages && v.messages[0];
  } catch (e) { return { statusCode: 200, body: 'ok' }; } // always 200 so Meta doesn't retry-storm
  if (!msg) return { statusCode: 200, body: 'ok' };

  const from = msg.from;
  const type = msg.type;
  const text = (msg.text && msg.text.body || '').trim();
  const low = text.toLowerCase();
  console.log('[whatsapp] inbound from', from, 'type', type, ':', JSON.stringify(text));
  const base = siteBase(event); // finish link lives on the same deploy as this webhook

  const MENU = 'Reply with a number:\n1️⃣  Edit my saved resume\n2️⃣  Start a fresh one\n3️⃣  Import a PDF (just send it here)';

  try {
    let state = await getState(from);
    if (!state.data) state.data = { experiences: [] };
    if (!state.mode) state.mode = state.step > 0 ? 'build' : 'idle'; // migrate older states

    // ---- Document / photo upload: import an existing resume (any time) ----
    if (type === 'document' || type === 'image') {
      const mediaId = (msg.document && msg.document.id) || (msg.image && msg.image.id);
      await send(from, '📄 Got it — reading your resume now, give me a few seconds…');
      const media = mediaId ? await fetchMedia(mediaId) : null;
      const data = media ? await claudeExtractResume(media.base64, media.mime) : null;
      if (!data || (!data.name && !(data.experiences || []).length && !(data.skills || []).length)) {
        await send(from, "I couldn't read that one, sorry. Send a PDF (or a clear photo) of your resume and I'll try again — or reply \"new\" to build from scratch.");
        return { statusCode: 200, body: 'ok' };
      }
      await setProfile(from, data);
      await setState(from, { step: 0, mode: 'review', data });
      await send(from, '✅ Imported your resume!\n\n' + summarize(data) +
        '\n\nReply "link" to get your polished resume, or tell me what to change — e.g.\n• role: Data Analyst\n• add skill: Python, SQL\n• years: 6');
      return { statusCode: 200, body: 'ok' };
    }

    if (type !== 'text') return { statusCode: 200, body: 'ok' };

    // ---- Support mode (sticky): the user reached a human-support chat. Route every
    //      message to the ticket (the owner reads/replies from the admin page) until
    //      they explicitly exit or the owner resolves. No resume processing here. ----
    if (state.mode === 'support') {
      // Explicit exit → back to the bot with a confirmation.
      if (/^(exit|end|close|stop|cancel|leave|back|done)(\s+(support|chat|help|this))?$|^(menu|resume builder)$/i.test(low)) {
        await setState(from, { step: 0, mode: 'idle', data: state.data || { experiences: [] } });
        await send(from, "👍 Closed the support chat. Message anytime to build or edit your resume — or say \"support\" to reach our team again.");
        return { statusCode: 200, body: 'ok' };
      }
      // "I want the bot now" — a build / edit / new / versions request (incl. the
      // Build CTA) leaves support and is handled by the normal flow below.
      const wantsBot = /\b(build|make|create|start)\s+(a\s+|an\s+|my\s+)?(new\s+)?(resume|r[eé]sum[eé]|cv)\b/i.test(low)
        || /^(new|restart|reset|start over|build new|fresh|edit|edit resume|update resume|versions?|my resumes?|switch resume)$/i.test(low);
      if (!wantsBot) {
        const _pf = await getProfile(from);
        await appendTicket(from, 'user', text, _pf && (_pf.name || _pf.firstName));
        return { statusCode: 200, body: 'ok' };   // silent — a human replies from the desk
      }
      // leaving support → clear the marker and fall through to the normal handlers
      state = { step: 0, mode: 'idle', data: state.data || { experiences: [] } };
    }

    // ---- Global intents: understood in ANY mode, so a command is never
    //      swallowed as the answer to a build question (the old bot only caught
    //      restart/menu, so "link", "versions", "hi" got saved as answers).
    //      Matches are anchored (exact words) so real answers — a job title, a
    //      skill — are never hijacked. Works the same for linked ("logged-in")
    //      and brand-new ("logged-out") users. ----
    const OK = { statusCode: 200, body: 'ok' };
    const haveData = (d) => !!(d && (d.name || d.firstName || (d.experiences || []).length || (d.experience || []).length));
    const linkedUid = await redis(['GET', 'wamap:' + from]);
    // Freshest saved resume for this chat: a linked account's LATEST web resume
    // (so edits act on the current version), else the resume stored for this phone.
    const savedResume = async () => {
      let p = await getProfile(from);
      if (linkedUid) {
        try {
          const wr = await redis(['GET', 'webresume:' + linkedUid]);
          const web = wr ? JSON.parse(wr) : null;
          if (web && (web.firstName || web.jobTitle || (web.experience || []).length)) { web._src = 'web'; await setProfile(from, web); p = web; }
        } catch (e) {}
      }
      return p;
    };

    // Greeting → friendly menu (even mid-build, so "hi" isn't taken as an answer)
    if (/^(hi+|hey+|hello+|yo|hola|namaste|hii+|start|get started)[.!\s]*$/i.test(low)) {
      const p = await getProfile(from); const pn = p && (p.name || p.firstName);
      await setState(from, { step: 0, mode: 'menu', data: state.data });
      await send(from, (pn ? 'Hi again, ' + firstName(pn) + '! 👋\n\n' : "Hi! 👋 I'm your Resume4U co-pilot.\n\n") + MENU);
      return OK;
    }
    // Menu / help
    if (/^(menu|help|options|commands|\?)$/i.test(low)) {
      const p = await getProfile(from); const pn = p && (p.name || p.firstName);
      await setState(from, { step: 0, mode: 'menu', data: state.data });
      await send(from, (pn ? 'Hi again, ' + firstName(pn) + '! ' : '') + MENU);
      return OK;
    }
    // Support / contact → connect to a human (enters sticky support mode + ticket).
    if (/^(support|contact\s*us?|customer\s*(support|care|service)|talk to (a\s+)?(human|person|agent|someone|team)|speak to (a\s+)?(human|person|agent)|raise (a\s+)?ticket|report (a|an) (issue|bug|problem)|get help|need help with)\b/i.test(low)) {
      const _pf = await getProfile(from);
      await setState(from, { step: 0, mode: 'support', data: state.data });
      await appendTicket(from, 'user', text, _pf && (_pf.name || _pf.firstName));
      await send(from, "🙋 You're connected to Resume4U support. Tell us what you need — a human from our team will reply right here.\n\n(Type \"exit\" anytime to go back to building your resume.)");
      return OK;
    }
    // Build CTA → start the resume flow right away (the "Build my resume on WhatsApp"
    // link lands here). Checked BEFORE "versions" because "my resume" would match it.
    if (/\b(build|make|create|start)\s+(a\s+|an\s+|my\s+)?(new\s+)?(resume|r[eé]sum[eé]|cv)\b/i.test(low)) {
      const prof = await getProfile(from);
      const pn = prof && (prof.name || prof.firstName);
      if (pn) {
        // returning user with a saved resume → build-focused choice (not the plain menu)
        await setState(from, { step: 0, mode: 'menu', data: state.data });
        await send(from, '👋 Welcome back, ' + firstName(pn) + "! Let's work on your resume.\n\nReply *edit* to update your saved one, or *new* to start fresh. (Or send a PDF to import a different resume.)");
        return OK;
      }
      // new user → kick off the build Q&A immediately
      const d = { experiences: [] };
      await setState(from, { step: 1, mode: 'build', data: d });
      await send(from, typeof STEPS[0].ask === 'function' ? STEPS[0].ask(d) : STEPS[0].ask);
      return OK;
    }
    // Finish & get link — wrap up the resume in progress (or the saved one).
    // "link <code>" (account linking) has its own handler below and won't match this.
    if (/^(link|get ?link|get my link|send( me)?( the)? link|my link|done|finished?|generate|get my resume|i'?m done)$/i.test(low)) {
      const data = haveData(state.data) ? state.data : await savedResume();
      if (haveData(data)) { await finishAndLink(from, data, base); }
      else { await send(from, "You haven't built a resume yet 🙂\n\nReply *new* to start — I'll ask a few quick questions — or send a PDF/photo of an existing resume and I'll import it."); }
      return OK;
    }
    // Versions — list the user's saved resumes to pick one to edit.
    if (/\b(versions?|my resumes?|other resumes?|saved resumes?|list( my)? resumes?|switch( resume)?)\b/i.test(low) || /share\s+(my\s+)?(resume|version)/i.test(low)) {
      let vers = null;
      if (linkedUid) { try { const vr = await redis(['GET', 'waversions:' + linkedUid]); vers = vr ? JSON.parse(vr) : null; } catch (e) {} }
      if (Array.isArray(vers) && vers.length) {
        const list = vers.slice(0, 9);
        const lines = list.map((v, i) => (i + 1) + '. ' + (v.label || ('Resume ' + (i + 1))));
        await setState(from, { step: 0, mode: 'pickversion', data: state.data, versions: list });
        await send(from, '🗂️ Your saved resumes:\n\n' + lines.join('\n') + '\n\nReply with a number to open & edit that one.');
        return OK;
      }
      const p = await savedResume();
      if (haveData(p)) {
        await setState(from, { step: 0, mode: 'edit', data: p });
        await send(from, "Here's your saved resume:\n\n" + (p._src === 'web' ? summarizeCloud(p) : summarize(p)) +
          '\n\nTell me what to change — e.g. "add skill: Figma" — or reply *link* to get it.');
        return OK;
      }
      await send(from, "I don't have any saved resumes for this number yet.\n\nReply *new* to build one by chat, or send a PDF/photo to import an existing resume.");
      return OK;
    }
    // New / fresh → start a build (falls through to the Q&A below)
    if (/^(new|new resume|restart|reset|start over|build new|fresh|from scratch|scratch)$/i.test(low)) {
      state = { step: 0, mode: 'build', data: { experiences: [] } };
    }
    // Edit → edit the saved resume
    else if (/^(edit|edit resume|change|update)$/i.test(low)) {
      const p = await savedResume();
      if (haveData(p)) {
        await setState(from, { step: 0, mode: 'edit', data: p });
        await send(from, 'Editing your resume.\n\n' + (p._src === 'web' ? summarizeCloud(p) : summarize(p)) +
          '\n\nTell me what to change — e.g. "add bullet: …", "add skill: Figma", "role: Product Manager". Reply *link* when done.');
      } else {
        await send(from, "I don't have a saved resume for you yet. Reply *new* to build one, or send a PDF to import.");
      }
      return OK;
    }

    // ---- Link a web account: user sends "LINK <code>" from the site ----
    const lm = low.match(/^link\s+([a-z0-9]{4,8})$/i);
    if (lm) {
      const code = lm[1].toUpperCase();
      const uid = await redis(['GET', 'walink:' + code]);
      if (!uid) {
        await send(from, "That link code didn't work (it may have expired). On resume4u.help, tap \"Connect WhatsApp\" again for a fresh code.");
        return { statusCode: 200, body: 'ok' };
      }
      await redis(['SET', 'wamap:' + from, uid, 'EX', '7776000']); // remember phone→account for 90 days
      await redis(['DEL', 'walink:' + code]);
      let web = null; const webRaw = await redis(['GET', 'webresume:' + uid]);
      try { web = webRaw ? JSON.parse(webRaw) : null; } catch (e) {}
      if (web && (web.firstName || web.jobTitle || (web.experience || []).length)) {
        web._src = 'web';
        await setProfile(from, web);
        await setState(from, { step: 0, mode: 'review', data: web });
        await send(from, '✅ Linked to your resume4u.help account!\n\n' + summarizeCloud(web) +
          '\n\nTell me what to change — e.g.\n• add bullet: Led the AWS migration, cutting costs [X]%\n• add skill: Kubernetes\n• role: Senior Product Manager\n\nReply "link" when done to get your updated resume.');
      } else {
        await send(from, "✅ Linked! But I couldn't find a saved resume on your account yet. Build or save one on resume4u.help, then message me again — or send a PDF to import one here.");
      }
      return { statusCode: 200, body: 'ok' };
    }

    // ---- Mode: pickversion (user replies with a number to open a saved version) ----
    if (state.mode === 'pickversion') {
      const vers = Array.isArray(state.versions) ? state.versions : [];
      const idx = parseInt((low.match(/\d+/) || [])[0], 10);
      if (idx >= 1 && idx <= vers.length) {
        const chosen = vers[idx - 1];
        const data = Object.assign({}, chosen.resume || chosen); data._src = 'web';
        // Remember WHICH saved version this is (Firestore doc id), so the edit is
        // written back to this exact version — not whatever is active on the web.
        if (chosen.id) data._vid = String(chosen.id);
        if (chosen.label) data._vlabel = String(chosen.label);
        await setProfile(from, data);
        await setState(from, { step: 0, mode: 'edit', data });
        await send(from, 'Editing "' + (chosen.label || ('Resume ' + idx)) + '".\n\n' + summarizeCloud(data) +
          '\n\nTell me what to change — e.g. "add skill: Figma". Reply "link" when done.');
        return { statusCode: 200, body: 'ok' };
      }
      await send(from, 'Reply with a number from the list (1–' + vers.length + '), or "menu" for options.');
      return { statusCode: 200, body: 'ok' };
    }

    // ---- Mode: menu (returning user picking an option) ----
    if (state.mode === 'menu') {
      if (/^1\b/.test(low) || /\bedit\b/i.test(low)) {
        const prof = await getProfile(from);
        if (prof) {
          const pWeb = prof._src === 'web';
          await setState(from, { step: 0, mode: 'edit', data: prof });
          await send(from, 'Editing your resume.\n\n' + (pWeb ? summarizeCloud(prof) : summarize(prof)) +
            '\n\nTell me what to change — e.g. "add bullet: …", "add skill: Figma", "role: Product Manager". Reply "link" when done.');
          return { statusCode: 200, body: 'ok' };
        }
        state = { step: 0, mode: 'build', data: { experiences: [] } }; // no saved resume → build
      } else if (/^2\b/.test(low) || /\b(fresh|new)\b/i.test(low)) {
        state = { step: 0, mode: 'build', data: { experiences: [] } };
      } else if (/^3\b/.test(low) || /\b(pdf|import|upload)\b/i.test(low)) {
        await setState(from, { step: 0, mode: 'review', data: { experiences: [] } });
        await send(from, '📎 Great — just send your resume as a PDF (or a clear photo) right here and I\'ll import it.');
        return { statusCode: 200, body: 'ok' };
      } else {
        await send(from, MENU);
        return { statusCode: 200, body: 'ok' };
      }
      // (option 1 w/o profile, or option 2) → state is now build; fall through
    }

    // ---- Mode: edit / review (tweak the current resume) ----
    if (state.mode === 'edit' || state.mode === 'review') {
      const isWeb = state.data && state.data._src === 'web';
      const applyFn = (t) => (isWeb ? applyEditCloud(state.data, t) : applyEdit(state.data, t));
      const summ = () => (isWeb ? summarizeCloud(state.data) : summarize(state.data));

      if (/^(link|done|finish|get link|generate|get my link)$/i.test(low)) {
        await finishAndLink(from, state.data, base);
        return OK;
      }
      if (/^edit$/i.test(low)) {
        await setState(from, { step: 0, mode: 'edit', data: state.data });
        await send(from, 'Sure — tell me what to change. Just say "add experience", "add bullet", "add skill", "role" or "summary" and I\'ll ask for the details. (Or do it in one line: "add skill: Python".) Reply "link" when done.');
        return OK;
      }

      // Conversational add: if we asked for a value last turn, THIS message is it.
      if (state.awaiting === 'bullet') {
        const bulletText = cleanBullet(text);
        const exps = expsOf(state.data, isWeb);
        if (exps.length > 1) {
          // Multiple roles → ask WHICH role the bullet belongs to.
          const list = exps.map((e, i) => (i + 1) + '. ' + roleLabel(e, isWeb)).join('\n');
          await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'bulletRole', pendingBullet: bulletText });
          await send(from, 'Which role should I add it to?\n\n' + list + '\n\nReply with the number.');
          return OK;
        }
        if (!exps.length) { if (isWeb) state.data.experience = [{ title: state.data.jobTitle || '', co: '', dates: '', bullets: [], desc: '' }]; else state.data.experiences = [{ role: '', bullets: [] }]; }
        const label = addBulletTo(state.data, isWeb, 0, bulletText);
        await setState(from, { step: 0, mode: 'edit', data: state.data });
        await send(from, '✅ Added to:\n' + roleDetail(expsOf(state.data, isWeb)[0], isWeb) + '\n\nAnything else? Or reply "link" to get your resume.');
        return OK;
      }
      if (state.awaiting === 'bulletRole') {
        const exps = expsOf(state.data, isWeb);
        const idx = parseInt((low.match(/\d+/) || [])[0], 10) - 1;
        if (idx >= 0 && idx < exps.length && state.pendingBullet) {
          addBulletTo(state.data, isWeb, idx, state.pendingBullet);
          await setState(from, { step: 0, mode: 'edit', data: state.data });
          await send(from, '✅ Added to:\n' + roleDetail(exps[idx], isWeb) + '\n\nAnything else? Or reply "link" to get your resume.');
          return OK;
        }
        await send(from, 'Reply with a number from the list (1–' + exps.length + '), or "menu" for options.');
        return OK;
      }
      // ---- set dates on a role ----
      if (state.awaiting === 'datesRole') {
        const exps = expsOf(state.data, isWeb);
        const idx = parseInt((low.match(/\d+/) || [])[0], 10) - 1;
        if (idx >= 0 && idx < exps.length) {
          await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'datesValue', pendingIdx: idx });
          await send(from, 'What dates for *' + roleLabel(exps[idx], isWeb) + '*?\n\nExample: *Jan 2020 - Present* (or *2019 - 2022*)');
          return OK;
        }
        await send(from, 'Reply with a number from the list (1–' + exps.length + ').'); return OK;
      }
      if (state.awaiting === 'datesValue') {
        const exps = expsOf(state.data, isWeb); const e = exps[state.pendingIdx];
        if (e) {
          const dt = parseDates(text);
          if (isWeb) { e.start = dt.start; e.end = dt.end; } else { e.dates = text.trim(); }
          await setState(from, { step: 0, mode: 'edit', data: state.data });   // save AFTER mutating
          await send(from, '✅ Dates set for *' + roleLabel(e, isWeb) + '*: ' + (dt.start || '?') + ' – ' + (dt.end || 'Present') + '\n\nAnything else? Or reply "link".');
        } else { await setState(from, { step: 0, mode: 'edit', data: state.data }); await send(from, "That role's gone — try again."); }
        return OK;
      }
      // ---- remove a bullet ----
      if (state.awaiting === 'rmBulletRole') {
        const exps = expsOf(state.data, isWeb);
        const idx = parseInt((low.match(/\d+/) || [])[0], 10) - 1; const e = exps[idx];
        if (e && (e.bullets || []).length) {
          const list = e.bullets.map((b, i) => (i + 1) + '. ' + b).join('\n');
          await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'rmBulletPick', pendingIdx: idx });
          await send(from, 'Which bullet should I remove from *' + roleLabel(e, isWeb) + '*?\n\n' + list + '\n\nReply with the number.');
          return OK;
        }
        await send(from, 'Reply with a number from the list.'); return OK;
      }
      if (state.awaiting === 'rmBulletPick') {
        const exps = expsOf(state.data, isWeb); const e = exps[state.pendingIdx];
        const bi = parseInt((low.match(/\d+/) || [])[0], 10) - 1;
        if (e && Array.isArray(e.bullets) && bi >= 0 && bi < e.bullets.length) {
          const removed = e.bullets.splice(bi, 1)[0]; if (isWeb) e.desc = e.bullets.join('\n');
          await setState(from, { step: 0, mode: 'edit', data: state.data });
          await send(from, '🗑️ Removed from *' + roleLabel(e, isWeb) + '*: "' + removed + '"\n\n' + roleDetail(e, isWeb) + '\n\nAnything else? Or reply "link".');
          return OK;
        }
        await send(from, 'Reply with a number from the list.'); return OK;
      }
      // ---- edit (rewrite) a bullet ----
      if (state.awaiting === 'editBulletRole') {
        const exps = expsOf(state.data, isWeb);
        const idx = parseInt((low.match(/\d+/) || [])[0], 10) - 1; const e = exps[idx];
        if (e && (e.bullets || []).length) {
          const list = e.bullets.map((b, i) => (i + 1) + '. ' + b).join('\n');
          await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'editBulletPick', pendingIdx: idx });
          await send(from, 'Which bullet should I rewrite in *' + roleLabel(e, isWeb) + '*?\n\n' + list + '\n\nReply with the number.');
          return OK;
        }
        await send(from, 'Reply with a number from the list.'); return OK;
      }
      if (state.awaiting === 'editBulletPick') {
        const exps = expsOf(state.data, isWeb); const e = exps[state.pendingIdx];
        const bi = parseInt((low.match(/\d+/) || [])[0], 10) - 1;
        if (e && Array.isArray(e.bullets) && bi >= 0 && bi < e.bullets.length) {
          await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'editBulletText', pendingIdx: state.pendingIdx, pendingIdx2: bi });
          await send(from, 'What should it say instead?\n\nCurrent: "' + e.bullets[bi] + '"');
          return OK;
        }
        await send(from, 'Reply with a number from the list.'); return OK;
      }
      if (state.awaiting === 'editBulletText') {
        const exps = expsOf(state.data, isWeb); const e = exps[state.pendingIdx];
        if (e && Array.isArray(e.bullets) && e.bullets[state.pendingIdx2] !== undefined) {
          e.bullets[state.pendingIdx2] = cleanBullet(text); if (isWeb) e.desc = e.bullets.join('\n');
          await setState(from, { step: 0, mode: 'edit', data: state.data });   // save AFTER mutating
          await send(from, '✏️ Updated bullet in *' + roleLabel(e, isWeb) + '*.\n\n' + roleDetail(e, isWeb) + '\n\nAnything else? Or reply "link".');
        } else { await setState(from, { step: 0, mode: 'edit', data: state.data }); await send(from, "Couldn't find that bullet — try again."); }
        return OK;
      }
      // ---- remove a role / experience ----
      if (state.awaiting === 'rmRolePick') {
        const exps = expsOf(state.data, isWeb);
        const idx = parseInt((low.match(/\d+/) || [])[0], 10) - 1;
        if (idx >= 0 && idx < exps.length) {
          const removed = exps.splice(idx, 1)[0];
          await setState(from, { step: 0, mode: 'edit', data: state.data });
          await send(from, '🗑️ Removed role: *' + roleLabel(removed, isWeb) + '*\n\n' + summ() + '\n\nAnything else? Or reply "link".');
          return OK;
        }
        await send(from, 'Reply with a number from the list (1–' + exps.length + ').'); return OK;
      }
      // ---- remove a skill (by number or name) ----
      if (state.awaiting === 'rmSkillPick') {
        const sk = Array.isArray(state.data.skills) ? state.data.skills : [];
        let idx = -1;
        const num = parseInt((low.match(/^\s*(\d+)\s*$/) || [])[1], 10);
        if (num >= 1 && num <= sk.length) idx = num - 1;
        else idx = sk.findIndex((s) => String(s).trim().toLowerCase() === text.trim().toLowerCase());
        if (idx >= 0) {
          const removed = sk.splice(idx, 1)[0];
          await setState(from, { step: 0, mode: 'edit', data: state.data });
          await send(from, '🗑️ Removed skill: *' + removed + '*\n\n' + summ() + '\n\nAnything else? Or reply "link".');
          return OK;
        }
        await send(from, 'Reply with a number from the list, or the exact skill name.'); return OK;
      }
      // ---- remove an education / award / key achievement (pick from list) ----
      if (state.awaiting === 'rmEduPick' || state.awaiting === 'rmAwardPick' || state.awaiting === 'rmAchPick') {
        const cfg = {
          rmEduPick: { arr: 'education', label: eduLabel, name: 'education entry' },
          rmAwardPick: { arr: 'awards', label: awardLabel, name: 'award' },
          rmAchPick: { arr: 'keyAchievements', label: achLabel, name: 'achievement' }
        }[state.awaiting];
        const arr = Array.isArray(state.data[cfg.arr]) ? state.data[cfg.arr] : [];
        const idx = parseInt((low.match(/\d+/) || [])[0], 10) - 1;
        if (idx >= 0 && idx < arr.length) {
          const removed = arr.splice(idx, 1)[0];
          await setState(from, { step: 0, mode: 'edit', data: state.data });
          await send(from, '🗑️ Removed ' + cfg.name + ': *' + cfg.label(removed) + '*\n\nAnything else? Or reply "link".');
          return OK;
        }
        await send(from, 'Reply with a number from the list (1–' + arr.length + ').'); return OK;
      }
      if (state.awaiting) {
        const pre = { experience: 'add experience: ', skill: 'add skill: ',
          summary: 'summary: ', role: 'role: ', name: 'name: ', years: 'years: ',
          education: (isWeb ? 'add education: ' : 'education: '),
          email: 'email: ', phone: 'phone: ', location: 'location: ', linkedin: 'linkedin: ', github: 'github: ',
          award: 'add award: ', achievement: 'add achievement: ' }[state.awaiting] || '';
        const changed = applyFn(pre + text);
        await setState(from, { step: 0, mode: 'edit', data: state.data }); // clears awaiting
        if (changed) await send(from, '✅ Updated ' + changed + '.\n\n' + summ() + '\n\nAnything else? Or reply "link" to get your resume.');
        else await send(from, "Hmm, I couldn't quite use that — try rephrasing it, or reply \"menu\" for options.");
        return OK;
      }

      // ---- Multi-step edits that need a role / bullet picked first ----
      const _exps = expsOf(state.data, isWeb);
      const _roleList = () => _exps.map((e, i) => (i + 1) + '. ' + roleLabel(e, isWeb)).join('\n');
      // set dates
      if (/^(set|change|edit|update|add)\s+dates?$/i.test(low) || /^dates?$/i.test(low)) {
        if (!_exps.length) { await send(from, 'No roles yet — add one first with "add experience".'); return OK; }
        if (_exps.length === 1) { await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'datesValue', pendingIdx: 0 }); await send(from, 'What dates for *' + roleLabel(_exps[0], isWeb) + '*?\n\nExample: *Jan 2020 - Present*'); return OK; }
        await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'datesRole' });
        await send(from, 'Which role?\n\n' + _roleList() + '\n\nReply with the number.'); return OK;
      }
      // remove a bullet
      if (/^(remove|delete|drop)\s+(a\s+)?bullet(\s*point)?$/i.test(low)) {
        if (!_exps.length) { await send(from, 'No experience yet.'); return OK; }
        if (_exps.length === 1) { const e = _exps[0]; if (!(e.bullets || []).length) { await send(from, 'That role has no bullets yet.'); return OK; } const list = e.bullets.map((b, i) => (i + 1) + '. ' + b).join('\n'); await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'rmBulletPick', pendingIdx: 0 }); await send(from, 'Which bullet should I remove from *' + roleLabel(e, isWeb) + '*?\n\n' + list + '\n\nReply with the number.'); return OK; }
        await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'rmBulletRole' });
        await send(from, 'Which role?\n\n' + _roleList() + '\n\nReply with the number.'); return OK;
      }
      // edit / rewrite a bullet
      if (/^(edit|change|rewrite|fix|update)\s+(a\s+)?bullet(\s*point)?$/i.test(low)) {
        if (!_exps.length) { await send(from, 'No experience yet.'); return OK; }
        if (_exps.length === 1) { const e = _exps[0]; if (!(e.bullets || []).length) { await send(from, 'That role has no bullets yet.'); return OK; } const list = e.bullets.map((b, i) => (i + 1) + '. ' + b).join('\n'); await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'editBulletPick', pendingIdx: 0 }); await send(from, 'Which bullet should I rewrite in *' + roleLabel(e, isWeb) + '*?\n\n' + list + '\n\nReply with the number.'); return OK; }
        await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'editBulletRole' });
        await send(from, 'Which role?\n\n' + _roleList() + '\n\nReply with the number.'); return OK;
      }
      // remove a role / experience
      if (/^(remove|delete|drop)\s+(a\s+|an\s+|the\s+)?(experience|role|job|position)$/i.test(low)) {
        if (!_exps.length) { await send(from, 'No roles to remove.'); return OK; }
        if (_exps.length === 1) { const removed = _exps.splice(0, 1)[0]; await setState(from, { step: 0, mode: 'edit', data: state.data }); await send(from, '🗑️ Removed role: *' + roleLabel(removed, isWeb) + '*\n\n' + summ() + '\n\nAnything else? Or reply "link".'); return OK; }
        await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'rmRolePick' });
        await send(from, 'Which role should I remove?\n\n' + _roleList() + '\n\nReply with the number.'); return OK;
      }
      // remove a skill (bare → list & pick). "remove skill: X" one-liner still works below.
      if (/^(remove|delete|drop)\s+(a\s+)?skills?$/i.test(low)) {
        const sk = Array.isArray(state.data.skills) ? state.data.skills : [];
        if (!sk.length) { await send(from, 'No skills to remove.'); return OK; }
        const list = sk.map((s, i) => (i + 1) + '. ' + s).join('\n');
        await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: 'rmSkillPick' });
        await send(from, 'Which skill should I remove?\n\n' + list + '\n\nReply with the number (or the skill name).'); return OK;
      }
      // clear a contact field / summary (cloud only — immediate)
      if (isWeb) {
        const _clears = [
          [/^(remove|clear|delete)\s+e-?mail$/i, 'email', 'email'],
          [/^(remove|clear|delete)\s+(phone|mobile|contact\s*number)$/i, 'phone', 'phone'],
          [/^(remove|clear|delete)\s+(location|city|address)$/i, 'location', 'location'],
          [/^(remove|clear|delete)\s+linked-?in$/i, 'linkedin', 'LinkedIn'],
          [/^(remove|clear|delete)\s+git-?hub$/i, 'github', 'GitHub'],
          [/^(remove|clear|delete)\s+summary$/i, 'summary', 'summary']
        ];
        for (let i = 0; i < _clears.length; i++) {
          if (_clears[i][0].test(low)) {
            state.data[_clears[i][1]] = '';
            await setState(from, { step: 0, mode: 'edit', data: state.data });
            await send(from, '🗑️ Cleared ' + _clears[i][2] + '.\n\nAnything else? Or reply "link".');
            return OK;
          }
        }
      }
      // remove an education / award / key achievement (cloud list fields)
      if (isWeb) {
        const _rmLists = [
          [/^(remove|delete|drop)\s+(an?\s+|the\s+)?(education|qualification|degree)$/i, 'education', eduLabel, 'education entry', 'rmEduPick'],
          [/^(remove|delete|drop)\s+(an?\s+|the\s+)?award$/i, 'awards', awardLabel, 'award', 'rmAwardPick'],
          [/^(remove|delete|drop)\s+(a\s+|the\s+)?(key\s+)?(achievement|highlight)$/i, 'keyAchievements', achLabel, 'achievement', 'rmAchPick']
        ];
        for (let i = 0; i < _rmLists.length; i++) {
          const cfg = _rmLists[i];
          if (cfg[0].test(low)) {
            const arr = Array.isArray(state.data[cfg[1]]) ? state.data[cfg[1]] : [];
            if (!arr.length) { await send(from, 'No ' + cfg[3] + ' to remove.'); return OK; }
            if (arr.length === 1) { const removed = arr.splice(0, 1)[0]; await setState(from, { step: 0, mode: 'edit', data: state.data }); await send(from, '🗑️ Removed ' + cfg[3] + ': *' + cfg[2](removed) + '*\n\nAnything else? Or reply "link".'); return OK; }
            const list = arr.map((x, j) => (j + 1) + '. ' + cfg[2](x)).join('\n');
            await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting: cfg[4] });
            await send(from, 'Which ' + cfg[3] + ' should I remove?\n\n' + list + '\n\nReply with the number.');
            return OK;
          }
        }
      }

      // Bare "add …" / field command (no value yet) → ask for the value, then
      // apply it on the next message. This is what makes a plain "Add experience"
      // start a guided add instead of dumping the help text.
      let awaiting = null, prompt = null;
      if (/^add\s+(a\s+|an\s+|new\s+)?(work\s+)?(experience|job|position|role)$/i.test(low)) {
        awaiting = 'experience';
        prompt = 'Sure — tell me the role, company and 1–3 things you did there, in one message.\n\nExample:\n*Senior PM at Acme — Led the AWS migration; Cut cloud costs 30%*';
      } else if (isWeb && /^add\s+(a\s+|an\s+)?bullet(\s*point)?$/i.test(low)) {
        awaiting = 'bullet';
        prompt = "What should the new bullet say? Plain words are fine — I'll sharpen it.\n\nExample: *Shipped the new onboarding flow*";
      } else if (/^add\s+(a\s+|an\s+|some\s+)?skills?$/i.test(low)) {
        awaiting = 'skill';
        prompt = 'Which skill(s)? List one or a few, comma-separated.\n\nExample: *Python, Kubernetes, SQL*';
      } else if (isWeb && /^(edit\s+|change\s+|update\s+|set\s+|my\s+)?summary$/i.test(low)) {
        awaiting = 'summary';
        prompt = "Send me the new professional summary (1–3 sentences) and I'll set it.";
      } else if (/^(edit\s+|change\s+|update\s+|set\s+|my\s+)?(role|title|target)$/i.test(low)) {
        awaiting = 'role';
        prompt = 'What role/title should I set? e.g. *Senior Product Manager*';
      } else if (/^(edit\s+|change\s+|update\s+|set\s+|my\s+)?name$/i.test(low)) {
        awaiting = 'name';
        prompt = 'What name should go on the resume?';
      } else if (!isWeb && /^(edit\s+|change\s+|update\s+|set\s+|my\s+)?(years?|experience)$/i.test(low)) {
        awaiting = 'years';
        prompt = 'How many years of experience? (a number is fine)';
      } else if (/^(add\s+|edit\s+|change\s+|update\s+|set\s+|my\s+)?(education|qualification|degree)$/i.test(low)) {
        awaiting = 'education';
        prompt = 'Your qualification, institute and year? e.g. *B.Tech, IIT Delhi, 2024*';
      } else if (isWeb && /^(add\s+|edit\s+|change\s+|update\s+|set\s+|my\s+)?e-?mail$/i.test(low)) {
        awaiting = 'email'; prompt = "What's your email address?";
      } else if (isWeb && /^(add\s+|edit\s+|change\s+|update\s+|set\s+|my\s+)?(phone|mobile|contact\s*number)$/i.test(low)) {
        awaiting = 'phone'; prompt = "What's your phone number?";
      } else if (isWeb && /^(add\s+|edit\s+|change\s+|update\s+|set\s+|my\s+)?(location|city|address)$/i.test(low)) {
        awaiting = 'location'; prompt = 'What location should I show? e.g. *Bengaluru, India*';
      } else if (isWeb && /^(add\s+|edit\s+|change\s+|update\s+|set\s+|my\s+)?linked-?in$/i.test(low)) {
        awaiting = 'linkedin'; prompt = 'Your LinkedIn (URL or handle)?';
      } else if (isWeb && /^(add\s+|edit\s+|change\s+|update\s+|set\s+|my\s+)?git-?hub$/i.test(low)) {
        awaiting = 'github'; prompt = 'Your GitHub (URL or handle)?';
      } else if (isWeb && /^add\s+(an\s+)?award$/i.test(low)) {
        awaiting = 'award'; prompt = 'What award? Name, who gave it, and the year.\n\nExample: *Best Employee, Acme, 2023*';
      } else if (isWeb && /^add\s+(a\s+)?(key\s+)?(achievement|highlight)$/i.test(low)) {
        awaiting = 'achievement'; prompt = 'What achievement? A short title and (optionally) a line of detail.\n\nExample: *Led the AWS migration — cut cloud costs 30%*';
      }
      if (prompt) {
        await setState(from, { step: 0, mode: 'edit', data: state.data, awaiting });
        await send(from, prompt);
        return OK;
      }

      // Direct one-liners still work (e.g. "add skill: Python", "role: Data Analyst").
      const changed = applyFn(text);
      if (changed) {
        await setState(from, { step: 0, mode: 'edit', data: state.data });
        await send(from, '✅ Updated ' + changed + '.\n\n' + summ() + '\n\nAnything else? Or reply "link" to get your resume.');
      } else {
        await send(from, "Tell me what to change — just say any of these and I'll ask for the details:\n" +
          '• *add experience*  • *add bullet*  • *edit bullet*  • *remove bullet*\n' +
          '• *add skill*  • *remove skill*  • *set dates*  • *remove role*\n' +
          '• *role*  • *summary*  • *name*  • *education*  • *add award*\n' +
          '• *add achievement*  • *email*  • *phone*  • *location*  • *linkedin*  • *github*\n' +
          '\nOr do it in one line, e.g. "add skill: Python".\nReply "link" to get your resume, or "menu" for options.');
      }
      return OK;
    }

    // ---- Idle / first contact: returning user → menu, new user → build ----
    if (state.mode !== 'build') {
      let prof = await getProfile(from);
      // Linked web-account user: always refresh from their LATEST saved resume,
      // so editing on WhatsApp works on the current version (linking stays one-time).
      try {
        const mapUid = await redis(['GET', 'wamap:' + from]);
        if (mapUid) {
          const wr = await redis(['GET', 'webresume:' + mapUid]);
          let web = null; try { web = wr ? JSON.parse(wr) : null; } catch (e) {}
          if (web && (web.firstName || web.jobTitle || (web.experience || []).length)) { web._src = 'web'; await setProfile(from, web); prof = web; }
        }
      } catch (e) {}
      const pName = prof && (prof.name || prof.firstName);
      if (prof && pName) {
        await setState(from, { step: 0, mode: 'menu', data: { experiences: [] } });
        await send(from, '👋 Welcome back, ' + firstName(pName) + '! Your resume is saved with me.\n\n' + MENU +
          '\n\nOr just send a PDF to import a different one.');
        return { statusCode: 200, body: 'ok' };
      }
      state = { step: 0, mode: 'build', data: { experiences: [] } }; // brand-new → build
    }

    // ---- Mode: build (the linear Q&A) ----
    if (state.step > 0 && STEPS[state.step - 1]) {
      await STEPS[state.step - 1].save(state.data, text);
    }
    if (state.step < STEPS.length) {
      const step = STEPS[state.step];
      const q = typeof step.ask === 'function' ? step.ask(state.data) : step.ask;
      state.step += 1;
      state.mode = 'build';
      await setState(from, state);
      await send(from, q);
    } else {
      await finishAndLink(from, state.data, base);
    }
  } catch (e) {
    console.error('[whatsapp] error', e);
    await send(from, "Oops — something hiccuped on my end. Reply anything to continue, or \"restart\" to begin again.");
  }
  return { statusCode: 200, body: 'ok' };
};
