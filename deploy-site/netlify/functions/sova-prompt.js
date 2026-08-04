// Sova — AI prompt engineer.
// Turns a user's rough, plain-language request into the single best prompt to
// paste into any AI (ChatGPT / Claude / Gemini). It detects intent, matches the
// prompt's complexity to the task (a "rewrite this" stays short; a research task
// gets structure), preserves the user's own content, and separately flags any
// missing info or blockers.
//
// Dedicated function (not `generate`) so it doesn't inherit that function's
// resume-writer system prompt. Uses the same ANTHROPIC_API_KEY.

const SYSTEM = `You are a world-class prompt engineer. A user gives you a rough request in plain language. Rewrite it into the single best, ready-to-paste prompt for a general AI assistant (ChatGPT, Claude, Gemini) so the user gets exactly the output they want.

First think about:
- INTENT — what does the user actually want? (rewrite, shorten, summarise, translate, fix grammar, explain, brainstorm, write code, draft an email, a quick factual answer, a step-by-step guide, etc.)
- SCOPE — match the prompt's complexity to the task. If the task is simple (e.g. "rewrite this sentence"), write a SHORT, direct prompt that yields a SHORT result. Do NOT add a role, numbered steps, caveats, "takeaways", or length padding unless the task genuinely benefits. Over-engineering a simple task is a failure.
- LANGUAGE — detect the language the user actually wrote in, including mixed or romanised languages (e.g. Hinglish / Hindi typed in Latin letters, Spanglish, etc.). Do NOT assume English.

The prompt you output must:
- Be written in the SAME language, script, and register the user used, so it reads naturally to them and they can edit it. (If they wrote in Hinglish, write the prompt in Hinglish; if in Hindi/Devanagari, use that; if in English, English.)
- Make the AI's final answer come back in that same language, UNLESS the user clearly asked for another language or for a translation (e.g. "email in English", "translate to French") — then honour that instead.
- Preserve the user's own content/data verbatim in its original language (quote the exact text to rewrite/translate/etc. — never translate the content they want acted on unless translation IS the task).
- Be specific, unambiguous, and self-contained (works with no extra context).
- State the output form only when it helps (e.g. "Return only the rewritten text.").
- PERSPECTIVE: when the user is describing themselves ("I am…", "write … for me / for my resume / my LinkedIn"), write the prompt in their own first-person voice ("I am a product manager. Write 5 bullet points about my work…") or address the assistant to help "me". NEVER refer to the user in the third person or treat their name as a subject to write about ("Prashant's skills", "his experience" is wrong).
- Do not invent specific facts the user didn't give (real metrics, employers, dates), BUT you may use clearly-marked placeholders like [project], [metric], [year] that the user can fill in — placeholders are not invented facts.
- Prefer a prompt that works on its own. If a detail would sharpen the result, build it INTO the prompt (use placeholders, or tell the AI to ask the user 1–2 quick questions first) rather than blocking the user.

"needs" is a rare, last-resort flag — keep it EMPTY almost always. Set it ONLY when the task literally cannot produce anything useful until the user supplies a specific input (e.g. "paste the text you want rewritten"). A request like "write 5 bullet points about me as a product manager" is NOT a blocker — write a strong prompt (with placeholders) and leave "needs" empty. When you do set it, write it in the user's language and address them as "you", never in the third person.

Output ONLY valid JSON, no markdown fences, exactly:
{"prompt":"<the ready-to-paste prompt>","needs":"<one short line naming missing info or a blocker the user should provide; empty string if nothing is missing>"}`;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': (origin && origin !== 'null') ? origin : '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const CORS = cors(origin);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Add ANTHROPIC_API_KEY to your Netlify environment variables, then redeploy.' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const input = String(body.input || '').trim();
    const imageContent = String(body.imageContent || '').trim();
    const note = String(body.note || '').trim();
    if (!input && !imageContent) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing input' }) };

    const userMsg =
      `Rewrite this request into the best prompt.\n\nUSER REQUEST:\n"""\n${input || '(no text — base the prompt on the attached image content below)'}\n"""` +
      (imageContent ? `\n\nCONTENT FROM AN ATTACHED IMAGE (use as data/context):\n"""\n${imageContent}\n"""` : '') +
      (note ? `\n\nEXTRA SHAPING INSTRUCTIONS (apply to the prompt): ${note}` : '');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || 'API error' }) };

    let text = (data.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let out;
    try { out = JSON.parse(text); }
    catch { out = { prompt: text, needs: '' }; }   // fall back to raw text as the prompt
    if (!out.prompt) out = { prompt: text, needs: out.needs || '' };

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ prompt: String(out.prompt).trim(), needs: String(out.needs || '').trim() }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
