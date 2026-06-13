// Template registry — each template exposes:
//   { id, name, description, render: (state) => { html, css } }
// `html` is the inner <body> markup; `css` is a style block.
// The preview iframe wraps both into a full HTML document.

const PortfolioTemplates = (() => {
  const map = new Map();
  function register(tpl){
    if (!tpl || !tpl.id || typeof tpl.render !== 'function') throw new Error('invalid template');
    map.set(tpl.id, tpl);
  }
  function get(id){ return map.get(id) || map.values().next().value; }
  function list(){ return Array.from(map.values()); }
  return { register, get, list };
})();

window.PortfolioTemplates = PortfolioTemplates;

// Shared helpers for templates.
function escapeHTML(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function fullName(identity){
  return [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim();
}
function socialLinks(identity){
  const s = identity.social || {};
  const items = [];
  if (s.linkedin) items.push({ label: 'LinkedIn', href: ensureUrl(s.linkedin) });
  if (s.github) items.push({ label: 'GitHub', href: ensureUrl(s.github) });
  if (s.twitter) items.push({ label: 'Twitter', href: ensureUrl(s.twitter) });
  if (s.website) items.push({ label: 'Website', href: ensureUrl(s.website) });
  return items;
}
function ensureUrl(v){
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/+/, '');
}
function fontStack(pairId){
  const pairs = {
    'serif-modern': { heading: "'Playfair Display', Georgia, serif", body: "'DM Sans', system-ui, sans-serif" },
    'sans-clean':   { heading: "'Inter', system-ui, sans-serif",     body: "'Inter', system-ui, sans-serif" },
    'mono-tech':    { heading: "'JetBrains Mono', monospace",        body: "'Inter', system-ui, sans-serif" },
    'editorial':    { heading: "'Cormorant Garamond', Georgia, serif", body: "'Lora', Georgia, serif" }
  };
  return pairs[pairId] || pairs['serif-modern'];
}
function fontImport(pairId){
  const imports = {
    'serif-modern': "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500&display=swap');",
    'sans-clean':   "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');",
    'mono-tech':    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@500;700&display=swap');",
    'editorial':    "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=Lora:wght@400;500&display=swap');"
  };
  return imports[pairId] || imports['serif-modern'];
}
function modeColors(mode){
  return mode === 'dark'
    ? { bg: '#0f0e0d', surface: '#1a1917', text: '#f0ece4', muted: '#888', border: '#333' }
    : { bg: '#ffffff', surface: '#fafaf7', text: '#1a1a1a', muted: '#666', border: '#e5e5e0' };
}

window.PortfolioTemplateHelpers = { escapeHTML, fullName, socialLinks, ensureUrl, fontStack, fontImport, modeColors };
