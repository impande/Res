const API_URL = "/api/claude";
const MODEL = "claude-sonnet-4-20250514";

async function callClaude(maxTokens, prompt){
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error);
  return data.content.map(c => c.text || "").join("");
}
