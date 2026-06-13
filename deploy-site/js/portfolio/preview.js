// Mounts a sandboxed iframe that renders the current template + state.
// Subscribes to PortfolioState changes and re-renders debounced.

const PortfolioPreview = (() => {
  let iframeEl = null;
  let pending = null;

  function wrapDoc(rendered){
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${rendered.css}</style>
</head><body>${rendered.html}</body></html>`;
  }

  function render(){
    if (!iframeEl) return;
    const state = window.PortfolioState.get();
    const tpl = window.PortfolioTemplates.get(state.theme?.templateId);
    if (!tpl){
      iframeEl.srcdoc = '<p style="font-family:sans-serif;padding:24px;color:#888">No template registered.</p>';
      return;
    }
    try {
      iframeEl.srcdoc = wrapDoc(tpl.render(state));
    } catch(err){
      iframeEl.srcdoc = `<pre style="font-family:monospace;padding:24px;color:#c33;white-space:pre-wrap">Preview error:\n${String(err.message || err)}</pre>`;
    }
  }

  function scheduleRender(){
    clearTimeout(pending);
    pending = setTimeout(render, 120);
  }

  function mount(container){
    container.innerHTML = '';
    iframeEl = document.createElement('iframe');
    iframeEl.setAttribute('sandbox', 'allow-same-origin');
    iframeEl.setAttribute('title', 'Portfolio preview');
    iframeEl.style.width = '100%';
    iframeEl.style.height = '100%';
    iframeEl.style.border = 'none';
    iframeEl.style.background = '#fff';
    container.appendChild(iframeEl);
    render();
    window.PortfolioState.subscribe(scheduleRender);
  }

  function refresh(){ render(); }

  return { mount, refresh };
})();

window.PortfolioPreview = PortfolioPreview;
