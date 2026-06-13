// Secure serverless proxy to the Anthropic API.
// The API key lives ONLY here (as an environment variable on Netlify),
// never in the browser, so visitors can never see or steal it.

export default async (req) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "Server not configured: missing ANTHROPIC_API_KEY" }, 500);
  }

  // Parse the request body coming from the browser
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON in request" }, 400);
  }

  // Forward the request to Anthropic with the secret key attached server-side
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return json({ error: "Upstream request failed", detail: String(err) }, 502);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
