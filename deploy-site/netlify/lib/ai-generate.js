/* ai-generate.js — the Claude call behind /.netlify/functions/generate, shared by
 *   generate.js            (synchronous; Netlify cuts it off at 26 s)
 *   generate-background.js (no 26 s cap; the page polls for the result)
 *
 * runAI(body, { mode })  ->  { status, payload }
 *   mode 'sync' : tight deadlines so the answer (or the fallback) lands inside 26 s
 *   mode 'bg'   : generous deadlines for long jobs such as a full resume
 *
 * Speed: resume writing, rewriting, parsing and skill suggestions don't need deep
 * reasoning, so thinking is turned off on Sonnet 5.5 (`between_tools`) / Haiku 5.5
 * (`disabled`) and effort is lowered. Without this, Sonnet 5.5 thinks first at its
 * default `high` effort, which pushed full-resume generation past 26 s (504s).
 * The ATS score keeps Opus 5.5's own judgment settings.
 */

const SYS = {
  score:    'You are a strict ATS (Applicant Tracking System) screener and veteran recruiter. Grade resumes rigorously, consistently and honestly: reward specific, quantified, action-led achievements; penalise vagueness, filler, missing metrics, unfinished placeholder brackets and over-length. Follow the scoring rubric and exact JSON shape in the user message. Output only that JSON — no prose, no markdown, no code fences.',
  parse:    'You are a precise resume data-extraction assistant. Extract every field faithfully into the requested JSON structure. Never invent, infer or omit data. Output valid JSON only.',
  skills:   'You are a career expert. Suggest relevant, specific, ATS-friendly skills matched to the candidate\'s role and experience. No duplicates, no generic filler. Be concise.',
  generate: 'You are an elite resume writer. Produce ATS-optimised, recruiter-ready content: strong action verbs, quantified achievements, tight lines, zero cliches or filler. Never invent employers, titles, metrics or tools the candidate did not supply — where a number would clearly strengthen a line but is missing, use a [X] placeholder for the candidate to fill. Output plain text, no markdown.'
};

// Task-aware model routing (Claude 5 family) — unchanged.
const PRIMARY  = { score: 'claude-opus-5-5', generate: 'claude-sonnet-5-5', rewrite: 'claude-sonnet-5-5', parse: 'claude-sonnet-5-5', skills: 'claude-haiku-5-5' };
// Known-good fallback if a Claude 5 model isn't enabled on this API key.
const FALLBACK = { score: 'claude-sonnet-4-6', generate: 'claude-sonnet-4-6', rewrite: 'claude-haiku-4-5-20251001', parse: 'claude-sonnet-4-6', skills: 'claude-haiku-4-5-20251001' };

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    verdict: { type: 'string' },
    roasts: { type: 'array', items: { type: 'object', properties: { emoji: { type: 'string' }, quote: { type: 'string' }, zing: { type: 'string' } }, required: ['emoji', 'quote', 'zing'], additionalProperties: false } },
    fixes: { type: 'array', items: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' } }, required: ['before', 'after'], additionalProperties: false } },
    newScore: { type: 'integer' },
    shareLine: { type: 'string' }
  },
  required: ['score', 'verdict', 'roasts', 'fixes', 'newScore', 'shareLine'],
  additionalProperties: false
};

function detectTask(body, prompt, hasImages) {
  let task = String(body.task || '').toLowerCase();
  if (!['score', 'generate', 'parse', 'skills', 'rewrite'].includes(task)) {
    if (hasImages) task = 'parse';
    else if (/\bATS\s*SCORE\b|ATS readiness|"roasts"\s*:/i.test(prompt || '')) task = 'score';
    else if (/\bParse resume\b|\bExtract\b|JSON object/i.test(prompt || '')) task = 'parse';
    else if (/suggest[^.]*\bskills\b|\bskills\b[^.]*suggest|ATS-?friendly skills/i.test(prompt || '')) task = 'skills';
    else task = 'generate';
  }
  return task;
}

/* Speed settings per model (see header). Returns the fields to merge in. */
function speedFields(model, task, mode) {
  if (task === 'score') return {};                       // keep Opus 5.5 defaults for judgment
  if (model === 'claude-sonnet-5-5') {
    // thinking off; effort low for quick sync calls, medium for background jobs
    return { thinking: { type: 'between_tools' }, output_config: { effort: mode === 'bg' ? 'medium' : 'low' } };
  }
  if (model === 'claude-haiku-5-5') {
    return { thinking: { type: 'disabled' }, output_config: { effort: 'low' } };
  }
  return {};
}

async function callClaude(apiKey, reqBody, ms) {
  const ac = new AbortController();
  const timer = ms ? setTimeout(() => ac.abort(), ms) : null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: ac.signal
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: j };
  } catch (e) {
    return { ok: false, status: 504, data: { error: { message: (e && e.name === 'AbortError') ? 'timed out' : (e && e.message) || 'network error' } } };
  } finally { if (timer) clearTimeout(timer); }
}

async function runAI(body, opts) {
  const mode = (opts && opts.mode) || 'sync';
  const { prompt, imageBase64, imageBase64Array, imageMimeType } = body;
  // imageBase64Array: pages of a scanned PDF; imageBase64: single image (backward compat)
  const images = imageBase64Array || (imageBase64 ? [imageBase64] : []);
  if (!prompt && !images.length) return { status: 400, payload: { text: '', error: 'Missing prompt' } };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 500, payload: { text: '', error: 'Add ANTHROPIC_API_KEY to your Netlify environment variables, then redeploy' } };

  const hasImages = images.length > 0;
  const task = detectTask(body, prompt, hasImages);
  const primaryModel = hasImages ? 'claude-sonnet-5-5' : (PRIMARY[task] || 'claude-sonnet-5-5');
  const fallbackModel = hasImages ? 'claude-sonnet-4-6' : (FALLBACK[task] || 'claude-sonnet-4-6');

  const base = { max_tokens: 8192, system: SYS[task] || SYS.generate };

  if (hasImages) {
    const mimeType = imageMimeType || 'image/jpeg';
    base.messages = [{
      role: 'user',
      content: [
        ...images.map(b64 => ({ type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } })),
        { type: 'text', text: prompt || 'Extract all resume data from this image as JSON.' }
      ]
    }];
  } else {
    // Personalization (content-writing only): role, tone and the candidate's own phrasing.
    if ((task === 'generate' || task === 'rewrite') && body.persona && typeof body.persona === 'object') {
      const pz = body.persona; let note = '';
      if (pz.role) note += ' The candidate targets a "' + String(pz.role).slice(0, 80) + '" role.';
      if (pz.tone) note += ' Preferred tone: ' + String(pz.tone).slice(0, 40) + '.';
      if (Array.isArray(pz.examples) && pz.examples.length) {
        note += ' Mirror the wording, rhythm and seniority of these lines the candidate wrote (do NOT copy them verbatim, and never invent facts or numbers): ' +
          pz.examples.slice(0, 3).map((e) => '"' + String(e).slice(0, 180) + '"').join('; ') + '.';
      }
      if (note) base.system += '\n\nPERSONALIZATION —' + note;
    }
    base.messages = [{ role: 'user', content: prompt }];
  }

  // Primary request: model + speed settings (+ the grammar-enforced JSON shape for the score).
  const primary = Object.assign({ model: primaryModel }, base, speedFields(primaryModel, task, mode));
  if (task === 'score') primary.output_config = Object.assign({}, primary.output_config, { format: { type: 'json_schema', schema: SCORE_SCHEMA } });

  // Deadlines. Sync: leave room for the fallback inside Netlify's 26 s.
  // Background: no platform cap, but never hang forever.
  const primaryMs = mode === 'bg' ? 120000 : (primaryModel !== fallbackModel ? 17000 : 24000);
  const fallbackMs = mode === 'bg' ? 120000 : 8500;

  let res = await callClaude(apiKey, primary, primaryMs);
  // On any error, retry once on the known-good model with a plain request: no
  // thinking/effort/schema fields (older models reject some of them), so the
  // feature never hard-fails on a key without Claude 5 or a transient issue.
  if (!res.ok) console.warn('[ai] primary failed', task, mode, primaryModel, res.status, res.data && res.data.error && res.data.error.message);
  if (!res.ok && primaryModel !== fallbackModel) {
    const fb = Object.assign({ model: fallbackModel }, base);
    res = await callClaude(apiKey, fb, fallbackMs);
  }
  if (!res.ok) {
    return { status: res.status, payload: { text: '', error: (res.data && res.data.error && res.data.error.message) || 'API error' } };
  }
  // Claude 5 models can emit a thinking block first, so find the TEXT block.
  const blocks = Array.isArray(res.data.content) ? res.data.content : [];
  const text = (blocks.find(b => b && b.type === 'text') || {}).text || '';
  return { status: 200, payload: { text } };
}

module.exports = { runAI, detectTask };
