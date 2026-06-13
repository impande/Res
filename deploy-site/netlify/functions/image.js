// GET /i/:key — serve an image stored in Blobs.
import { images } from "./_lib/blob.js";

export default async (req) => {
  const url = new URL(req.url);
  // Route is set up so the function receives /i/<key>; extract the key from the end.
  const key = url.pathname.split('/').pop();
  if (!key) return new Response("Not found", { status: 404 });

  const result = await images().getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) return new Response("Not found", { status: 404 });

  const contentType = (result.metadata && result.metadata.contentType) || guessFromKey(key) || "application/octet-stream";

  return new Response(result.data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
};

function guessFromKey(k){
  const m = /\.([a-z0-9]+)$/i.exec(k);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return {
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", webp: "image/webp",
    gif: "image/gif", svg: "image/svg+xml"
  }[ext] || null;
}
