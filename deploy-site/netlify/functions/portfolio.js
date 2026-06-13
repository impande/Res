// GET  /api/portfolio?slug=...&token=...     → returns portfolio JSON for editing
// PUT  /api/portfolio?slug=...&token=...     → updates portfolio JSON (re-publish)
import { portfolios, readJson, writeJson } from "./_lib/blob.js";
import { normalize, validate } from "./_lib/slug.js";
import { json, methodNotAllowed, killSwitchOn, LIMITS, hashToken, constantTimeEqual } from "./_lib/abuse.js";

export default async (req) => {
  const url = new URL(req.url);
  const slug = normalize(url.searchParams.get("slug"));
  const token = url.searchParams.get("token") || "";

  const reason = validate(slug);
  if (reason) return json({ error: reason }, 400);
  if (!token) return json({ error: "Missing edit token" }, 401);

  const store = portfolios();
  const record = await readJson(store, slug);
  if (!record) return json({ error: "Not found" }, 404);

  const givenHash = hashToken(token);
  if (!constantTimeEqual(givenHash, record.editTokenHash)){
    return json({ error: "Invalid edit token" }, 403);
  }

  if (req.method === "GET"){
    return json({ slug: record.slug, portfolio: record.portfolio, updatedAt: record.updatedAt, customDomain: record.customDomain, domainVerifiedAt: record.domainVerifiedAt });
  }

  if (req.method === "PUT"){
    if (killSwitchOn()) return json({ error: "Editing is temporarily disabled." }, 503);
    const cl = parseInt(req.headers.get("content-length") || "0", 10);
    if (cl && cl > LIMITS.payloadBytes) return json({ error: "Portfolio payload too large." }, 413);

    let body;
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON" }, 400); }

    if (!body.portfolio || typeof body.portfolio !== 'object'){
      return json({ error: "Missing portfolio" }, 400);
    }

    record.portfolio = body.portfolio;
    record.updatedAt = new Date().toISOString();
    await writeJson(store, slug, record);
    return json({ ok: true, updatedAt: record.updatedAt, url: `/s/${slug}` });
  }

  return methodNotAllowed();
};
