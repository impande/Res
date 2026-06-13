// Publish flow: slug picker → POST /api/publish → show URL + editToken.

const PortfolioPublish = (() => {

  function suggestSlug(state){
    const id = state.identity || {};
    const raw = [(id.firstName || '').trim(), (id.lastName || '').trim()].filter(Boolean).join('').toLowerCase();
    return (raw || 'me').replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'me';
  }

  // Render the publish panel into a container (called from wizard's Review step).
  function render(container){
    const state = window.PortfolioState.get();
    const initial = suggestSlug(state);
    container.innerHTML = `
      <div class="publish-card">
        <div class="publish-card-title">Publish to a free subdomain</div>
        <div class="publish-card-desc">Your portfolio will be live at <span id="pub-domain-hint">${apexHint()}</span>.</div>
        <div class="field-row" style="margin-top:14px;align-items:end">
          <div class="field-group" style="margin-bottom:0">
            <div class="field-label">Pick a slug</div>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" id="pub-slug" value="${esc(initial)}" placeholder="yourname" oninput="PortfolioPublish.onSlugInput(this.value)">
            </div>
            <div id="pub-slug-status" class="pub-status">Checking…</div>
          </div>
          <div class="field-group" style="margin-bottom:0">
            <button class="btn btn-primary" id="pub-go" onclick="PortfolioPublish.go()" disabled>Publish →</button>
          </div>
        </div>
        <div id="pub-result"></div>
      </div>
    `;
    onSlugInput(initial);
  }

  let lastCheck = 0;
  let validSlug = '';
  async function onSlugInput(raw){
    const status = document.getElementById('pub-slug-status');
    const btn = document.getElementById('pub-go');
    btn.disabled = true;
    status.className = 'pub-status';
    status.textContent = 'Checking…';
    const myId = ++lastCheck;
    await new Promise(r => setTimeout(r, 220));
    if (myId !== lastCheck) return; // typed again
    try {
      const res = await fetch('/api/check-slug?slug=' + encodeURIComponent(raw));
      const data = await res.json();
      if (myId !== lastCheck) return;
      if (data.available){
        validSlug = data.slug;
        status.className = 'pub-status ok';
        status.textContent = `${data.slug} is available ✓`;
        btn.disabled = false;
      } else {
        validSlug = '';
        status.className = 'pub-status err';
        status.textContent = data.reason || `${data.slug} is taken`;
      }
    } catch(e){
      status.className = 'pub-status err';
      status.textContent = 'Could not check (' + (e.message || e) + ')';
    }
  }

  async function go(){
    if (!validSlug) return;
    const btn = document.getElementById('pub-go');
    const out = document.getElementById('pub-result');
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: validSlug, portfolio: window.PortfolioState.get() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Publish failed (${res.status})`);
      const fullUrl = window.location.origin + data.url;
      out.innerHTML = `
        <div class="pub-result-card">
          <div class="pub-success">✓ Published</div>
          <div class="field-group" style="margin-top:10px">
            <div class="field-label">Your URL</div>
            <div class="pub-row">
              <code class="pub-code">${esc(fullUrl)}</code>
              <button class="btn btn-ghost" onclick="PortfolioPublish.copy('${esc(fullUrl)}', this)">Copy</button>
              <a class="btn btn-primary" href="${esc(data.url)}" target="_blank" rel="noopener">Open ↗</a>
            </div>
          </div>
          <div class="field-group">
            <div class="field-label">Edit token — save this somewhere safe</div>
            <div class="pub-row">
              <code class="pub-code pub-token">${esc(data.editToken)}</code>
              <button class="btn btn-ghost" onclick="PortfolioPublish.copy('${esc(data.editToken)}', this)">Copy</button>
            </div>
            <div class="pub-warning">${esc(data.message || 'We cannot recover this token if you lose it.')}</div>
          </div>
          <details class="pub-details">
            <summary>How to come back and edit later</summary>
            <p>Visit <code>/portfolio.html?edit=${esc(data.slug)}</code>, paste this token, and you'll pick up where you left off.</p>
          </details>
        </div>
      `;
      btn.textContent = 'Published ✓';
    } catch (e){
      out.innerHTML = `<div class="pub-error">${esc(e.message || String(e))}</div>`;
      btn.textContent = 'Try again';
      btn.disabled = false;
    }
  }

  function copy(text, btn){
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1600);
    });
  }

  function apexHint(){
    const h = window.location.host;
    return `https://${h}/s/<your-slug>`;
  }

  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  return { render, onSlugInput, go, copy };
})();

window.PortfolioPublish = PortfolioPublish;
