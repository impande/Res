// GET /s/:slug — render a published portfolio.
// Also handles custom domains: if the incoming Host matches a verified
// custom domain, look up its slug.
import { portfolios, domains, readJson } from "./_lib/blob.js";

export default async (req) => {
  const url = new URL(req.url);
  const host = (req.headers.get("host") || "").toLowerCase();
  let slug = url.pathname.split('/').filter(Boolean).pop();

  // Custom domain lookup: only if this host isn't our own apex.
  const apex = (process.env.SITE_APEX || "").toLowerCase();
  if (host && host !== apex && !host.endsWith(".netlify.app") && !host.startsWith("localhost")){
    const mapped = await domains().get(host);
    if (mapped) slug = mapped;
  }

  if (!slug) return notFound("Missing slug.");

  const record = await readJson(portfolios(), slug);
  if (!record) return notFound("No portfolio at this address.");

  return new Response(renderShell(record), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300"
    }
  });
};

function renderShell(record){
  const p = record.portfolio || {};
  const id = p.identity || {};
  const about = p.about || {};
  const name = [id.firstName, id.lastName].filter(Boolean).join(' ').trim() || 'Portfolio';
  const title = `${esc(name)}${id.headline ? ' — ' + esc(id.headline) : ''}`;
  const description = esc(about.tagline || about.bio || `${name}'s portfolio.`).slice(0, 180);

  // Bootstrap renders client-side using the same template modules as the editor.
  // First paint shows a small loader; the swap is near-instant on modern devices.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="profile">
<style>html,body{margin:0;background:#fafaf7}#__loading{font:14px/1.5 system-ui,sans-serif;color:#888;padding:48px 24px;text-align:center}</style>
</head>
<body>
<div id="__loading">Loading…</div>
<script id="__state" type="application/json">${JSON.stringify(p).replace(/</g, '\\u003c')}</script>
<script src="/js/portfolio/templates/registry.js"></script>
<script src="/js/portfolio/templates/minimal.js"></script>
<script src="/js/portfolio/templates/bold.js"></script>
<script src="/js/portfolio/templates/developer.js"></script>
<script src="/js/portfolio/templates/designer.js"></script>
<script src="/js/portfolio/templates/executive.js"></script>
<script>
  (function(){
    var state = JSON.parse(document.getElementById('__state').textContent);
    var tpl = window.PortfolioTemplates.get(state.theme && state.theme.templateId);
    if (!tpl){ document.getElementById('__loading').textContent = 'No template registered.'; return; }
    var out = tpl.render(state);
    document.getElementById('__loading').remove();
    var style = document.createElement('style');
    style.textContent = out.css;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', out.html);
  })();
</script>
</body>
</html>`;
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function notFound(msg){
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Not found</title>` +
    `<div style="font:16px/1.5 system-ui,sans-serif;color:#444;padding:96px 24px;text-align:center">` +
    `<h1 style="font-weight:500;margin-bottom:12px">404</h1><p>${esc(msg)}</p></div>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
