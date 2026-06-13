// Thin wrapper around Netlify Blobs so the function code stays terse.
// Stores live in three namespaces:
//   portfolios   — keyed by slug, value = portfolio JSON
//   images       — keyed by image key (random id + ext), value = bytes
//   domains      — keyed by lowercased custom domain, value = slug
import { getStore } from "@netlify/blobs";

export function portfolios(){ return getStore("portfolios"); }
export function images(){ return getStore({ name: "images" }); }
export function domains(){ return getStore("domains"); }

export async function readJson(store, key){
  const raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function writeJson(store, key, value){
  await store.set(key, JSON.stringify(value));
}
