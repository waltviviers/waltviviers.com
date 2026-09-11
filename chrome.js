/* ============================================================================
   chrome.js — shared site header + footer for waltviviers.com
   ----------------------------------------------------------------------------
   Injects the exact home-page navigation (with language switch, theme toggle
   and mobile burger menu) and footer onto every public page, so the chrome is
   identical site-wide. The home page keeps its own inline chrome as the
   canonical source; this file mirrors it 1:1.

   Integration contract for host pages:
     • Remove the page's own <nav>, mobile-menu and <footer> markup and their
       theme / language / burger / admin scripts, then add:
         <script defer src="/chrome.js"></script>
     • Keep the early inline theme-init in <head> (prevents a flash).
     • Pages with their own translatable body content expose a global
         window.wvApplyLang = function (lang) { ...translate page content... }
       which this file calls on load and on every language change.
     • Pages using [data-af] attributes are handled here automatically.
     • If a global Enquire modal (#gx-enquire) is present, the nav "Enquire"
       button opens it; otherwise it links to /gallery/#commission.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__wvChromeLoaded) return;
  window.__wvChromeLoaded = true;

  /* ── Chrome-only translations (nav + footer strings) ──────────────────── */
  var I18N = {
    en: {
      'nav-photography': 'Photography & Video',
      'nav-works': 'Fine Art & Illustration',
      'nav-bio': 'Bio & Statement',
      'nav-enquire': 'Enquire',
      'footer-copy': '© 2026 Walt Viviers. All rights reserved.',
      'email-href': 'mailto:artist@waltviviers.com'
    },
    af: {
      'nav-photography': 'Fotografie & Video',
      'nav-works': 'Skone Kunste & Illustrasie',
      'nav-bio': 'Bio & Verklaring',
      'nav-enquire': 'Navraag',
      'footer-copy': '© 2026 Walt Viviers. Alle regte voorbehou.',
      'email-href': 'mailto:kunstenaar@waltviviers.com'
    }
  };

  /* ── Styles (mirrored verbatim from the home page chrome) ─────────────── */
  var CSS = [
    /* Nav */
    'nav{position:fixed;inset:0 0 auto 0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 48px;height:100px;background:rgba(0,0,0,0.95);backdrop-filter:blur(16px);border-bottom:1px solid var(--rule);transition:height 0.4s cubic-bezier(0.4,0,0.2,1);}',
    'nav.scrolled{height:50px;}',
    '.nav-left{display:flex;align-items:center;gap:14px;}',
    '.lang-toggle,.lang-switch{display:flex;align-items:center;gap:10px;}',
    '.lang-group{font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--stone);font-family:var(--sans);line-height:1;cursor:pointer;user-select:none;white-space:nowrap;transition:color 0.2s;}',
    '.lang-group.active{color:var(--ink);}',
    '.lang-group:not(.active):hover{color:var(--ink);}',
    '.lang-track{position:relative;width:40px;height:20px;border-radius:12px;border:1.5px solid #4A4844;background:transparent;cursor:pointer;padding:0;flex-shrink:0;}',
    '.lang-knob{position:absolute;top:50%;left:3px;width:12px;height:12px;border-radius:50%;background:var(--ink);transform:translateY(-50%);transition:left 0.28s cubic-bezier(0.4,0,0.2,1);}',
    '.lang-switch:has(.lang-group:last-child.active) .lang-knob{left:22px;}',
    '[data-theme="light"] .lang-track{border-color:#D5D1CB;}',
    '.nav-logo img{height:36px;width:auto;transition:height 0.4s cubic-bezier(0.4,0,0.2,1);}',
    'nav.scrolled .nav-logo img{height:28px;}',
    '.nav-links{display:flex;align-items:center;gap:40px;list-style:none;margin:0;padding:0;}',
    '.nav-links a{font-family:var(--sans);font-size:11px;font-weight:400;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;color:var(--stone);transition:color 0.2s;}',
    '.nav-links a:hover{color:var(--white);}',
    '.nav-cta{font-size:12px !important;font-weight:500 !important;letter-spacing:0.08em !important;color:var(--white) !important;padding:7px 18px;border:1px solid #4A4844;transition:background 0.2s,color 0.2s,border-color 0.2s !important;}',
    '.nav-cta:hover{background:var(--white) !important;color:var(--black) !important;border-color:var(--white) !important;}',
    /* Social icons */
    '.social-icons{display:flex;align-items:center;gap:16px;}',
    '.social-icons a{display:flex;align-items:center;justify-content:center;color:var(--stone);transition:color 0.2s;}',
    '.social-icons a:hover{color:var(--white);}',
    '.social-icons svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}',
    /* Theme toggle */
    '.theme-toggle{position:relative;width:60px;height:32px;border-radius:16px;border:1.5px solid #4A4844;background:transparent;cursor:pointer;padding:0;flex-shrink:0;display:flex;align-items:center;justify-content:center;}',
    'nav.scrolled .theme-toggle{width:auto;height:auto;border:none;padding:4px;}',
    'nav.scrolled .toggle-thumb{position:static;width:auto;height:auto;background:none;border-radius:0;transform:none !important;}',
    'nav.scrolled .toggle-thumb .icon-moon,nav.scrolled .toggle-thumb .icon-sun{font-size:17px;}',
    'nav.scrolled .toggle-thumb svg.icon-moon,nav.scrolled .toggle-thumb svg.icon-sun{width:17px;height:17px;stroke:var(--stone);}',
    '.toggle-thumb{position:absolute;top:4px;left:4px;width:22px;height:22px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);}',
    '[data-theme="light"] .toggle-thumb{transform:translateX(28px);}',
    '.toggle-thumb .icon-moon,.toggle-thumb .icon-sun{font-size:12px;line-height:1;}',
    '.toggle-thumb .icon-moon{display:block;}',
    '.toggle-thumb .icon-sun{display:none;}',
    '.toggle-thumb svg.icon-moon,.toggle-thumb svg.icon-sun{width:13px;height:13px;fill:none;stroke:var(--bg);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}',
    '.toggle-thumb .emoji-moon,.toggle-thumb .emoji-sun{display:none;}',
    '[data-theme="light"] .theme-toggle{border-color:#D5D1CB;}',
    '[data-theme="light"] .toggle-thumb .icon-moon{display:none;}',
    '[data-theme="light"] .toggle-thumb .icon-sun{display:block;}',
    /* Footer */
    'footer{padding:40px 48px;border-top:1px solid var(--rule);display:flex;justify-content:center;align-items:center;position:relative;margin-top:0;}',
    '.footer-mark{position:absolute;top:50%;right:0;transform:translateY(-50%);line-height:0;}',
    '.footer-mark img{display:block;}',
    '[data-theme="light"] .footer-mark img{filter:invert(1);}',
    '.footer-social{display:flex;flex-direction:column;align-items:center;gap:20px;}',
    '.footer-social .social-icons{gap:24px;}',
    '.footer-social .social-icons a{color:var(--stone);}',
    '.footer-social .social-icons svg{width:22px;height:22px;}',
    '.footer-social .social-icons a:hover{color:var(--white);}',
    '.footer-copy{font-size:11px;color:var(--stone);letter-spacing:0.06em;text-align:center;}',
    '.footer-admin{position:absolute;top:50%;transform:translateY(-50%);left:48px;font-size:11px;font-weight:500;letter-spacing:0.10em;text-transform:uppercase;color:var(--stone);padding:7px 16px;border:1px solid var(--rule);transition:border-color 0.2s,color 0.2s;background:none;cursor:pointer;}',
    '.footer-admin:hover{border-color:var(--stone);color:var(--ink);}',
    '[data-theme="light"] .footer-admin:hover{color:#0C0C0B;border-color:#6B6560;}',
    /* Light-mode nav */
    '[data-theme="light"] nav{background:rgba(245,243,239,0.95);}',
    '[data-theme="light"] .nav-logo img{filter:invert(1);opacity:1;}',
    '[data-theme="light"] .nav-links a:hover{color:var(--ink);}',
    '[data-theme="light"] .nav-cta{color:#0C0C0B !important;border-color:#D5D1CB !important;}',
    '[data-theme="light"] .nav-cta:hover{background:#0C0C0B !important;color:#FAF9F7 !important;border-color:#0C0C0B !important;}',
    /* Burger */
    '.burger-btn{display:none;align-items:center;justify-content:center;width:36px;height:36px;cursor:pointer;background:none;border:none;padding:4px;flex-shrink:0;font-size:20px;line-height:1;transition:opacity 0.2s;}',
    '.burger-btn:hover{opacity:0.7;}',
    '.burger-btn .burger-icon{display:block;}',
    '.burger-btn .burger-close{display:none;font-style:normal;font-size:20px;}',
    '.burger-btn.is-open .burger-icon{display:none;}',
    '.burger-btn.is-open .burger-close{display:block;}',
    /* Mobile menu */
    '.mobile-menu{position:fixed;inset:0;z-index:190;background:var(--bg);display:flex;flex-direction:column;padding:80px 32px 48px;opacity:0;pointer-events:none;transition:opacity 0.3s cubic-bezier(0.4,0,0.2,1);}',
    '.mobile-menu.is-open{opacity:1;pointer-events:auto;}',
    'body.menu-open{overflow:hidden;}',
    'body.menu-open .gx-fab,body.menu-open .game-fab,body.menu-open .scritch-fab{display:none !important;}',
    '.mobile-menu-links{display:flex;flex-direction:column;border-top:1px solid var(--rule);flex:1 1 0;min-height:0;overflow-y:auto;}',
    '.mobile-menu-link{display:flex;align-items:center;justify-content:space-between;padding:22px 0;border-bottom:1px solid var(--rule);font-family:var(--serif);font-size:clamp(2rem,9vw,3.2rem);font-weight:400;line-height:1;color:var(--stone);transition:color 0.2s;text-decoration:none;flex-shrink:0;}',
    '.mobile-menu-link:hover{color:var(--ink);}',
    '.mobile-menu-link-cta{color:var(--ink);margin-top:4px;}',
    '.mobile-menu-link-cta:hover{color:var(--stone);}',
    '.mobile-menu-arrow{font-size:1.4rem;opacity:0.4;}',
    '.mobile-menu-foot{padding-top:32px;flex-shrink:0;display:flex;gap:24px;align-items:center;flex-wrap:wrap;}',
    '.mobile-menu-foot a{display:flex;align-items:center;color:var(--stone);transition:color 0.2s;}',
    '.mobile-menu-foot a:hover{color:var(--ink);}',
    '.mobile-menu-foot svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}',
    '.mobile-admin-btn{font-size:11px;font-weight:500;letter-spacing:0.10em;text-transform:uppercase;color:var(--stone);padding:6px 14px;border:1px solid var(--rule);transition:border-color 0.2s,color 0.2s;margin-right:auto;}',
    '.mobile-admin-btn:hover{border-color:var(--stone);color:var(--ink);}',
    '[data-theme="light"] .mobile-menu{background:#F5F3EF;}',
    /* Responsive */
    '@media (max-width:900px){' +
      'nav{padding:0 24px;height:50px;}' +
      '.nav-logo img{height:28px;}' +
      '.nav-links{gap:20px;}' +
      '.nav-link-hide{display:none;}' +
      '.lang-switch{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);gap:7px;}' +
      '.lang-group{font-size:10px;letter-spacing:0.04em;}' +
      '.lang-track{width:34px;height:18px;}' +
      '.lang-switch:has(.lang-group:last-child.active) .lang-knob{left:18px;}' +
      '.theme-toggle{width:auto;height:auto;border:none;padding:4px;}' +
      '.toggle-thumb{position:static;width:auto;height:auto;background:none;border-radius:0;transform:none !important;}' +
      '.toggle-thumb svg.icon-moon,.toggle-thumb svg.icon-sun{width:18px;height:18px;stroke:var(--stone);}' +
      '.theme-toggle:hover svg.icon-moon,.theme-toggle:hover svg.icon-sun{stroke:var(--ink);}' +
      '.toggle-thumb .emoji-moon,.toggle-thumb .emoji-sun{display:none !important;}' +
      'footer{padding:40px 24px 88px;flex-direction:column;gap:28px;}' +
      '.footer-admin{position:static;transform:none;order:1;}' +
      '.footer-social{order:0;}' +
      '.footer-mark{position:static;transform:none;order:2;}' +
      '.burger-btn{display:flex;}' +
      'nav .social-icons{display:none;}' +
    '}',
    '@media (max-width:560px){.footer-admin{display:none;}}'
  ].join('\n');

  /* ── Markup ───────────────────────────────────────────────────────────── */
  var IG = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke-width="2.5"/></svg>';
  var LI = '<svg viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>';
  var DR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>';
  var BE = '<svg viewBox="0 0 24 24"><path d="M3 4v16M3 4h5a3 3 0 0 1 0 6H3m0 0h5.5a3.5 3.5 0 0 1 0 7H3"/><line x1="14" y1="7" x2="20" y2="7"/><line x1="13.5" y1="13.5" x2="22" y2="13.5"/><path d="M21 12a3.5 3.5 0 1 0 0 3"/></svg>';
  var GH = '<svg viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>';
  var EM = '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,14 22,4"/></svg>';

  var NAV_HTML =
    '<div class="nav-left">' +
      '<a href="/" class="nav-logo" aria-label="Home"><img src="/logo.svg" alt="Walt Viviers" width="379" height="185" /></a>' +
      '<div class="lang-toggle lang-switch" id="wv-lang-toggle">' +
        '<div class="lang-group active" data-lang="en">English</div>' +
        '<button type="button" class="lang-track" aria-label="Toggle language"><span class="lang-knob"></span></button>' +
        '<div class="lang-group" data-lang="af">Afrikaans</div>' +
      '</div>' +
    '</div>' +
    '<ul class="nav-links">' +
      '<li class="nav-link-hide"><a href="/photography/" data-i18n="nav-photography">Photography &amp; Video</a></li>' +
      '<li class="nav-link-hide"><a href="/gallery/" data-i18n="nav-works">Fine Art &amp; Illustration</a></li>' +
      '<li class="nav-link-hide"><a href="/artist-bio/" data-i18n="nav-bio">Bio &amp; Statement</a></li>' +
      '<li class="nav-link-hide"><a href="/gallery/#commission" class="nav-cta" id="wv-enquire" data-i18n="nav-enquire">Enquire</a></li>' +
      '<li><div class="social-icons">' +
        '<a href="https://instagram.com/waltviviers" target="_blank" rel="noopener" aria-label="Instagram">' + IG + '</a>' +
        '<a href="https://www.linkedin.com/in/waltviviers" target="_blank" rel="noopener" aria-label="LinkedIn">' + LI + '</a>' +
        '<a href="mailto:artist@waltviviers.com" data-i18n-href="email-href" aria-label="Email">' + EM + '</a>' +
      '</div></li>' +
      '<li><button class="theme-toggle" id="wv-theme-toggle" aria-label="Toggle light/dark mode"><span class="toggle-thumb">' +
        '<svg class="icon-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
        '<svg class="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' +
        '<span class="emoji-moon">🌙</span><span class="emoji-sun">🌞</span>' +
      '</span></button></li>' +
      '<li><button class="burger-btn" id="wv-burger" aria-label="Open menu" aria-expanded="false" aria-controls="wv-mobile-menu"><span class="burger-icon">🍔</span><em class="burger-close">🌭</em></button></li>' +
    '</ul>';

  var MENU_HTML =
    '<div class="mobile-menu-links">' +
      '<a href="/photography/" class="mobile-menu-link" data-i18n="nav-photography">Photography &amp; Video <span class="mobile-menu-arrow">↗</span></a>' +
      '<a href="/gallery/" class="mobile-menu-link" data-i18n="nav-works">Fine Art &amp; Illustration <span class="mobile-menu-arrow">↗</span></a>' +
      '<a href="/artist-bio/" class="mobile-menu-link" data-i18n="nav-bio">Bio &amp; Statement <span class="mobile-menu-arrow">↗</span></a>' +
      '<a href="/gallery/#commission" class="mobile-menu-link mobile-menu-link-cta" data-i18n="nav-enquire">Enquire <span class="mobile-menu-arrow">↗</span></a>' +
    '</div>' +
    '<div class="mobile-menu-foot">' +
      '<a href="/admin-index/" class="mobile-admin-btn">Admin</a>' +
      '<a href="https://instagram.com/waltviviers" target="_blank" rel="noopener" aria-label="Instagram">' + IG + '</a>' +
      '<a href="https://www.linkedin.com/in/waltviviers" target="_blank" rel="noopener" aria-label="LinkedIn">' + LI + '</a>' +
      '<a href="https://dribbble.com/waltviviers" target="_blank" rel="noopener" aria-label="Dribbble">' + DR + '</a>' +
    '</div>';

  var FOOTER_HTML =
    '<button class="footer-admin" id="wv-admin">Admin</button>' +
    '<div class="footer-social">' +
      '<div class="social-icons">' +
        '<a href="https://instagram.com/waltviviers" target="_blank" rel="noopener" aria-label="Instagram">' + IG + '</a>' +
        '<a href="https://www.linkedin.com/in/waltviviers" target="_blank" rel="noopener" aria-label="LinkedIn">' + LI + '</a>' +
        '<a href="https://dribbble.com/waltviviers" target="_blank" rel="noopener" aria-label="Dribbble">' + DR + '</a>' +
        '<a href="https://www.behance.net/waltviviers" target="_blank" rel="noopener" aria-label="Behance">' + BE + '</a>' +
        '<a href="https://github.com/waltviviers" target="_blank" rel="noopener" aria-label="GitHub">' + GH + '</a>' +
        '<a href="mailto:artist@waltviviers.com" data-i18n-href="email-href" aria-label="Email">' + EM + '</a>' +
      '</div>' +
      '<div class="footer-legal" style="margin-top:8px;font-size:11px;letter-spacing:0.06em;color:var(--stone,#9A9890);line-height:1.7;text-align:center;"><span class="footer-copy" data-i18n="footer-copy">© 2026 Walt Viviers. All rights reserved.</span> <a href="/privacy/" class="footer-privacy" style="color:inherit;">Privacy Policy.</a> <span class="footer-credit">Made with <span style="color:#e0607e">♥</span> by <a href="https://catscreations.co.za" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">Cat&#39;s Creations</a></span></div>' +
    '</div>' +
    '<div class="footer-mark"><img src="/images/walt-viviers-mark.webp" alt="Walt Viviers" width="150" height="31" loading="lazy" /></div>';

  /* ── Build & mount ────────────────────────────────────────────────────── */
  var nav, menu, footer;

  function mount() {
    if (document.getElementById('wv-chrome-style')) return;

    var style = document.createElement('style');
    style.id = 'wv-chrome-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    nav = document.createElement('nav');
    nav.id = 'wv-nav';
    nav.innerHTML = NAV_HTML;

    menu = document.createElement('div');
    menu.className = 'mobile-menu';
    menu.id = 'wv-mobile-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Navigation menu');
    menu.innerHTML = MENU_HTML;

    footer = document.createElement('footer');
    footer.id = 'wv-footer';
    footer.innerHTML = FOOTER_HTML;

    document.body.insertBefore(nav, document.body.firstChild);
    nav.parentNode.insertBefore(menu, nav.nextSibling);
    document.body.appendChild(footer);

    wire();
    applyTheme();
    applyLang(readLang(), true);
  }

  /* ── Theme ────────────────────────────────────────────────────────────── */
  function readTheme() {
    try {
      var s = localStorage.getItem('wv-theme');
      if (s) return s;
    } catch (e) {}
    if (document.documentElement.dataset.theme) return document.documentElement.dataset.theme;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  function applyTheme() {
    document.documentElement.dataset.theme = readTheme();
  }

  /* ── Language ─────────────────────────────────────────────────────────── */
  function readLang() {
    try { return localStorage.getItem('wv-lang') || 'en'; } catch (e) { return 'en'; }
  }

  function applyLang(lang, initial) {
    var dict = I18N[lang] || I18N.en;
    document.documentElement.lang = lang;
    try { localStorage.setItem('wv-lang', lang); } catch (e) {}

    /* Chrome strings only (scoped to the injected nav / menu / footer) */
    [nav, menu, footer].forEach(function (root) {
      if (!root) return;
      root.querySelectorAll('[data-i18n]').forEach(function (el) {
        var v = dict[el.getAttribute('data-i18n')];
        if (v != null) el.textContent = v;
      });
      root.querySelectorAll('[data-i18n-href]').forEach(function (el) {
        var v = dict[el.getAttribute('data-i18n-href')];
        if (v != null) el.setAttribute('href', v);
      });
    });

    /* Language-switch knob state */
    if (nav) {
      nav.querySelectorAll('.lang-group[data-lang]').forEach(function (g) {
        g.classList.toggle('active', g.dataset.lang === lang);
      });
    }

    /* Page content marked with [data-af] (stores original HTML once) */
    document.querySelectorAll('[data-af]').forEach(function (el) {
      if (el.__wvEn == null) el.__wvEn = el.innerHTML;
      el.innerHTML = (lang === 'af') ? el.getAttribute('data-af') : el.__wvEn;
    });

    /* Page-supplied content translator */
    if (typeof window.wvApplyLang === 'function') {
      try { window.wvApplyLang(lang); } catch (e) {}
    }
  }

  /* ── Behaviour ────────────────────────────────────────────────────────── */
  function wire() {
    /* Shrink-on-scroll */
    var ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function () {
          nav.classList.toggle('scrolled', window.scrollY > 40);
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* Theme toggle */
    var tt = nav.querySelector('#wv-theme-toggle');
    if (tt) tt.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('wv-theme', next); } catch (e) {}
    });

    /* Language toggle */
    var lt = nav.querySelector('#wv-lang-toggle');
    if (lt) lt.addEventListener('click', function (e) {
      var group = e.target.closest('.lang-group[data-lang]');
      var lang;
      if (group) lang = group.dataset.lang;
      else if (e.target.closest('.lang-track')) lang = (readLang() === 'en' ? 'af' : 'en');
      else return;
      applyLang(lang, false);
    });

    /* Burger / mobile menu */
    var burger = nav.querySelector('#wv-burger');
    function closeMenu() {
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      document.body.classList.remove('menu-open');
    }
    function openMenu() {
      burger.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open');
      document.body.classList.add('menu-open');
    }
    if (burger) {
      burger.addEventListener('click', function () {
        menu.classList.contains('is-open') ? closeMenu() : openMenu();
      });
      menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    }

    /* Admin */
    var admin = footer.querySelector('#wv-admin');
    if (admin) admin.addEventListener('click', function () {
      window.location.href = 'https://waltviviers.com/admin-index/';
    });

    /* Enquire — open the global modal if present, else follow the link */
    var enquire = nav.querySelector('#wv-enquire');
    if (enquire) enquire.addEventListener('click', function (e) {
      var m = document.getElementById('gx-enquire');
      if (m) {
        e.preventDefault();
        m.classList.add('open');
        m.removeAttribute('aria-hidden');
        document.body.style.overflow = 'hidden';
      }
    });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
