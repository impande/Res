// File-picker widget that uploads to /api/upload and writes the resulting URL
// back into PortfolioState via the wizard's bind() function.

const PortfolioUpload = (() => {

  async function upload(file){
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data; // { key, url, mime, bytes }
  }

  // Renders an inline file-picker that, on selection, uploads + writes URL into state.
  // Usage from a step renderer:
  //   PortfolioUpload.widget({ currentUrl, onSuccess: 'PortfolioWizard.bind("identity.avatar", "%URL%")' })
  // The onSuccess string has %URL% replaced with the upload URL and is executed.
  function widget(opts){
    const id = 'up-' + Math.random().toString(36).slice(2, 8);
    const cur = opts.currentUrl || '';
    const onSuccess = opts.onSuccess || '';
    return `
      <div class="upload-widget" data-id="${id}">
        ${cur ? `<img src="${esc(cur)}" alt="" class="upload-preview">` : `<div class="upload-empty">No image yet</div>`}
        <label class="upload-btn">
          <span>${cur ? 'Replace…' : 'Upload image'}</span>
          <input type="file" accept="image/*" style="display:none" onchange="PortfolioUpload._handle(this, '${encodeURIComponent(onSuccess)}', '${id}')">
        </label>
        ${cur ? `<button type="button" class="upload-clear" onclick="PortfolioUpload._clear('${encodeURIComponent(onSuccess)}')">Remove</button>` : ''}
        <div class="upload-status" id="${id}-status"></div>
      </div>
    `;
  }

  async function _handle(input, encodedExpr, id){
    const file = input.files?.[0];
    if (!file) return;
    const status = document.getElementById(id + '-status');
    if (status) status.innerHTML = '<span class="upload-loading">Uploading…</span>';
    try {
      const result = await upload(file);
      const expr = decodeURIComponent(encodedExpr).replace('%URL%', result.url);
      // eslint-disable-next-line no-new-func
      new Function(expr)();
      if (window.PortfolioWizard?.refresh) window.PortfolioWizard.refresh();
    } catch (e){
      if (status) status.innerHTML = `<span class="upload-error">${esc(e.message || String(e))}</span>`;
    }
  }

  function _clear(encodedExpr){
    const expr = decodeURIComponent(encodedExpr).replace('%URL%', '');
    new Function(expr)();
    if (window.PortfolioWizard?.refresh) window.PortfolioWizard.refresh();
  }

  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  return { upload, widget, _handle, _clear };
})();

window.PortfolioUpload = PortfolioUpload;
