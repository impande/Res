// Bundles the current portfolio as a static site and triggers a ZIP download.
// Uses JSZip from CDN, loaded lazily on first export.

const PortfolioExport = (() => {

  let jszipReady = null;
  function loadJSZip(){
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (jszipReady) return jszipReady;
    jszipReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => reject(new Error('Failed to load JSZip from CDN.'));
      document.head.appendChild(s);
    });
    return jszipReady;
  }

  async function downloadZip(){
    const state = window.PortfolioState.get();
    const tpl = window.PortfolioTemplates.get(state.theme?.templateId);
    if (!tpl) throw new Error('No template selected.');
    const rendered = tpl.render(state);
    const name = ([state.identity?.firstName, state.identity?.lastName].filter(Boolean).join(' ').trim()) || 'portfolio';
    const title = name + (state.identity?.headline ? ' — ' + state.identity.headline : '');

    const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
${rendered.html}
</body>
</html>`;

    const readme = `# ${name}'s portfolio

This folder contains a self-contained static portfolio site exported from Résumé AI.

## Files
- index.html — the page itself
- style.css — all styles, including the template's typography and layout
- README.md — this file

## Hosting
Drop these files on any static host:
- GitHub Pages: push to a \`gh-pages\` branch
- Netlify: drag-and-drop the folder into the Netlify dashboard
- Vercel, Cloudflare Pages, plain S3 — also fine

## Editing
Open \`index.html\` and \`style.css\` in any editor. They're plain HTML/CSS — no build step.

Images (if any) are hosted at their original URLs; if you'd rather inline them, save the files locally and update the \`src\` attributes.
`;

    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('index.html', indexHtml);
    zip.file('style.css', rendered.css);
    zip.file('README.md', readme);

    const blob = await zip.generateAsync({ type: 'blob' });
    const filename = sanitize(name) + '-portfolio.zip';
    triggerDownload(blob, filename);
  }

  function sanitize(s){
    return String(s || 'portfolio').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'portfolio';
  }

  function triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  return { downloadZip };
})();

window.PortfolioExport = PortfolioExport;
