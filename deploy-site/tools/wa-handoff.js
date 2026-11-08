/* wa-handoff.js — "Continue on WhatsApp" for people who can't open WhatsApp on
 * this device. Phones: open wa.me as before. Desktop: ask for their WhatsApp
 * number and we message them first (/.netlify/functions/wa-optin), with
 * "scan a QR" and "WhatsApp on this computer" as alternatives.
 *
 *   R4UWa.open({ intent:'alerts'|'resume'|'interview', url:'https://wa.me/..',
 *                title, sub, role, city, name, done:'Reply JOBS to see today’s jobs.' })
 *   R4UWa.isDesktop()
 * Used by the builder (index.html), /whatsapp-job-alerts/ and /interview-prep/.
 */
(function () {
  if (window.R4UWa) return;
  var BOT = '+91\u00a093090\u00a014196';
  var WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z';
  var WA_SVG = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="' + WA_PATH + '"/></svg>';
  var QR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>';
  var PC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  var OK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  var CSS =
    '.r4wa-ov{position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .18s ease;}' +
    '.r4wa-ov.on{opacity:1;}' +
    '.r4wa-card{position:relative;width:100%;max-width:468px;background:var(--card-bg,var(--card,#fff));color:var(--text,#1a1a1a);border-radius:20px;padding:26px 26px 22px;box-shadow:0 24px 70px -20px rgba(0,0,0,.45);font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transform:translateY(8px) scale(.98);transition:transform .2s ease;}' +
    '.r4wa-ov.on .r4wa-card{transform:none;}' +
    '.r4wa-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--muted,#6b7280);font-size:22px;line-height:1;cursor:pointer;}' +
    '.r4wa-x:hover{background:rgba(0,0,0,.05);}' +
    '.r4wa-hd{display:flex;gap:14px;align-items:flex-start;margin-bottom:18px;padding-right:22px;}' +
    '.r4wa-ic{flex:0 0 46px;width:46px;height:46px;border-radius:13px;background:linear-gradient(145deg,#25d366,#128c7e);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px -6px rgba(18,140,126,.6);}' +
    '.r4wa-ic svg{width:25px;height:25px;}' +
    '.r4wa-hd h3{margin:0 0 3px;font-size:1.1rem;font-weight:700;letter-spacing:-.01em;line-height:1.3;text-wrap:balance;}' +
    '.r4wa-hd p{margin:0;font-size:.88rem;color:var(--muted,#6b7280);}' +
    '.r4wa-lbl{display:block;font-size:.8rem;font-weight:600;margin:0 0 6px;}' +
    '.r4wa-ph{display:flex;align-items:stretch;border:1.5px solid var(--input-border,#d5d5cf);border-radius:12px;background:var(--input-bg,#fff);overflow:hidden;transition:border-color .15s,box-shadow .15s;}' +
    '.r4wa-ph:focus-within{border-color:#128c7e;box-shadow:0 0 0 4px rgba(18,140,126,.14);}' +
    '.r4wa-ph.bad{border-color:#dc2626;box-shadow:0 0 0 4px rgba(220,38,38,.1);}' +
    '.r4wa-cc{display:flex;align-items:center;padding:0 12px;font-weight:600;font-size:.95rem;color:var(--text,#1a1a1a);background:rgba(0,0,0,.035);border-right:1px solid var(--input-border,#e5e5e0);font-variant-numeric:tabular-nums;}' +
    '.r4wa-ph.intl .r4wa-cc{display:none;}' +
    '.r4wa-ph input{flex:1;min-width:0;border:0;outline:0;background:transparent;padding:13px 14px;font:inherit;font-size:1rem;letter-spacing:.02em;color:inherit;font-variant-numeric:tabular-nums;}' +
    '.r4wa-hint{font-size:.75rem;color:var(--muted,#6b7280);margin:6px 0 0;}' +
    '.r4wa-err{display:none;font-size:.8rem;color:#b91c1c;margin:7px 0 0;}' +
    '.r4wa-err.on{display:block;}' +
    '.r4wa-go{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;margin-top:16px;padding:14px 16px;border:0;border-radius:12px;cursor:pointer;font:inherit;font-weight:700;font-size:.98rem;color:#fff;background:linear-gradient(135deg,#25d366,#1aa851);box-shadow:0 10px 22px -12px rgba(26,168,81,.9);transition:transform .12s,filter .15s;}' +
    '.r4wa-go:hover{filter:brightness(1.04);}.r4wa-go:active{transform:translateY(1px);}' +
    '.r4wa-go svg{width:19px;height:19px;flex:0 0 19px;}' +
    '.r4wa-go[disabled]{opacity:.75;cursor:progress;}' +
    '.r4wa-spin{width:17px;height:17px;border:2.5px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:r4wa-sp .7s linear infinite;}' +
    '@keyframes r4wa-sp{to{transform:rotate(360deg)}}' +
    '.r4wa-fine{font-size:.74rem;color:var(--muted,#6b7280);text-align:center;margin:10px 0 0;line-height:1.45;}' +
    '.r4wa-or{display:flex;align-items:center;gap:12px;margin:18px 0 12px;font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#9ca3af);}' +
    '.r4wa-or:before,.r4wa-or:after{content:"";flex:1;height:1px;background:var(--border,#e5e5e0);}' +
    '.r4wa-alt{display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
    '.r4wa-alt.one{grid-template-columns:1fr;}' +
    '.r4wa-alt button,.r4wa-alt a{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 10px;border:1.5px solid var(--border,#e5e5e0);border-radius:11px;background:transparent;color:var(--text,#1a1a1a);font:inherit;font-size:.84rem;font-weight:600;text-decoration:none;cursor:pointer;transition:border-color .15s,background .15s;}' +
    '.r4wa-alt button:hover,.r4wa-alt a:hover{border-color:#128c7e;background:rgba(18,140,126,.05);}' +
    '.r4wa-alt svg{width:17px;height:17px;flex:0 0 17px;color:#128c7e;}' +
    '.r4wa-done{text-align:center;padding:8px 4px 2px;}' +
    '.r4wa-done .r4wa-tick{width:58px;height:58px;margin:0 auto 14px;border-radius:50%;background:linear-gradient(145deg,#25d366,#128c7e);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px -10px rgba(18,140,126,.8);}' +
    '.r4wa-done .r4wa-tick svg{width:28px;height:28px;}' +
    '.r4wa-done h3{margin:0 0 6px;font-size:1.15rem;font-weight:700;}' +
    '.r4wa-done p{margin:0 auto;max-width:320px;font-size:.9rem;color:var(--muted,#6b7280);}' +
    '.r4wa-done p b{color:var(--text,#1a1a1a);}' +
    '.r4wa-done .r4wa-step{margin:16px 0 0;padding:12px 14px;border-radius:12px;background:rgba(37,211,102,.09);color:var(--text,#1a1a1a);font-size:.88rem;text-align:left;display:flex;gap:10px;align-items:center;}' +
    '.r4wa-done .r4wa-step svg{width:20px;height:20px;flex:0 0 20px;}' +
    '.r4wa-done .r4wa-ok{margin-top:16px;width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--border,#e5e5e0);background:transparent;font:inherit;font-weight:700;cursor:pointer;color:var(--text,#1a1a1a);}' +
    '.r4wa-card button:focus-visible,.r4wa-card a:focus-visible{outline:3px solid rgba(18,140,126,.45);outline-offset:2px;}' +
    '.r4wa-qrbox{display:flex;flex-direction:column;align-items:center;gap:10px;margin:2px 0 4px;}' +
    '.r4wa-qrfr{padding:12px;border-radius:16px;background:#fff;border:1.5px solid var(--border,#e5e5e0);box-shadow:0 8px 24px -16px rgba(0,0,0,.35);line-height:0;}' +
    '.r4wa-qrfr canvas{width:196px;height:196px;image-rendering:pixelated;display:block;}' +
    '.r4wa-steps{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:7px;font-size:.86rem;}' +
    '.r4wa-steps li{display:flex;gap:10px;align-items:center;}' +
    '.r4wa-steps b.n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:rgba(37,211,102,.14);color:#0f7a5f;font-size:.72rem;display:flex;align-items:center;justify-content:center;}' +
    '.r4wa-free{margin:12px 0 0;text-align:center;font-size:.74rem;color:var(--muted,#6b7280);}' +
    'a.r4wa-go{text-decoration:none;}' +
    '@media (prefers-reduced-motion:reduce){.r4wa-ov,.r4wa-card{transition:none}.r4wa-spin{animation-duration:1.6s}}' +
    '@media (max-width:480px){.r4wa-card{padding:22px 18px 18px}.r4wa-alt{grid-template-columns:1fr}}';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Big screen = laptop/desktop or tablet (iPad reports a touch pointer, so it must not
  // be treated as a phone). Phones have a short side under ~500px.
  function isDesktop() { try { return Math.min(screen.width, screen.height) >= 700 || window.matchMedia('(min-width:769px) and (pointer:fine)').matches; } catch (e) { return false; } }
  function isTouch() { try { return window.matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 1; } catch (e) { return false; } }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  // Client-side check mirrors the server's: 10-digit Indian mobile, or + country code.
  function valid(v) {
    var t = String(v || '').trim(), d = digits(t);
    if (/^(\+|00)/.test(t)) return d.replace(/^00/, '').length >= 11 && d.length <= 15;
    if (d.length === 12 && /^91[6-9]/.test(d)) return true;
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    return d.length === 10 && /^[6-9]/.test(d);
  }

  /* Which intents can use "send to my number" (needs a Meta payment method and
     the template; the server says so). Fetched once per tab; until known, or when
     off, the dialog leads with the QR code — the user sends the first message,
     which is free. */
  var avail = null;
  try { avail = JSON.parse(sessionStorage.getItem('_r4uWaAvail') || 'null'); } catch (e) {}
  function loadAvail() {
    if (avail) return Promise.resolve(avail);
    return fetch('/.netlify/functions/wa-optin', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; }).then(function (j) { avail = j || {}; try { sessionStorage.setItem('_r4uWaAvail', JSON.stringify(avail)); } catch (e) {} return avail; });
  }
  function numberOn(intent) { return !!(avail && avail[intent]); }
  function qrLib() {
    if (window._r4uQRlib) return Promise.resolve(window._r4uQRlib);
    return new Promise(function (res) { var sc = document.createElement('script'); sc.src = '/tools/qrlib.js?v=1'; sc.onload = function () { res(window._r4uQRlib || null); }; sc.onerror = function () { res(null); }; document.head.appendChild(sc); });
  }
  function drawQR(host, text) {
    qrLib().then(function (L) {
      if (!L || !host) return;
      var q; try { q = L(0, 'M'); q.addData(String(text)); q.make(); } catch (e) { return; }
      var n = q.getModuleCount(), qz = 4, cell = 8, size = (n + qz * 2) * cell;
      var cv = document.createElement('canvas'); cv.width = cv.height = size; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'QR code to open WhatsApp');
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#111';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect((x + qz) * cell, (y + qz) * cell, cell, cell);
      host.innerHTML = ''; host.appendChild(cv);
    });
  }
  function optin(payload) {
    return fetch('/.netlify/functions/wa-optin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { status: 'error' }; }); })
      .catch(function () { return { status: 'network' }; });
  }

  var ov = null, lastFocus = null;
  function close() {
    if (!ov) return;
    var o = ov; ov = null; o.classList.remove('on');
    setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 200);
    document.removeEventListener('keydown', onKey, true);
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {}
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab' && ov) {   // keep focus inside the dialog
      var f = ov.querySelectorAll('button:not([disabled]),a[href],input');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function qrFallback(o) {
    if (isTouch()) { close(); window.open(o.url, '_blank', 'noopener'); return true; }
    if (typeof window._r4uShowQR === 'function') {
      close();
      window._r4uShowQR(o.url, { title: o.title || 'Continue on WhatsApp', sub: 'Scan with your phone’s camera to open WhatsApp — your message is ready, just tap Send.', file: 'whatsapp-qr.png' });
      return true;
    }
    return false;
  }

  function open(o) {
    o = o || {};
    if (!isDesktop()) { window.open(o.url, '_blank', 'noopener'); return; }
    if (!o.mode) o.mode = numberOn(o.intent) ? 'form' : 'qr';
    if (!document.getElementById('r4wa-css')) { var st = document.createElement('style'); st.id = 'r4wa-css'; st.textContent = CSS; document.head.appendChild(st); }
    close();
    lastFocus = document.activeElement;
    var saved = lsGet('_r4uWaPhone'), touch = isTouch(), canQR = !touch && typeof window._r4uShowQR === 'function';
    ov = document.createElement('div');
    ov.className = 'r4wa-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'r4wa-t');
    var deviceName = /iPad|Macintosh/.test(navigator.userAgent) ? 'iPad' : 'tablet';
    var qrBody =
        '<div class="r4wa-hd"><span class="r4wa-ic">' + WA_SVG + '</span><div><h3 id="r4wa-t">' + esc(o.title || 'Continue on WhatsApp') + '</h3><p>' + esc(o.qrSub || o.sub || '') + '</p></div></div>' +
        (touch
          ? '<a class="r4wa-go" href="' + esc(o.url) + '" target="_blank" rel="noopener">' + WA_SVG + '<span>Open WhatsApp on this ' + deviceName + '</span></a>' +
            '<div class="r4wa-or"><span>or scan with your phone</span></div><div class="r4wa-qrbox"><div class="r4wa-qrfr" id="r4wa-qr"></div></div>'
          : '<div class="r4wa-qrbox"><div class="r4wa-qrfr" id="r4wa-qr"></div></div>' +
            '<ol class="r4wa-steps"><li><b class="n">1</b><span>Scan with your phone\u2019s camera</span></li><li><b class="n">2</b><span>WhatsApp opens with your message ready \u2014 tap <b>Send</b></span></li></ol>' +
            '<div class="r4wa-or"><span>or</span></div><div class="r4wa-alt one"><a class="r4wa-web" href="' + esc(o.url) + '" target="_blank" rel="noopener">' + PC_SVG + 'Use WhatsApp Web on this computer</a></div>') +
        '<p class="r4wa-free">Free \u00b7 you send the first message, so you stay in control.' + (o.intent === 'alerts' ? ' Reply <b>stop alerts</b> anytime.' : '') + '</p>';
    if (o.mode === 'qr') {
      ov = document.createElement('div');
      ov.className = 'r4wa-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'r4wa-t');
      ov.innerHTML = '<div class="r4wa-card"><button type="button" class="r4wa-x" aria-label="Close">\u00d7</button><div class="r4wa-body">' + qrBody + '</div></div>';
      document.body.appendChild(ov);
      requestAnimationFrame(function () { if (ov) ov.classList.add('on'); });
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.r4wa-x').addEventListener('click', close);
      drawQR(ov.querySelector('#r4wa-qr'), o.url);
      setTimeout(function () { try { ov.querySelector('.r4wa-x').focus(); } catch (e) {} }, 60);
      return;
    }
    canQR = !touch;
    ov.innerHTML =
      '<div class="r4wa-card"><button type="button" class="r4wa-x" aria-label="Close">×</button>' +
      '<div class="r4wa-body">' +
        '<div class="r4wa-hd"><span class="r4wa-ic">' + WA_SVG + '</span><div><h3 id="r4wa-t">' + esc(o.title || 'Continue on WhatsApp') + '</h3><p>' + esc(o.sub || 'We’ll message you on WhatsApp — reply on your phone to continue.') + '</p></div></div>' +
        '<form class="r4wa-form" novalidate>' +
          '<label class="r4wa-lbl" for="r4wa-ph">Your WhatsApp number</label>' +
          '<div class="r4wa-ph"><span class="r4wa-cc" aria-hidden="true">+91</span><input id="r4wa-ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210" maxlength="18" value="' + esc(saved) + '" aria-describedby="r4wa-hint r4wa-err"></div>' +
          '<p class="r4wa-hint" id="r4wa-hint">Outside India? Start with + and your country code.</p>' +
          '<div class="r4wa-err" id="r4wa-err" role="alert"></div>' +
          '<button type="submit" class="r4wa-go">' + WA_SVG + '<span>Send to my WhatsApp</span></button>' +
          '<p class="r4wa-fine">You’ll get one WhatsApp message from Resume For You (' + BOT + '). ' + (o.intent === 'alerts' ? 'Reply <b>stop alerts</b> anytime.' : 'Nothing else unless you reply.') + '</p>' +
        '</form>' +
        '<div class="r4wa-or"><span>or</span></div>' +
        '<div class="r4wa-alt' + (canQR ? '' : ' one') + '">' +
          (canQR ? '<button type="button" class="r4wa-qr">' + QR_SVG + 'Scan a QR code</button>' : '') +
          '<a class="r4wa-web" href="' + esc(o.url) + '" target="_blank" rel="noopener">' + (touch ? WA_SVG.replace('fill="#fff"', 'fill="#128c7e"') + 'Open WhatsApp on this ' + (/iPad|Macintosh/.test(navigator.userAgent) ? 'iPad' : 'tablet') : PC_SVG + 'Use WhatsApp Web') + '</a>' +
        '</div>' +
      '</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { if (ov) ov.classList.add('on'); });
    document.addEventListener('keydown', onKey, true);

    var card = ov.querySelector('.r4wa-card'), input = ov.querySelector('#r4wa-ph'), box = ov.querySelector('.r4wa-ph');
    var err = ov.querySelector('.r4wa-err'), go = ov.querySelector('.r4wa-go');
    function intl() { box.classList.toggle('intl', /^\s*(\+|00)/.test(input.value)); }
    function showErr(m) { err.textContent = m; err.classList.add('on'); box.classList.add('bad'); }
    intl();
    input.addEventListener('input', function () { intl(); err.classList.remove('on'); box.classList.remove('bad'); });
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.r4wa-x').addEventListener('click', close);
    var qb = ov.querySelector('.r4wa-qr'); if (qb) qb.addEventListener('click', function () { o.mode = 'qr'; open(o); });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);

    ov.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!valid(v)) { showErr('Enter a valid WhatsApp number, e.g. 98765 43210.'); input.focus(); return; }
      lsSet('_r4uWaPhone', v);
      go.disabled = true; go.innerHTML = '<span class="r4wa-spin" aria-hidden="true"></span><span>Sending…</span>';
      var p = /^\s*(\+|00)/.test(v) ? digits(v).replace(/^00/, '') : v;
      optin({ phone: p, intent: o.intent, role: o.role || '', city: o.city || '', name: o.name || '' }).then(function (r) {
        if (!ov) return;
        var st = r && r.status;
        if (st === 'sent' || st === 'already') { done(st, r.masked); return; }
        go.disabled = false; go.innerHTML = WA_SVG + '<span>Send to my WhatsApp</span>';
        if (st === 'unavailable') { avail = null; try { sessionStorage.removeItem('_r4uWaAvail'); } catch (e) {} o.mode = 'qr'; open(o); return; } if (false) { showErr('Sending to your number isn’t available right now. Use “WhatsApp on this computer” or open WhatsApp on your phone.'); return; }
        if (st === 'network') { showErr('No connection. Check your internet and try again.'); return; }
        showErr((r && r.error) || 'Something went wrong. Please try again.');
      });
    });

    function done(st, masked) {
      var body = card.querySelector('.r4wa-body');
      body.innerHTML =
        '<div class="r4wa-done" role="status">' +
          '<div class="r4wa-tick">' + OK_SVG + '</div>' +
          '<h3 id="r4wa-t">' + (st === 'already' ? 'Already on its way' : 'Check WhatsApp on your phone') + '</h3>' +
          '<p>' + (st === 'already' ? 'We messaged <b>' + esc(masked) + '</b> in the last few hours.' : 'We’ve sent a message to <b>' + esc(masked) + '</b> from Resume For You.') + '</p>' +
          (o.done ? '<div class="r4wa-step">' + '<span class="r4wa-ic" style="flex:0 0 30px;width:30px;height:30px;border-radius:9px;box-shadow:none">' + WA_SVG + '</span><span>' + o.done + '</span></div>' : '') +
          '<button type="button" class="r4wa-ok">Done</button>' +
        '</div>';
      body.querySelector('.r4wa-ok').addEventListener('click', close);
      setTimeout(function () { try { body.querySelector('.r4wa-ok').focus(); } catch (e) {} }, 60);
      if (typeof o.onSent === 'function') try { o.onSent(st); } catch (e) {}
    }
  }

  window.R4UWa = { open: open, close: close, isDesktop: isDesktop, isTouch: isTouch, valid: valid, optin: optin, numberOn: numberOn, loadAvail: loadAvail };
  if (isDesktop()) loadAvail();
})();
