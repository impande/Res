// Edit-existing flow. Two entry points:
//   /portfolio.html?edit=<slug>     → shows the token form
//   PortfolioEdit.openModal()       → called by the "Edit existing" link
// Successful load rehydrates PortfolioState from the server and boots the wizard.

const PortfolioEdit = (() => {

  function renderInline(container, prefillSlug){
    container.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">R</div>
          <div><div class="brand-text">Résumé AI</div><div class="brand-sub">Edit existing portfolio</div></div>
        </div>
        <a href="/portfolio.html">← Back</a>
      </header>
      <main class="hero">
        <div class="eyebrow">Pick up where you left off</div>
        <h1>Edit an <em>existing</em> portfolio</h1>
        <p class="sub">Paste the slug and edit token you saved when you published. We don't store accounts — the token is your key.</p>
        <div class="edit-form">
          <div class="field-group" style="text-align:left">
            <div class="field-label">Slug</div>
            <input type="text" id="edit-slug" value="${esc(prefillSlug || '')}" placeholder="yourname">
          </div>
          <div class="field-group" style="text-align:left">
            <div class="field-label">Edit token</div>
            <input type="text" id="edit-token" placeholder="paste your token">
          </div>
          <button class="btn btn-primary" onclick="PortfolioEdit.load()">Load portfolio →</button>
          <div id="edit-status" class="pub-status" style="margin-top:10px"></div>
        </div>
      </main>
    `;
  }

  async function load(){
    const slug = document.getElementById('edit-slug').value.trim();
    const token = document.getElementById('edit-token').value.trim();
    const status = document.getElementById('edit-status');
    if (!slug || !token){
      status.className = 'pub-status err';
      status.textContent = 'Both slug and token are required.';
      return;
    }
    status.className = 'pub-status';
    status.textContent = 'Loading…';
    try {
      const res = await fetch(`/api/portfolio?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      // Stash credentials for re-publish.
      sessionStorage.setItem('portfolio.editingSlug', data.slug);
      sessionStorage.setItem('portfolio.editToken', token);
      // Replace state with what we got, then jump into the wizard.
      window.PortfolioState.replace(data.portfolio || {});
      window.location.href = '/portfolio.html?mode=wizard&editing=' + encodeURIComponent(data.slug);
    } catch (e){
      status.className = 'pub-status err';
      status.textContent = e.message || String(e);
    }
  }

  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  return { renderInline, load };
})();

window.PortfolioEdit = PortfolioEdit;
