// Minimal abuse helpers used by publish/upload/chat.
// A fuller rate-limit + size-cap pass arrives in task #15.

import crypto from "node:crypto";

export function clientIp(req){
  return req.headers.get("x-nf-client-connection-ip")
      || req.headers.get("x-forwarded-for")?.split(',')[0]?.trim()
      || "unknown";
}

export function killSwitchOn(){
  return process.env.PUBLISH_DISABLED === "1" || process.env.PUBLISH_DISABLED === "true";
}

export function hashToken(token){
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function newEditToken(){
  return crypto.randomBytes(24).toString("base64url");
}

export function constantTimeEqual(a, b){
  if (!a || !b) return false;
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export function methodNotAllowed(){
  return json({ error: "Method not allowed" }, 405);
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PAYLOAD_BYTES = 256 * 1024;    // 256 KB for JSON payloads

export const LIMITS = {
  imageBytes: MAX_IMAGE_BYTES,
  payloadBytes: MAX_PAYLOAD_BYTES,
  imageMimeTypes: new Set(['image/jpeg','image/png','image/webp','image/gif','image/svg+xml'])
};
