// Slug normalization, validation, and a small reserved list.
// The reserved list keeps namespace-relevant prefixes free.

const RESERVED = new Set([
  'admin','api','app','assets','auth','about','blog','cdn','contact','dashboard',
  'dev','docs','download','edit','email','help','home','image','images','login',
  'logout','mail','new','portfolio','preview','profile','public','register','reset',
  'resume','root','s','signin','signup','site','sites','static','support','test',
  'user','users','wiki','www','i'
]);

// Words we won't accept as slugs even if a user really wants them.
const BLOCKED_SUBSTRINGS = ['fuck','shit','nigger','faggot','cunt','retard','rape'];

export function normalize(input){
  return String(input || '').toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export function validate(slug){
  if (!slug) return 'Pick a slug.';
  if (slug.length < 3) return 'Too short — at least 3 characters.';
  if (slug.length > 30) return 'Too long — under 30 characters.';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use lowercase letters, numbers, and hyphens only.';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Cannot start or end with a hyphen.';
  if (RESERVED.has(slug)) return 'That word is reserved. Try another.';
  for (const bad of BLOCKED_SUBSTRINGS){
    if (slug.includes(bad)) return 'That slug is not allowed.';
  }
  return null;
}
