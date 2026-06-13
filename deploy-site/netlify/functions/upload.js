// POST /api/upload — store an image in Netlify Blobs, return a URL.
// Accepts multipart/form-data with a "file" field.
import crypto from "node:crypto";
import { images } from "./_lib/blob.js";
import { LIMITS, json, methodNotAllowed, killSwitchOn } from "./_lib/abuse.js";

export default async (req) => {
  if (req.method !== "POST") return methodNotAllowed();
  if (killSwitchOn()) return json({ error: "Uploads are temporarily disabled." }, 503);

  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")){
    return json({ error: "Send multipart/form-data with a 'file' field." }, 400);
  }

  let form;
  try { form = await req.formData(); }
  catch { return json({ error: "Invalid form data" }, 400); }

  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "Missing 'file' field" }, 400);

  const mime = file.type || "application/octet-stream";
  if (!LIMITS.imageMimeTypes.has(mime)){
    return json({ error: `Unsupported image type: ${mime}` }, 415);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > LIMITS.imageBytes){
    return json({ error: `Image too large. Max ${Math.round(LIMITS.imageBytes / 1024 / 1024)} MB.` }, 413);
  }

  const ext = extFromMime(mime);
  const key = crypto.randomBytes(12).toString("base64url") + ext;

  try {
    await images().set(key, buf, { metadata: { contentType: mime } });
  } catch (e){
    return json({ error: "Storage write failed", detail: String(e?.message || e) }, 502);
  }

  return json({ key, url: `/i/${key}`, mime, bytes: buf.length });
};

function extFromMime(mime){
  switch (mime){
    case "image/jpeg": return ".jpg";
    case "image/png":  return ".png";
    case "image/webp": return ".webp";
    case "image/gif":  return ".gif";
    case "image/svg+xml": return ".svg";
    default: return "";
  }
}
