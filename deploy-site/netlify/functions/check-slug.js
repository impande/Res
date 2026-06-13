// GET /api/check-slug?slug=... — is this slug available?
import { portfolios } from "./_lib/blob.js";
import { normalize, validate } from "./_lib/slug.js";
import { json, methodNotAllowed } from "./_lib/abuse.js";

export default async (req) => {
  if (req.method !== "GET") return methodNotAllowed();
  const url = new URL(req.url);
  const raw = url.searchParams.get("slug") || "";
  const slug = normalize(raw);
  const reason = validate(slug);
  if (reason) return json({ slug, available: false, reason });

  const existing = await portfolios().get(slug);
  return json({ slug, available: !existing });
};
