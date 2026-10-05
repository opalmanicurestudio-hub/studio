/* Book buttons and a live menu for any website.
   <script src="https://YOUR-APP/embed.js" data-business="BUSINESS_ID"></script>
   Buttons:  <a class="cf-book" data-service="SERVICE_ID">Book now</a>   (also data-category="…" or data-provider="…")
   Menu:     <div data-cf-menu data-theme="light|dark" data-layout="list|cards" data-categories="Manicures,Pedicures"></div>
   Tapping Book opens the booking flow in an overlay on this page (or a new tab if the overlay can't open). */
(function () {
  var S = document.currentScript; if (!S) return;
  var base = S.src.replace(/\/embed\.js(\?.*)?$/, ''); var biz = S.getAttribute('data-business') || '';
  var menuCache = null; var css = false;
  function style(accent) {
    if (css) return; css = true; var st = document.createElement('style');
    st.textContent = '.cf-btn{display:inline-block;background:' + accent + ';color:#fff;border-radius:999px;padding:12px 20px;font:600 15px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;cursor:pointer;border:0}.cf-btn:hover{filter:brightness(1.08)}' +
      '.cf-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px}.cf-ov iframe{width:min(960px,100%);height:min(92vh,900px);border:0;border-radius:20px;background:#fff}.cf-x{position:absolute;top:12px;right:14px;width:40px;height:40px;border-radius:999px;border:0;background:#fff;font:600 20px system-ui;cursor:pointer}' +
      '.cf-menu{font:15px/1.4 system-ui,-apple-system,sans-serif;color:#1c1917}.cf-menu[data-theme=dark]{color:#f5f5f4}.cf-menu h3{font-size:18px;margin:24px 0 8px}.cf-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid rgba(128,128,128,.25)}.cf-row b{display:block;font-size:16px}.cf-row small{display:block;opacity:.7}.cf-row .cf-p{margin-left:auto;font-weight:600;white-space:nowrap}' +
      '.cf-menu[data-layout=cards] .cf-cat{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.cf-menu[data-layout=cards] .cf-row{flex-direction:column;align-items:flex-start;border:1px solid rgba(128,128,128,.25);border-radius:16px;padding:16px}.cf-menu[data-layout=cards] .cf-row .cf-p{margin-left:0}.cf-menu[data-layout=cards] .cf-row img{width:100%;height:140px;object-fit:cover;border-radius:12px}';
    document.head.appendChild(st);
  }
  function url(x) { var q = []; if (x.service) q.push('service=' + encodeURIComponent(x.service)); if (x.category) q.push('category=' + encodeURIComponent(String(x.category).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))); if (x.provider) q.push('provider=' + encodeURIComponent(x.provider)); q.push('src=website');
    return (x.base || base + '/book/' + encodeURIComponent(biz)) + '?' + q.join('&'); }
  function open(u) {
    try { var ov = document.createElement('div'); ov.className = 'cf-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Book an appointment');
      var fr = document.createElement('iframe'); fr.src = u + '&embed=1'; fr.setAttribute('title', 'Booking'); fr.setAttribute('allow', 'payment *');
      var x = document.createElement('button'); x.className = 'cf-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
      function close() { ov.remove(); document.removeEventListener('keydown', esc); } function esc(e) { if (e.key === 'Escape') close(); }
      x.onclick = close; ov.onclick = function (e) { if (e.target === ov) close(); }; document.addEventListener('keydown', esc);
      ov.appendChild(fr); ov.appendChild(x); document.body.appendChild(ov); } catch (e) { window.open(u, '_blank'); }
  }
  function wire(el, x) { var u = url(x); if (el.tagName === 'A') el.href = u; el.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); open(u); }); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function menu(el) {
    var cats = el.getAttribute('data-categories') || ''; el.className += ' cf-menu'; el.textContent = 'Loading…';
    fetch(base + '/api/public/menu?business=' + encodeURIComponent(biz) + (cats ? '&categories=' + encodeURIComponent(cats) : '')).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { el.textContent = ''; return; } style(d.business.accent); el.textContent = '';
      d.categories.forEach(function (c) { var h = document.createElement('h3'); h.textContent = c.name; el.appendChild(h); var wrap = document.createElement('div'); wrap.className = 'cf-cat'; el.appendChild(wrap);
        c.services.forEach(function (s) { var row = document.createElement('div'); row.className = 'cf-row';
          if (el.getAttribute('data-layout') === 'cards' && s.imageUrl) { var im = document.createElement('img'); im.src = s.imageUrl; im.alt = ''; row.appendChild(im); }
          var t = document.createElement('div'); var b = document.createElement('b'); b.textContent = s.name; t.appendChild(b); var sm = document.createElement('small'); sm.textContent = (s.duration ? s.duration + ' min' : '') + (s.description ? (s.duration ? ' · ' : '') + s.description : ''); t.appendChild(sm); row.appendChild(t);
          var p = document.createElement('span'); p.className = 'cf-p'; p.textContent = (s.from ? 'from ' : '') + money(s.price); row.appendChild(p);
          var a = document.createElement('a'); a.className = 'cf-btn'; a.textContent = 'Book'; wire(a, { service: s.id, base: d.bookBase }); row.appendChild(a); wrap.appendChild(row); }); });
      // Rentable spaces (rooms, saunas, equipment) — by the hour or day.
      if ((d.spaces || []).length) { var h2 = document.createElement('h3'); h2.textContent = 'Spaces'; el.appendChild(h2); var w2 = document.createElement('div'); w2.className = 'cf-cat'; el.appendChild(w2);
        d.spaces.forEach(function (sp) { var row = document.createElement('div'); row.className = 'cf-row';
          if (el.getAttribute('data-layout') === 'cards' && sp.imageUrl) { var im = document.createElement('img'); im.src = sp.imageUrl; im.alt = ''; row.appendChild(im); }
          var t = document.createElement('div'); var b = document.createElement('b'); b.textContent = sp.name; t.appendChild(b); if (sp.description) { var sm = document.createElement('small'); sm.textContent = sp.description; t.appendChild(sm); } row.appendChild(t);
          var p = document.createElement('span'); p.className = 'cf-p'; p.textContent = [sp.hourly != null ? money(sp.hourly) + '/hr' : null, sp.daily != null ? money(sp.daily) + '/day' : null].filter(Boolean).join(' · '); row.appendChild(p);
          var a = document.createElement('a'); a.className = 'cf-btn'; a.textContent = 'Book'; var u = d.bookBase + '?space=' + encodeURIComponent(sp.id) + '&src=website#spaces'; a.href = u;
          a.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); open(u.replace('#spaces', '')); }); row.appendChild(a); w2.appendChild(row); }); }
    }).catch(function () { el.textContent = ''; });
  }
  function init() {
    var btns = document.querySelectorAll('.cf-book,[data-cf-book]'); if (btns.length) { style(S.getAttribute('data-accent') || '#1c1917'); }
    btns.forEach(function (el) { if (!el.className.match(/\bcf-btn\b/)) el.className += ' cf-btn'; wire(el, { service: el.getAttribute('data-service'), category: el.getAttribute('data-category'), provider: el.getAttribute('data-provider') }); });
    document.querySelectorAll('[data-cf-menu]').forEach(menu);
  }
  window.CFBook = { open: function (x) { open(url(x || {})); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
