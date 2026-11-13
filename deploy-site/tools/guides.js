/* Resume For You — feature guide videos.
 * window.R4UGuide.open(slug)      play one guide in a lightbox (sound on, user-initiated)
 * window.R4UGuide.gallery()       lightbox with all guides to pick from
 * window.R4UGuide.chip(slug,txt)  a "▶ How this works · 0:53" button element
 * window.R4UGuide.auto(rules)     keep chips next to elements that may appear later:
 *                                 rules = [{sel, slug, where:'after'|'append'|'prepend', label}]
 * Any element with data-r4u-guide="<slug>" (or "all") opens the guide on click.
 * Videos: /media/how/<slug>[-v].(mp4|webm) — 9:16 cut on portrait screens. */
(function () {
  if (window.R4UGuide) return;
  var V = 'v=1';
  var G = [
    { s: 'build-your-resume', t: 'Build your resume', d: '0:49', b: 'Add your details step by step and generate a polished resume.' },
    { s: 'ai-bullet-points', t: 'AI bullet points', d: '0:46', b: 'Let AI write strong, quantified bullet points for each role.' },
    { s: 'templates', t: 'Choose a template', d: '0:40', b: 'Browse 100+ ATS-friendly designs and switch anytime.' },
    { s: 'ats-score', t: 'Check your ATS score', d: '0:53', b: 'See your score out of 100 and fix weak lines in one tap.' },
    { s: 'download-and-share', t: 'Download & share', d: '0:49', b: 'Get a PDF or Word file, or share a QR link.' },
    { s: 'job-alerts', t: 'Daily job alerts', d: '0:53', b: 'Fresh jobs for your role on WhatsApp every morning.' },
    { s: 'interview-practice', t: 'Interview practice', d: '1:11', b: 'Get likely questions, then practise on WhatsApp.' }
  ];
  function by(s) { for (var i = 0; i < G.length; i++) if (G[i].s === s) return G[i]; return null; }
  var EXT = (function () { try { var v = document.createElement('video'); if (v.canPlayType('video/mp4; codecs="avc1.640029"') || v.canPlayType('video/mp4; codecs="avc1.42E01E"')) return 'mp4'; } catch (e) {} return 'webm'; })();
  function portrait() { try { return matchMedia('(orientation: portrait) and (max-width: 820px)').matches; } catch (e) { return innerHeight > innerWidth && innerWidth < 820; } }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(name, p) { try { if (window.gtag) gtag('event', name, p || {}); } catch (e) {} }

  var css = ''
    + '.r4g-chip{display:inline-flex;align-items:center;gap:6px;margin:8px 0 0;padding:5px 11px 5px 6px;border:1px solid #f3d9b5;border-radius:99px;background:#fff8ef;color:#9a4a0b;font:inherit;font-size:.78rem;font-weight:700;line-height:1.2;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s,box-shadow .15s;-webkit-tap-highlight-color:transparent}'
    + '.r4g-chip:hover{background:#ffefd9;border-color:#e9b97a;box-shadow:0 4px 12px -8px rgba(217,119,6,.8)}'
    + '.r4g-chip:focus-visible{outline:3px solid rgba(217,119,6,.45);outline-offset:2px}'
    + '.r4g-chip i{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:linear-gradient(145deg,#f59e0b,#ea580c);flex:0 0 auto}'
    + '.r4g-chip i svg{width:9px;height:9px;margin-left:1px}'
    + '.r4g-chip em{font-style:normal;font-weight:600;color:#b4651f;opacity:.85}'
    + '#r4gOv{position:fixed;inset:0;z-index:100060;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(17,14,10,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .2s}'
    + '#r4gOv.on{opacity:1}'
    + '#r4gBox{position:relative;width:min(960px,100%);max-height:100%;overflow:auto;background:#faf8f4;color:#1a1a1a;border-radius:18px;box-shadow:0 40px 90px -30px rgba(0,0,0,.6);font-family:inherit;transform:translateY(10px);transition:transform .2s}'
    + '#r4gOv.on #r4gBox{transform:none}'
    + '#r4gBox.pt{width:min(440px,100%)}'
    + '.r4g-hd{display:flex;align-items:center;gap:10px;padding:12px 52px 10px 16px}'
    + '.r4g-hd b{font-size:1rem;font-weight:800;letter-spacing:-.01em}.r4g-hd span{font-size:.8rem;color:#6b7280}'
    + '.r4g-x{position:absolute;top:8px;right:8px;width:38px;height:38px;border:0;border-radius:50%;background:rgba(0,0,0,.06);color:#374151;font-size:1.5rem;line-height:1;cursor:pointer}'
    + '.r4g-x:hover{background:rgba(0,0,0,.12)}.r4g-x:focus-visible{outline:3px solid rgba(217,119,6,.5)}'
    + '.r4g-vid{background:#faf8f4;line-height:0}.r4g-vid video{display:block;width:100%;height:auto;aspect-ratio:16/9;background:#faf8f4}'
    + '#r4gBox.pt .r4g-vid video{aspect-ratio:9/16;max-height:72vh;max-height:72dvh;width:auto;margin:0 auto}'
    + '.r4g-more{padding:12px 16px 16px}.r4g-more h4{margin:0 0 8px;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9a4a0b}'
    + '.r4g-row{display:flex;flex-wrap:wrap;gap:6px}.r4g-row .r4g-chip{margin:0}'
    + '.r4g-all{display:inline-block;margin-top:12px;font-size:.84rem;font-weight:700;color:#b45309;text-decoration:none}.r4g-all:hover{text-decoration:underline}'
    + '.r4g-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:4px 16px 18px}'
    + '.r4g-card{display:flex;flex-direction:column;text-align:left;border:1px solid #e7e1d6;border-radius:14px;overflow:hidden;background:#fff;cursor:pointer;font:inherit;color:inherit;padding:0;transition:border-color .15s,box-shadow .15s}'
    + '.r4g-card:hover,.r4g-card:focus-visible{border-color:#d97706;box-shadow:0 8px 20px -14px rgba(217,119,6,.8);outline:none}'
    + '.r4g-card img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#f3efe7}'
    + '.r4g-card span{padding:9px 11px 11px}.r4g-card b{display:block;font-size:.9rem}.r4g-card small{display:block;font-size:.76rem;color:#4b5563;margin-top:2px;line-height:1.4}'
    + '@media (prefers-reduced-motion:reduce){#r4gOv,#r4gBox{transition:none}}';
  var st = document.createElement('style'); st.id = 'r4gCss'; st.textContent = css; (document.head || document.documentElement).appendChild(st);

  var PLAY = '<svg viewBox="0 0 10 12" fill="#fff" aria-hidden="true"><path d="M0 0v12l10-6z"/></svg>';
  function chip(slug, label) {
    var g = by(slug); var b = document.createElement('button'); b.type = 'button'; b.className = 'r4g-chip';
    if (slug === 'all') { b.innerHTML = '<i>' + PLAY + '</i>' + esc(label || 'Video guides') + ' <em>· 7 short videos</em>'; b.setAttribute('data-r4u-guide', 'all'); return b; }
    if (!g) return b;
    b.setAttribute('data-r4u-guide', slug);
    b.innerHTML = '<i>' + PLAY + '</i>' + esc(label || 'How this works') + ' <em>· ' + g.d + '</em>';
    b.setAttribute('aria-label', (label || 'How this works') + ' — ' + g.t + ' video, ' + g.d);
    return b;
  }

  var ov = null, box = null, last = null, cur = null;
  function close() {
    if (!ov) return; var v = ov.querySelector('video'); if (v) { try { v.pause(); } catch (e) {} }
    ov.classList.remove('on'); var o = ov; ov = null; setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 200);
    document.removeEventListener('keydown', key, true); window.removeEventListener('resize', rs);
    try { document.documentElement.style.overflow = ''; } catch (e) {}
    if (last && last.focus) { try { last.focus({ preventScroll: true }); } catch (e) {} }
  }
  function key(e) {
    if (!ov) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { var f = ov.querySelectorAll('button,a,video'); if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  }
  var rsT = null;
  function rs() { clearTimeout(rsT); rsT = setTimeout(function () { if (!ov || !cur) return; var want = portrait(); if (want !== box.classList.contains('pt')) { var v = ov.querySelector('video'); var t = v ? v.currentTime : 0, playing = v && !v.paused; render(cur, t, playing); } }, 250); }
  function shell() {
    if (!ov) {
      last = document.activeElement;
      ov = document.createElement('div'); ov.id = 'r4gOv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'r4gT');
      ov.innerHTML = '<div id="r4gBox"></div>';
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.body.appendChild(ov); box = ov.querySelector('#r4gBox');
      document.addEventListener('keydown', key, true); window.addEventListener('resize', rs);
      try { document.documentElement.style.overflow = 'hidden'; } catch (e) {}
      try { if (window._r4uTutorial && window._r4uTutorial.close) window._r4uTutorial.close(false); } catch (e) {}
      requestAnimationFrame(function () { if (ov) ov.classList.add('on'); });
    }
    return box;
  }
  function render(slug, t, autoplay) {
    var g = by(slug); if (!g) return; cur = slug; shell();
    var pt = portrait(); box.classList.toggle('pt', pt);
    var base = '/media/how/' + slug + (pt ? '-v' : '');
    var others = G.filter(function (x) { return x.s !== slug; });
    box.innerHTML = '<div class="r4g-hd"><div><b id="r4gT">' + esc(g.t) + '</b> <span>· ' + g.d + ' video guide</span></div></div>'
      + '<button type="button" class="r4g-x" aria-label="Close video">×</button>'
      + '<div class="r4g-vid"><video controls playsinline webkit-playsinline preload="auto" poster="' + base + '.jpg?' + V + '" src="' + base + '.' + EXT + '?' + V + '"></video></div>'
      + '<div class="r4g-more"><h4>More guides</h4><div class="r4g-row"></div><a class="r4g-all" href="/how-it-works/' + slug + '/" target="_blank" rel="noopener">Open this guide with all steps ↗</a></div>';
    var row = box.querySelector('.r4g-row'); others.forEach(function (x) { row.appendChild(chip(x.s, x.t)); });
    box.querySelector('.r4g-x').addEventListener('click', close);
    var v = box.querySelector('video');
    if (t) v.addEventListener('loadedmetadata', function () { try { v.currentTime = t; } catch (e) {} }, { once: true });
    if (autoplay !== false) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    v.addEventListener('ended', function () { var h = box.querySelector('.r4g-more h4'); if (h) h.textContent = 'Watch next'; });
    setTimeout(function () { var x = box && box.querySelector('.r4g-x'); if (x) x.focus({ preventScroll: true }); }, 60);
    track('guide_open', { guide: slug });
  }
  function gallery() {
    cur = null; shell(); box.classList.remove('pt');
    box.innerHTML = '<div class="r4g-hd"><div><b id="r4gT">Video guides</b> <span>· one feature at a time</span></div></div>'
      + '<button type="button" class="r4g-x" aria-label="Close">×</button><div class="r4g-grid"></div>'
      + '<div class="r4g-more" style="padding-top:0"><a class="r4g-all" style="margin-top:0" href="/how-it-works/" target="_blank" rel="noopener">See all guides on one page ↗</a></div>';
    var grid = box.querySelector('.r4g-grid');
    G.forEach(function (x) {
      var c = document.createElement('button'); c.type = 'button'; c.className = 'r4g-card'; c.setAttribute('data-r4u-guide', x.s);
      c.innerHTML = '<img src="/media/how/' + x.s + '-card.jpg?' + V + '" alt="" loading="lazy" width="640" height="360"><span><b>' + esc(x.t) + ' · ' + x.d + '</b><small>' + esc(x.b) + '</small></span>';
      grid.appendChild(c);
    });
    box.querySelector('.r4g-x').addEventListener('click', close);
    setTimeout(function () { var x = box && box.querySelector('.r4g-x'); if (x) x.focus({ preventScroll: true }); }, 60);
    track('guide_gallery');
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-r4u-guide]'); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    var s = el.getAttribute('data-r4u-guide'); if (s === 'all') gallery(); else render(s);
  }, true);

  function auto(rules) {
    function apply() {
      rules.forEach(function (r) {
        var t = document.querySelector(r.sel); if (!t) return;
        var mark = 'r4g-' + r.slug + '-' + (r.id || ''); var host = r.where === 'after' ? t.parentNode : t;
        if (!host || host.querySelector(':scope > [data-r4g="' + mark + '"]')) return;
        var w = document.createElement('div'); w.setAttribute('data-r4g', mark); w.className = 'r4g-wrap' + (r.cls ? ' ' + r.cls : '');
        if (r.style) w.style.cssText = r.style;
        w.appendChild(chip(r.slug, r.label));
        if (r.where === 'after') t.parentNode.insertBefore(w, t.nextSibling); else if (r.where === 'prepend') t.insertBefore(w, t.firstChild); else t.appendChild(w);
      });
    }
    apply(); var q = null;
    try { new MutationObserver(function () { if (q) return; q = setTimeout(function () { q = null; apply(); }, 120); }).observe(document.body, { childList: true, subtree: true }); } catch (e) { setInterval(apply, 1500); }
  }
  window.R4UGuide = { list: G, open: function (s, t) { render(s, t); }, gallery: gallery, chip: chip, auto: auto, close: close };
  try { var m = /[?&]guide=([a-z-]+)/.exec(location.search); if (m && (by(m[1]) || m[1] === 'all')) { var go = function () { m[1] === 'all' ? gallery() : render(m[1], 0, false); }; if (document.readyState === 'complete') go(); else window.addEventListener('load', go); } } catch (e) {}
})();
