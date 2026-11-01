/* Shared client for the free career tools.
 *   R4UTools.mountResumeInput(el, opts) -> { get() }  the resume saved by the
 *                                                builder on this device, a PDF upload
 *                                                (read in the browser with pdf.js) or pasted text
 *   R4UTools.run(tool, input, onStatus)          background job + polling, with a
 *                                                fast synchronous fallback
 *   R4UTools.esc / copy / ringColor helpers
 */
(function () {
  var RT = (window.R4UTools = {});
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  RT.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  RT.ringColor = function (s) { return s >= 85 ? '#16a34a' : s >= 75 ? '#0d9488' : s >= 56 ? '#d97706' : '#dc2626'; };

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Could not load the PDF reader. Paste your resume text instead.')); };
      document.head.appendChild(s);
    });
  }
  var pdfReady = null;
  RT.pdfjs = function () {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfReady) pdfReady = loadScript(PDFJS + 'pdf.min.js').then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      return window.pdfjsLib;
    });
    return pdfReady;
  };

  // Rebuild reading-order lines from pdf.js text items (adds spaces between runs
  // only where there's a real horizontal gap, so words aren't split).
  RT.extractPdf = async function (file) {
    var lib = await RT.pdfjs();
    var pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    var pages = [];
    for (var p = 1; p <= Math.min(pdf.numPages, 10); p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var lines = [], line = '', lastY = null, lastEnd = null;
      tc.items.forEach(function (it) {
        var x = it.transform[4], y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; lastEnd = null; }
        var gap = lastEnd === null ? 0 : x - lastEnd;
        if (line && gap > (it.height || 8) * 0.18 && !/\s$/.test(line) && !/^\s/.test(it.str)) line += ' ';
        line += it.str;
        lastY = y; lastEnd = x + (it.width || 0);
        if (it.hasEOL) { lines.push(line); line = ''; lastY = null; lastEnd = null; }
      });
      if (line) lines.push(line);
      pages.push(lines.map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n'));
    }
    return { text: pages.join('\n\n'), pageCount: pdf.numPages };
  };

  /* ---------- the resume saved by the builder on this device ---------- */
  // The builder (same origin) keeps the rendered resume in localStorage. Turn its
  // HTML into plain reading-order text; fall back to the saved data object.
  var BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|LI|H1|H2|H3|H4|H5|H6|TR|TABLE|BR|HR)$/;
  function htmlToText(html) {
    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    doc.querySelectorAll('script,style,img,svg,button,[hidden],.no-print').forEach(function (n) { n.remove(); });
    var out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1) return;
      var b = BLOCK.test(n.tagName);
      if (b) out.push('\n');
      if (n.tagName === 'LI') out.push('• ');
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (b) out.push('\n');
    })(doc.body);
    return out.join('').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return l && l !== '•'; }).join('\n');
  }
  function dataToText(d) {
    var lines = [];
    (function walk(v, key) {
      if (v == null || v === '' || /^(template|photo|image|color|font|id|_)/i.test(key || '')) return;
      if (typeof v === 'string' || typeof v === 'number') { if (!/^data:/.test(String(v))) lines.push(String(v)); return; }
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, key); }); return; }
      if (typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k], k); });
    })(d, '');
    return lines.join('\n');
  }
  RT.savedResume = function () {
    var ls; try { ls = window.localStorage; if (!ls) return null; } catch (e) { return null; }
    var text = '', name = '', when = 0;
    try { var html = ls.getItem('_lastResumeOutput'); if (html) text = htmlToText(html); } catch (e) {}
    var data = null;
    try { data = JSON.parse(ls.getItem('_r4uResumeData') || 'null'); } catch (e) {}
    if (text.length < 200 && data) text = dataToText(data);
    if (text.length < 200) return null;
    if (data) name = data.name || data.fullName || (data.personal && data.personal.name) || '';
    if (!name) name = text.split('\n')[0];
    try { when = Number(ls.getItem('_r4uSnapTime')) || 0; } catch (e) {}
    return { text: text.slice(0, 24000), name: String(name).slice(0, 60), when: when };
  };
  function ago(t) {
    if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'updated just now';
    if (m < 60) return 'updated ' + m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return 'updated ' + h + ' h ago';
    var d = Math.round(h / 24); return 'updated ' + d + ' day' + (d > 1 ? 's' : '') + ' ago';
  }

  /* ---------- resume input widget ----------
   * opts.uploadLabel  drop-zone title (default "Upload your resume (PDF)")
   * opts.help         optional HTML shown in a "How?" disclosure under the drop zone
   * If the builder saved a resume on this device it is offered first and selected. */
  RT.mountResumeInput = function (el, opts) {
    opts = opts || {};
    var state = { text: '', pageCount: 0, name: '' };
    var saved = RT.savedResume(), useSaved = !!saved;
    el.innerHTML =
      (saved ? '<label class="saved on"><input type="checkbox" checked>' +
        '<span class="sv-ic" aria-hidden="true">✓</span><span class="sv-tx"><b>Use my Resume For You resume</b>' +
        '<span>' + RT.esc(saved.name) + (saved.when ? ' · ' + ago(saved.when) : '') + '</span></span></label>' +
        '<div class="or"><span>or use a different one</span></div>' : '') +
      '<div class="drop" tabindex="0" role="button" aria-label="' + RT.esc(opts.uploadLabel || 'Upload your resume (PDF)') + '">' +
        '<b>📄 ' + RT.esc(opts.uploadLabel || 'Upload your resume (PDF)') + '</b><span class="dmsg">Tap to choose a file, or drop it here · read in your browser</span>' +
        '<input type="file" accept="application/pdf,.pdf,.txt,text/plain" hidden>' +
      '</div>' +
      (opts.help ? '<details class="howto"><summary>' + RT.esc(opts.helpTitle || 'How?') + '</summary><div>' + opts.help + '</div></details>' : '') +
      '<button type="button" class="linkbtn tg">or paste your resume text instead</button>' +
      '<textarea class="paste" placeholder="Paste your full resume text here…" hidden></textarea>';
    var drop = el.querySelector('.drop'), file = el.querySelector('input[type=file]'), msg = el.querySelector('.dmsg');
    var ta = el.querySelector('.paste'), tg = el.querySelector('.tg');
    var sv = el.querySelector('.saved'), svBox = sv && sv.querySelector('input');
    function setSaved(on) { useSaved = !!(saved && on); if (sv) { sv.classList.toggle('on', useSaved); svBox.checked = useSaved; } }
    if (svBox) svBox.addEventListener('change', function () { setSaved(svBox.checked); if (svBox.checked) { state = { text: '', pageCount: 0, name: '' }; msg.textContent = 'Tap to choose a file, or drop it here · read in your browser'; showPaste(false); } });
    function showPaste(open) { ta.hidden = !open; tg.textContent = open ? 'or upload a PDF instead' : 'or paste your resume text instead'; if (open) { setSaved(false); ta.focus(); } }
    tg.addEventListener('click', function () { showPaste(ta.hidden); });
    drop.addEventListener('click', function () { file.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
    file.addEventListener('change', function () { if (file.files[0]) handle(file.files[0]); });

    async function handle(f) {
      setSaved(false);
      state = { text: '', pageCount: 0, name: f.name };
      if (f.size > 8 * 1024 * 1024) { msg.innerHTML = '<span class="err">That file is over 8 MB. Please upload a smaller PDF.</span>'; return; }
      msg.textContent = 'Reading ' + f.name + '…';
      try {
        if (/\.txt$/i.test(f.name) || f.type === 'text/plain') {
          state.text = (await f.text()).trim(); state.pageCount = 0;
        } else {
          var r = await RT.extractPdf(f); state.text = r.text; state.pageCount = r.pageCount;
        }
        if (state.text.length < 200) {
          msg.innerHTML = '<span class="err">This PDF looks scanned (it has no selectable text). Please paste your resume text below.</span>';
          state.text = ''; showPaste(true); return;
        }
        msg.innerHTML = '<span class="ok">✓ ' + RT.esc(f.name) + '</span> · ' + (state.pageCount ? state.pageCount + ' page' + (state.pageCount > 1 ? 's' : '') + ' · ' : '') + state.text.length.toLocaleString() + ' characters read';
        if (!ta.hidden) showPaste(false);
      } catch (e) {
        msg.innerHTML = '<span class="err">' + RT.esc(e.message || 'Could not read that file.') + '</span>';
        showPaste(true);
      }
    }
    return {
      get: function () {
        var pasted = ta.value.trim();
        if (!ta.hidden && pasted.length >= 120) return { resumeText: pasted, pageCount: 0 };
        if (state.text) return { resumeText: state.text, pageCount: state.pageCount };
        if (useSaved && saved) return { resumeText: saved.text, pageCount: 0 };
        if (pasted.length >= 120) return { resumeText: pasted, pageCount: 0 };
        throw new Error('Please upload your resume PDF or paste your resume text first.');
      }
    };
  };

  /* ---------- run a tool: background job + poll, else fast sync ---------- */
  function hexId(n) {
    var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function poll(id, maxMs) {
    var t0 = Date.now(), sawRunning = false;
    while (Date.now() - t0 < maxMs) {
      await sleep(2000);
      try {
        var r = await fetch('/.netlify/functions/career-tools?job=' + id, { cache: 'no-store' });
        var j = await r.json();
        if (j.status === 'done' || j.status === 'error') return j;
        if (j.status === 'running') sawRunning = true;
        if (!sawRunning && Date.now() - t0 > 25000) return null; // background never started
      } catch (e) {}
    }
    return null;
  }
  RT.run = async function (tool, input, onStatus) {
    var id = hexId(20), bg = null;
    try {
      bg = await fetch('/.netlify/functions/career-tools-background', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: id, tool: tool, input: input })
      });
    } catch (e) { bg = null; }
    if (bg && bg.status === 200) {               // platform ran it synchronously
      var direct = await bg.json().catch(function () { return null; });
      if (direct && direct.status === 'done') return direct.result;
      if (direct && direct.status === 'error') throw new Error(direct.error);
    }
    if (bg && (bg.status === 202 || bg.status === 429)) {
      var j = await poll(id, bg.status === 429 ? 6000 : 170000);
      if (j && j.status === 'done') return j.result;
      if (j && j.status === 'error') throw new Error(j.error);
      if (bg.status === 429) throw new Error('Too many requests right now. Please try again in a little while.');
    }
    if (onStatus) onStatus('Almost there…');
    var r = await fetch('/.netlify/functions/career-tools', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: tool, input: input })
    });
    var out = await r.json().catch(function () { return {}; });
    if (out.status === 'done') return out.result;
    throw new Error(out.error || 'Something went wrong. Please try again.');
  };

  /* ---------- UI helpers ---------- */
  RT.copy = function (text, btn) {
    function done() { if (btn) { var t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = t; }, 1600); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fb); else fb();
    function fb() { var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); }
  };
  // Wire a page's Run button: shows rotating status lines while the tool runs.
  RT.wire = function (opts) {
    var btn = opts.button, status = opts.status, err = opts.error, out = opts.results;
    btn.addEventListener('click', async function () {
      err.classList.remove('on');
      var input;
      try { input = opts.collect(); } catch (e) { err.textContent = e.message; err.classList.add('on'); return; }
      btn.disabled = true; out.classList.remove('on');
      var msgs = opts.messages || ['Working on it…'], k = 0, label = status.querySelector('.lbl');
      label.textContent = msgs[0]; status.classList.add('on');
      var iv = setInterval(function () { k = Math.min(k + 1, msgs.length - 1); label.textContent = msgs[k]; }, 5000);
      try {
        var result = await RT.run(opts.tool, input, function (m) { label.textContent = m; });
        opts.render(result);
        out.classList.add('on');
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        err.textContent = e.message || 'Something went wrong. Please try again.'; err.classList.add('on');
      } finally {
        clearInterval(iv); status.classList.remove('on'); btn.disabled = false;
      }
    });
  };
})();
