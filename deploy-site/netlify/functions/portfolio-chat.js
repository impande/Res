// Portfolio chat interview turn endpoint.
// POST { messages: [{role, content}], stateSnapshot: {...} }
// Returns { reply, patch, done }

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server not configured: missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const state = body.stateSnapshot || {};

  if (messages.length > 50) return json({ error: "Conversation too long" }, 413);

  const system = buildSystemPrompt(state);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system,
        messages: messages.slice(-30) // cap context size
      })
    });

    const data = await resp.json();
    if (data.error) return json({ error: data.error.message || "Upstream error" }, resp.status);

    const text = (data.content || []).map(c => c.text || "").join("");
    const parsed = extractEnvelope(text);
    if (!parsed) {
      return json({ reply: text, patch: {}, done: false, warning: "could_not_parse_envelope" });
    }

    return json({
      reply: String(parsed.reply || "").slice(0, 2000),
      patch: sanitizePatch(parsed.patch),
      done: !!parsed.done
    });
  } catch (err) {
    return json({ error: "Upstream request failed", detail: String(err) }, 502);
  }
};

function buildSystemPrompt(state){
  return `You are a friendly, perceptive interviewer helping someone build their personal portfolio website. Your goal is to gather enough about them to fill out:

- identity: firstName, lastName, headline (their role/title), email, location, social links (linkedin, github, twitter, website)
- about: tagline (one memorable line) + bio (3-5 sentences, first person, warm)
- experience: list of {role, company, dates, highlights[]} — keep highlights tight and impact-driven
- projects: list of {title, summary, role, links{live,repo}, tech[]} — selected work they'd want to showcase
- skills.groups: list of {name, items[]} — group similar skills together
- education: list of {school, degree, dates}

INTERVIEW STYLE:
- Ask ONE focused question at a time. Wait for the answer.
- Be conversational and human. React to what they say.
- Don't ask everything in order — prioritize what they care about based on their answers.
- For multi-fact items (a role, a project), draw out 2-3 details then move on.
- When you've gathered something reasonable across most categories, set done:true and offer to hand off to the Style + Review step.

YOU MUST RESPOND WITH VALID JSON ONLY. No prose outside the JSON. Exact shape:

{
  "reply": "<your conversational reply or next question>",
  "patch": <a JSON object that deep-merges into the portfolio state — only include keys that have NEW info from this turn>,
  "done": <boolean>
}

PATCH RULES:
- For nested objects (identity, about), include only changed nested keys: {"identity": {"firstName": "Alex"}}
- For LIST fields (experience, projects, skills.groups, education), return the FULL list as you currently understand it. Don't append — replace. Include ids if they exist; otherwise omit id and the frontend will assign one.
- If nothing new to record this turn, send "patch": {}

CURRENT STATE (what's already gathered):
${JSON.stringify(state, null, 2)}

Begin (or continue) the interview. If this is the first turn (no user messages yet), greet warmly, say what you'll be doing together, and ask the very first question.`;
}

function extractEnvelope(text){
  if (!text) return null;
  // Find the first balanced JSON object in the response
  const start = text.indexOf('{');
  if (start === -1) return null;
  // Try progressively larger slices to find a parseable JSON object
  let depth = 0;
  for (let i = start; i < text.length; i++){
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0){
        const slice = text.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          if (typeof obj === 'object' && obj !== null && 'reply' in obj) return obj;
        } catch {}
      }
    }
  }
  return null;
}

function sanitizePatch(p){
  if (!p || typeof p !== 'object') return {};
  // Whitelist top-level keys to match the portfolio shape.
  const allowed = ['identity','about','experience','projects','skills','education','contact','theme'];
  const out = {};
  for (const k of allowed) if (k in p) out[k] = p[k];
  return out;
}

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
