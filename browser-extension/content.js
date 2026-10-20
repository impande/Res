/* Resume4U "Tailor to this job" — content script.
 *
 * On a supported job page (LinkedIn / Naukri / Internshala / Indeed) this adds a
 * small floating button. Tapping it grabs the job-description text from the page
 * and opens resume4u.help/?jd=<the posting>, which auto-fills the site's existing
 * "Tailor to a job description" flow (the `_r4uIncomingJdJS` hook in the app).
 *
 * No permissions beyond the matched sites; it only reads the DOM and opens a tab.
 */
(function () {
  'use strict';
  var SITE = 'https://resume4u.help/';
  var MAX = 6000;

  // Site-specific places the job description usually lives, best-first.
  var SELECTORS = [
    '#job-details',                         // LinkedIn
    '.jobs-description__content',           // LinkedIn
    '.jobs-box__html-content',              // LinkedIn
    '.styles_JDC__dang-inner-html__h0K4t',  // Naukri
    '.job-desc', 'section.styles_job-desc__container__dnf3P', // Naukri
    '.internship_details', '.detail_view',  // Internshala
    '#jobDescriptionText'                   // Indeed
  ];

  function clean(t) {
    return (t || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function extractJD() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var el = document.querySelector(SELECTORS[i]);
      if (el && (el.innerText || '').trim().length > 200) return clean(el.innerText);
    }
    // Fallback: the largest visible text block on the page.
    var best = '', bestLen = 0;
    var blocks = document.querySelectorAll('article, section, div[class*="desc" i], div[class*="detail" i]');
    for (var j = 0; j < blocks.length; j++) {
      var txt = (blocks[j].innerText || '').trim();
      if (txt.length > bestLen && txt.length < 20000) { bestLen = txt.length; best = txt; }
    }
    return bestLen > 200 ? clean(best) : '';
  }

  function openTailor() {
    var jd = extractJD();
    if (!jd) {
      alert('Couldn’t find the job description on this page. Open the full posting, then try again.');
      return;
    }
    window.open(SITE + '?jd=' + encodeURIComponent(jd.slice(0, MAX)), '_blank', 'noopener');
  }

  function mountButton() {
    if (document.getElementById('r4u-tailor-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'r4u-tailor-fab';
    btn.type = 'button';
    btn.textContent = '🎯 Tailor my résumé';
    btn.setAttribute('aria-label', 'Tailor my resume to this job on Resume4U');
    btn.style.cssText = [
      'position:fixed', 'z-index:2147483646', 'right:18px', 'bottom:18px',
      'padding:12px 16px', 'border:0', 'border-radius:999px', 'cursor:pointer',
      'font:700 14px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif', 'color:#fff',
      'background:linear-gradient(135deg,#f59e0b,#b45309)',
      'box-shadow:0 8px 22px -8px rgba(180,83,9,.7)', 'transition:transform .12s ease'
    ].join(';');
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'translateY(-2px)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'none'; });
    btn.addEventListener('click', openTailor);
    document.body.appendChild(btn);
  }

  // Job sites are SPAs — re-check as the user navigates between postings.
  mountButton();
  setInterval(mountButton, 1500);
})();
