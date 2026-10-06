/* Shared product-rating badge for the marketing/landing pages. Reads the genuine
   aggregate (aggregates/productRating) and, only when there is a real rating
   count >= THRESHOLD, renders a "★ x.x (N ratings)" badge and injects
   AggregateRating JSON-LD so Google can show star snippets. Never fabricated.
   Inserts the badge after the page's first <h1> (or into #r4uRatingBadge if present). */
(function () {
  var THRESHOLD = 1;
  var FS = 'https://firestore.googleapis.com/v1/projects/resume-ai-2eda1/databases/(default)/documents/aggregates/productRating?key=AIzaSyDUgpJQ8PbQgwqj1EUAe9Va4iG8BnNQm10';
  function fmt(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function css() {
    if (document.getElementById('_r4uRbCss')) return;
    var s = document.createElement('style'); s.id = '_r4uRbCss';
    s.textContent =
      '.r4u-rb{display:inline-flex;align-items:center;gap:8px;margin:14px auto 0;padding:7px 14px;'
      + 'background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.32);border-radius:22px;'
      + 'font-size:.9rem;line-height:1;font-family:inherit;}'
      + '.r4u-rb .r4u-rb-st{position:relative;display:inline-block;font-size:1rem;letter-spacing:1px;color:#d9d4c7;white-space:nowrap;}'
      + '.r4u-rb .r4u-rb-fl{position:absolute;top:0;left:0;overflow:hidden;color:#f59e0b;white-space:nowrap;}'
      + '.r4u-rb .r4u-rb-nm{font-weight:800;color:inherit;}'
      + '.r4u-rb .r4u-rb-ct{opacity:.7;font-size:.82rem;}';
    document.head.appendChild(s);
  }

  function render(avg, count) {
    avg = Math.round(avg * 10) / 10;
    var pct = Math.max(0, Math.min(100, (avg / 5) * 100));
    css();
    var slot = document.getElementById('r4uRatingBadge');
    var badge = document.createElement('div');
    badge.className = 'r4u-rb';
    badge.setAttribute('aria-label', avg.toFixed(1) + ' out of 5 stars from ' + fmt(count) + ' ratings');
    badge.innerHTML =
      '<span class="r4u-rb-st" aria-hidden="true"><span class="r4u-rb-fl" style="width:' + pct + '%">★★★★★</span>★★★★★</span>'
      + '<span class="r4u-rb-nm">' + avg.toFixed(1) + '</span>'
      + '<span class="r4u-rb-ct">(' + fmt(count) + ' rating' + (count === 1 ? '' : 's') + ')</span>';
    if (slot) { slot.appendChild(badge); }
    else {
      var h1 = document.querySelector('h1');
      if (h1 && h1.parentNode) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'text-align:center;';
        wrap.appendChild(badge);
        h1.parentNode.insertBefore(wrap, h1.nextSibling);
      }
    }
    try {
      var ld = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Resume For You',
        applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: 'https://resume4u.help/',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: avg.toFixed(1), ratingCount: String(count), bestRating: '5', worstRating: '1' } };
      var sc = document.createElement('script'); sc.type = 'application/ld+json'; sc.id = '_r4uRbLd';
      sc.textContent = JSON.stringify(ld); document.head.appendChild(sc);
    } catch (e) {}
  }

  try {
    fetch(FS, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.fields) return;
      var sum = parseInt((d.fields.sum && d.fields.sum.integerValue) || '0', 10);
      var count = parseInt((d.fields.count && d.fields.count.integerValue) || '0', 10);
      if (count >= THRESHOLD && sum > 0) render(sum / count, count);
    }).catch(function () {});
  } catch (e) {}
})();
