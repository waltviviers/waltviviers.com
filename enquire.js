/* ============================================================================
   enquire.js — the Enquire pop-up form and the mobile "Enquire Now" button,
   shared site-wide.
   ----------------------------------------------------------------------------
   Loading: chrome.js injects this file on every page it runs on; pages
   without chrome.js (the home page, app landing pages) include it directly:
     <script defer src="/enquire.js"></script>
   Anything with class "gx-open" opens the form, as do the page's own
   [data-i18n="nav-enquire"] links; window.wvEnquire.open() works too.
   To leave the form off a page, add its path to HIDE_ON below.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__wvEnquire) return;
  window.__wvEnquire = true;

  /* Pages (path prefixes) without the Enquire form and button. */
  var HIDE_ON = [
    '/blog/', '/artist-bio/', '/privacy/', '/graphic-design-portfolio/',
    '/master-cv/', '/budtender-cv/', '/senior-graphic-design-cv/',
    '/consignment-note/', '/artist-gallery-agreement/',
    '/admin', '/clients/', '/apps/chopped-beats/', '/apps/scritch-scratch/play/',
    '/apps/billtipper/privacy-policy/', '/apps/neurotrace/privacy-policy/', '/apps/neurotracer/privacy-policy/'
  ];
  var path = location.pathname;
  for (var i = 0; i < HIDE_ON.length; i++) if (path.indexOf(HIDE_ON[i]) === 0) return;

  var CSS = ".gx-fab { display: none; }\n@media (max-width: 900px) {\n.gx-fab { display: inline-block; position: fixed; right: 16px; bottom: 26px; z-index: 250; background: var(--ink); color: var(--bg); border: none; padding: 13px 22px; border-radius: 40px; font-family: var(--sans); font-size: 12px; font-weight: 500; letter-spacing: 0.10em; text-transform: uppercase; cursor: pointer; box-shadow: 0 6px 22px rgba(0,0,0,0.4); }\n}\n.gx-modal { position: fixed; inset: 0; z-index: 400; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); padding: 24px; }\n.gx-modal.open { display: flex; }\n.gx-box { background: var(--bg2); border: 1px solid var(--rule); width: 100%; max-width: 480px; padding: 44px 40px 40px; position: relative; max-height: 90vh; overflow-y: auto; }\n.gx-close { position: absolute; top: 12px; right: 16px; font-size: 28px; line-height: 1; color: var(--stone); background: none; border: none; cursor: pointer; }\n.gx-close:hover { color: var(--ink); }\n.gx-box h2 { font-family: var(--serif); font-size: 2rem; font-weight: 400; line-height: 1.1; margin-bottom: 10px; }\n.gx-sub { color: var(--stone); font-size: 14px; line-height: 1.6; margin-bottom: 24px; }\n.gx-field { margin-bottom: 16px; }\n.gx-field label { display: block; font-size: 11px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--stone); margin-bottom: 8px; }\n.gx-field input, .gx-field textarea, .gx-field select { width: 100%; background: var(--bg); border: 1px solid var(--rule); color: var(--ink); padding: 12px 14px; font: inherit; font-size: 14px; border-radius: 0; }\n.gx-field input:focus, .gx-field textarea:focus, .gx-field select:focus { border-color: var(--stone); outline: none; }\n.gx-submit { display: block; width: 100%; text-align: center; padding: 14px; margin-top: 8px; background: var(--ink); color: var(--bg); font-size: 12px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; border: 1px solid var(--ink); cursor: pointer; transition: background 0.2s, color 0.2s; }\n.gx-submit:hover { background: transparent; color: var(--ink); }\n.gx-err { color: #c0392b; font-size: 0.82rem; margin-top: 10px; text-align: center; }\n.gx-success { text-align: center; }\n.gx-success p { color: var(--stone); margin-bottom: 22px; }\n[data-theme=\"light\"] .gx-box { background: #F5F3EF; }\n[data-theme=\"light\"] .gx-field input, [data-theme=\"light\"] .gx-field textarea, [data-theme=\"light\"] .gx-field select { background: #FAF9F7; border-color: #D5D1CB; color: #0C0C0B; }\n[data-theme=\"light\"] .gx-submit { background: #0C0C0B; color: #FAF9F7; }" +
    /* Lift the button with the home page's privacy notice; hide it under the menu */
    'body.privacy-visible .gx-fab{bottom:max(101px,calc(var(--privacy-h,48px) + 39px));}' +
    'body.menu-open .gx-fab{display:none !important;}';

  var FAB = "<button type=\"button\" class=\"gx-fab gx-open\" aria-label=\"Enquire now\">Enquire Now</button>";
  var MODAL = "<div class=\"gx-modal\" id=\"gx-enquire\" role=\"dialog\" aria-modal=\"true\" aria-hidden=\"true\" aria-label=\"Enquire\">\n<div class=\"gx-box\">\n<button class=\"gx-close\" type=\"button\" aria-label=\"Close\">&times;</button>\n<h2>Enquire</h2>\n<p class=\"gx-sub\">Commissions, original artworks, photography &amp; video bookings, gallery representation \u2014 tell me what you have in mind and I'll be in touch.</p>\n<form id=\"gx-form\">\n<input type=\"hidden\" name=\"_subject\" value=\"Website Enquiry\" />\n<div class=\"gx-field\"><label for=\"gx-name\">Name</label><input id=\"gx-name\" name=\"name\" type=\"text\" required placeholder=\"Your name\" /></div>\n<div class=\"gx-field\"><label for=\"gx-email\">Email</label><input id=\"gx-email\" name=\"email\" type=\"email\" required placeholder=\"your@email.com\" /></div>\n<div class=\"gx-field\"><label for=\"gx-about\">I'm enquiring about</label><select id=\"gx-about\" name=\"about\"><option>Commission</option><option>Purchasing an artwork</option><option>Photography &amp; Video</option><option>Gallery representation</option><option>Something else</option></select></div>\n<div class=\"gx-field\"><label for=\"gx-msg\">Message</label><textarea id=\"gx-msg\" name=\"message\" rows=\"4\" placeholder=\"Tell me what you have in mind\u2026\"></textarea></div>\n<p class=\"gx-err\" hidden></p>\n<button type=\"submit\" class=\"gx-submit\">Send enquiry</button>\n</form>\n<div class=\"gx-success\" hidden>\n<p>Thank you \u2014 your message has been sent. Walt will be in touch shortly.</p>\n<button type=\"button\" class=\"gx-submit gx-close\">Close</button>\n</div>\n</div>\n</div>";

  function mount() {
    if (document.getElementById('gx-enquire')) return;
    var style = document.createElement('style');
    style.id = 'wv-enquire-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML = FAB + MODAL;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    var modal = document.getElementById('gx-enquire');
    var form = document.getElementById('gx-form');
    var success = modal.querySelector('.gx-success');
    var err = form.querySelector('.gx-err');
    var btn = form.querySelector('[type="submit"]');
    var orig = btn.textContent;
    function openM(e) { if (e) e.preventDefault(); modal.classList.add('open'); modal.removeAttribute('aria-hidden'); document.body.style.overflow = 'hidden'; }
    function closeM() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; form.hidden = false; success.hidden = true; err.hidden = true; btn.disabled = false; btn.textContent = orig; }
    window.wvEnquire = { open: openM, close: closeM };

    /* The page's own Enquire links (e.g. the home page nav) open the form. */
    document.querySelectorAll('[data-i18n="nav-enquire"]').forEach(function (a) { a.addEventListener('click', openM); });
    /* Any .gx-open button, including ones added later, opens it too. */
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.gx-open');
      if (t) openM(e);
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeM(); });
    modal.querySelectorAll('.gx-close').forEach(function (b) { b.addEventListener('click', closeM); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('open')) closeM(); });
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); btn.disabled = true; btn.textContent = '\u2026'; err.hidden = true;
      try {
        var res = await fetch('https://formspree.io/f/mrevzark', { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } });
        if (res.ok) { form.hidden = true; success.hidden = false; }
        else { var d = await res.json(); err.textContent = (d.errors || []).map(function (x) { return x.message; }).join(', ') || 'Something went wrong. Please try again.'; err.hidden = false; btn.disabled = false; btn.textContent = orig; }
      } catch (_) { err.textContent = 'Could not send. Email artist@waltviviers.com directly.'; err.hidden = false; btn.disabled = false; btn.textContent = orig; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
