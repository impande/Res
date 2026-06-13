// POST /api/publish — reserve a slug, store the portfolio JSON, return URL + editToken.
// Body: { slug, portfolio }
import { portfolios, writeJson, readJson } from "./_lib/blob.js";
import { normalize, validate } from "./_lib/slug.js";
import { json, methodNotAllowed, killSwitchOn, LIMITS, newEditToken, hashToken } from "./_lib/abuse.js";

export default async (req) => {
  if (req.method !== "POST") return methodNotAllowed();
  if (killSwitchOn()) return json({ error: "Publishing is temporarily disabled." }, 503);

  const cl = parseInt(req.headers.get("content-length") || "0", 10);
  if (cl && cl > LIMITS.payloadBytes){
    return json({ error: "Portfolio payload too large." }, 413);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const slug = normalize(body.slug);
  const reason = validate(slug);
  if (reason) return json({ error: reason }, 400);

  const portfolio = body.portfolio;
  if (!portfolio || typeof portfolio !== 'object'){
    return json({ error: "Missing portfolio" }, 400);
  }

  const store = portfolios();
  const existing = await readJson(store, slug);
  if (existing) return json({ error: "That slug is already taken." }, 409);

  const editToken = newEditToken();
  const record = {
    slug,
    portfolio,
    editTokenHash: hashToken(editToken),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customDomain: null,
    domainVerifiedAt: null
  };
  await writeJson(store, slug, record);

  return json({
    slug,
    url: `/s/${slug}`,
    editToken,
    message: "Save your edit token now — you'll need it to edit later, and we can't recover it."
  });
};
