/* ============================================================================
   enhance.js - frosted glass + motion behaviour for waltviviers.com
   ----------------------------------------------------------------------------
   Structure-agnostic progressive enhancement. Pairs with enhance.css. Loaded
   on the homepage directly and on interior pages via chrome.js.

   Principles:
     • Never hide content unless we can reveal it. The hidden initial state
       (html.wv-anim) is only switched on AFTER observers are wired, and a
       failsafe force-reveals everything after a timeout. Any thrown error
       leaves the page fully visible.
     • transform/opacity only; rAF-throttled scroll + pointer handlers.
     • Desktop gets parallax + pointer tilt; touch/coarse pointers don't.
     • prefers-reduced-motion disables motion (handled mostly in CSS; JS also
       skips parallax/tilt wiring).
   ========================================================================== */
(function () {
  'use strict';
  if (window.__wvEnhanceLoaded) return;
  window.__wvEnhanceLoaded = true;

  var root = document.documentElement;
  var reduce = false;
  try {
    reduce = window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  var fine = false;
  try {
    fine = window.matchMedia &&
           window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch (e) {}
  var supportsGlass = false;
  try {
    supportsGlass = (window.CSS && CSS.supports &&
      (CSS.supports('backdrop-filter', 'blur(1px)') ||
       CSS.supports('-webkit-backdrop-filter', 'blur(1px)')));
  } catch (e) {}

  function each(list, fn) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) { try { fn(list[i], i); } catch (e) {} }
  }
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  /* ── 1. Frosted glass ──────────────────────────────────────────────────── */
  function applyGlass() {
    if (!supportsGlass) return;
    root.classList.add('wv-glass');
    // Modal panels / overlays / cookie banner get the generic glass utility.
    each(document.querySelectorAll(
      '.modal-panel, .modal-content, [role="dialog"], .gx-panel, .wv-cc'
    ), function (el) { el.classList.add('wv-glassify'); });
  }

  /* ── 2. Scroll reveal ──────────────────────────────────────────────────── */
  function setupReveal() {
    // Choose reveal targets: top-level content blocks that are safe to move.
    var targets = [];
    var seen = [];
    function consider(el) {
      if (!el || el.nodeType !== 1) return;
      if (el.hasAttribute('data-wv-reveal')) return;
      if (el.closest('nav, .mobile-menu, [data-no-reveal]')) return;
      if (seen.indexOf(el) !== -1) return;
      seen.push(el);
      targets.push(el);
    }
    // Sections are the primary rhythm of every page here.
    each(document.querySelectorAll('main section, body > section, section'), consider);
    // Stagger the immediate children of the hero-less content sections a touch.
    if (!targets.length) {
      each(document.querySelectorAll('article, .post, .cv, footer'), consider);
    }
    if (!targets.length) return false;

    each(targets, function (el, i) {
      el.setAttribute('data-wv-reveal', '');
      // Gentle stagger, capped so long pages don't wait forever.
      el.style.setProperty('--wv-delay', Math.min(i * 60, 240) / 1000 + 's');
    });

    var forceAll = function () {
      each(document.querySelectorAll('[data-wv-reveal]'), function (el) {
        el.classList.add('wv-in');
      });
    };

    if (!('IntersectionObserver' in window)) { forceAll(); return true; }

    // Reveal as soon as a sliver enters the lower viewport (fire early so a
    // fast scroll never outruns it).
    var io = new IntersectionObserver(function (entries) {
      each(entries, function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('wv-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px 14% 0px', threshold: 0 });

    function revealInView() {
      var vh = window.innerHeight || 0;
      each(document.querySelectorAll('[data-wv-reveal]:not(.wv-in)'), function (el) {
        if (el.getBoundingClientRect().top < vh * 1.02) {
          el.classList.add('wv-in');
          io.unobserve(el);
        }
      });
    }

    each(targets, function (el) {
      // Reveal anything already in/near view on load immediately.
      if (el.getBoundingClientRect().top < (window.innerHeight || 0) * 0.98) {
        el.classList.add('wv-in');
      } else {
        io.observe(el);
      }
    });

    // Scroll fallback: guarantees reveal even if the observer misses a fast
    // programmatic jump. rAF-throttled, self-removing once all are shown.
    var sTick = false;
    function onScroll() {
      if (sTick) return;
      sTick = true;
      requestAnimationFrame(function () {
        sTick = false;
        revealInView();
        if (!document.querySelector('[data-wv-reveal]:not(.wv-in)')) {
          window.removeEventListener('scroll', onScroll);
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // After images load the layout settles - reveal whatever is now in view.
    window.addEventListener('load', revealInView);

    // Safety net: never leave content hidden.
    setTimeout(forceAll, 3000);
    window.addEventListener('load', function () { setTimeout(forceAll, 800); });
    return true;
  }

  /* ── 3. Hover lift on card-like blocks ─────────────────────────────────── */
  function applyLift() {
    each(document.querySelectorAll(
      '.disc-card, .digital-card, .digital-sub-card, .work-thumb, .work-card, ' +
      '.essay-card, .app-card, .blog-card, .post-card, .card, .essays-list a, [data-wv-lift]'
    ), function (el) { el.classList.add('wv-lift'); });
    // Subtle sheen on primary buttons.
    each(document.querySelectorAll(
      '.cc-btn-primary, .pf-btn-primary, .btn-primary, [data-wv-shimmer]'
    ), function (el) { el.classList.add('wv-shimmer'); });
    // A matching hover lift on buttons/CTAs (shadow + glow only, so it composes
    // with the magnetic transform on the primary buttons).
    each(document.querySelectorAll(
      '.pf-btn, .cc-btn, .btn-primary, .btn-secondary, .disc-card-cta, ' +
      '.digital-cta, .digital-sub-cta, .about-bio-btn, .gn-btn, .gx-fab, ' +
      '.view-gallery-btn, [data-wv-btnlift]'
    ), function (el) { el.classList.add('wv-btnlift'); });
  }

  /* ── 4. Hero parallax + ambient glow ───────────────────────────────────── */
  var parallaxItems = [];
  function setupParallax() {
    if (reduce) return;
    // (a) Hero wrappers that contain an <img> (photo / art / design bands).
    each(document.querySelectorAll(
      '.pf-hero-img, .hero-img, .hero-image-wrap, [data-wv-parallax]'
    ), function (wrap) {
      var img = wrap.tagName === 'IMG' ? wrap : wrap.querySelector('img');
      if (!img) return;
      wrap.classList.add('wv-parallax');
      parallaxItems.push({ wrap: wrap });
    });
    // (b) Background-image hero bands (no inner img) - translate the element.
    each(document.querySelectorAll(
      '.cc-hero-bg, .workwith-bg, [data-wv-parallax-bg]'
    ), function (el) {
      el.classList.add('wv-parallax-bg');
      parallaxItems.push({ wrap: el });
    });

    // Ambient glow behind the first couple of hero bands (desktop, non-reduced).
    if (fine) {
      each(document.querySelectorAll('.cc-hero, #photo-feature .pf-hero, #design-digital .pf-hero'),
        function (band) {
          if (band.querySelector('.wv-glow-field')) return;
          var cs = window.getComputedStyle(band);
          if (cs.position === 'static') band.style.position = 'relative';
          var field = document.createElement('div');
          field.className = 'wv-glow-field';
          field.setAttribute('aria-hidden', 'true');
          field.innerHTML = '<span class="wv-glow a"></span><span class="wv-glow b"></span>';
          band.insertBefore(field, band.firstChild);
          // Keep existing content above the glow.
          each(band.children, function (c) {
            if (c !== field) {
              var p = window.getComputedStyle(c).position;
              if (p === 'static') c.style.position = 'relative';
            }
          });
        });
    }

    if (!parallaxItems.length) return;
    var ticking = false;
    function update() {
      ticking = false;
      var vh = window.innerHeight || 1;
      each(parallaxItems, function (it) {
        var r = it.wrap.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        // -1..1 across the viewport → up to ~70px of drift.
        var progress = (r.top + r.height / 2 - vh / 2) / vh;
        var shift = Math.max(-70, Math.min(70, -progress * 110));
        it.wrap.style.setProperty('--wv-par', shift.toFixed(1) + 'px');
      });
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ── 5. Desktop pointer drift on hero bands ────────────────────────────────
     The image under the pointer eases toward the cursor (same feel as the main
     header). Wired to the multimedia-artist header and the Design & Digital
     band. */
  // mode 'var'  → set --wv-px/--wv-py (for .wv-parallax-bg, transform on el)
  // mode 'xform' → set inline transform: translate() (for a wrapper with no
  //               competing transform; its child keeps its own transform)
  function wireDrift(band, target, amp, mode) {
    if (!band || !target) return;
    if (mode === 'xform') { target.classList.add('wv-drift'); target.style.transform = 'translate(0px,0px)'; }
    var raf = false, px = 0, py = 0;
    function apply() {
      raf = false;
      if (mode === 'xform') {
        target.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
      } else {
        target.style.setProperty('--wv-px', px.toFixed(1) + 'px');
        target.style.setProperty('--wv-py', py.toFixed(1) + 'px');
      }
    }
    band.addEventListener('mousemove', function (e) {
      var r = band.getBoundingClientRect();
      if (!r.width || !r.height) return;
      px = ((e.clientX - r.left) / r.width - 0.5) * -amp;
      py = ((e.clientY - r.top) / r.height - 0.5) * -amp;
      if (!raf) { raf = true; requestAnimationFrame(apply); }
    });
    band.addEventListener('mouseleave', function () {
      px = 0; py = 0; if (!raf) { raf = true; requestAnimationFrame(apply); }
    });
  }
  function setupPointerDrift() {
    if (reduce || !fine) return;
    var cc = document.querySelector('.cc-hero');
    wireDrift(cc, cc && cc.querySelector('.cc-hero-bg'), 44, 'var');    // ±22px
    var dd = document.querySelector('#design-digital .pf-hero');
    wireDrift(dd, dd && dd.querySelector('.pf-hero-img'), 40, 'xform'); // ±20px
  }

  /* ── 6. Cursor-following spotlight (whole page) ────────────────────────── */
  function setupCursor() {
    if (reduce || !fine) return;
    root.classList.add('wv-domcursor');   // enables native-cursor hiding in CSS
    var cur = document.createElement('img');
    cur.className = 'wv-cursor';
    cur.src = '/images/pointer_down.png';   // finger-down is the default (idle) icon
    cur.alt = '';
    cur.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(cur);
    var x = 0, y = 0, raf = false, hot = false, pressed = false;
    function apply() { raf = false; cur.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 1) + 'px)'; }
    // Finger-up only while hovering a clickable and not pressing; finger-down otherwise (idle + while clicking).
    function paint() { cur.src = (hot && !pressed) ? '/images/pointer_up.png' : '/images/pointer_down.png'; }
    var CLICKABLE = 'a[href], button, [role="button"], label, select, summary, input[type="submit"], input[type="button"]';
    var TEXTY = 'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]';
    window.addEventListener('mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!cur.classList.contains('on')) cur.classList.add('on');
      var t = e.target;
      var texty = t && t.closest && t.closest(TEXTY);
      cur.classList.toggle('hide', !!texty);                       // let the native I-beam show over text fields
      hot = !texty && !!(t && t.closest && t.closest(CLICKABLE));
      paint();
      if (!raf) { raf = true; requestAnimationFrame(apply); }
    }, { passive: true });
    window.addEventListener('mousedown', function () { pressed = true; paint(); });
    window.addEventListener('mouseup', function () { pressed = false; paint(); });
    document.addEventListener('mouseleave', function () { cur.classList.remove('on'); });
    document.addEventListener('mouseenter', function () { cur.classList.add('on'); });
  }

  /* ── 7. Card tilt toward the pointer ───────────────────────────────────── */
  function setupTilt3d() {
    if (reduce || !fine) return;
    each(document.querySelectorAll(
      '.disc-card, .digital-card, .digital-sub-card, .work-thumb, .work-card, ' +
      '.photo-card, .essay-card, .app-card, .blog-card, .post-card, .essays-list a, [data-wv-tilt]'
    ), function (card) {
      if (card.classList.contains('wv-tilt3d')) return;   // already wired
      card.classList.add('wv-tilt3d');
      var raf = false, rx = 0, ry = 0;
      function apply() {
        raf = false;
        card.style.setProperty('--wv-rx', rx.toFixed(2) + 'deg');
        card.style.setProperty('--wv-ry', ry.toFixed(2) + 'deg');
      }
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var cx = (e.clientX - r.left) / r.width - 0.5;
        var cy = (e.clientY - r.top) / r.height - 0.5;
        ry = cx * 18;          // max ~9deg each way
        rx = -cy * 18;
        if (!raf) { raf = true; requestAnimationFrame(apply); }
      });
      card.addEventListener('mouseleave', function () {
        rx = 0; ry = 0; if (!raf) { raf = true; requestAnimationFrame(apply); }
      });
    });
  }

  /* ── 8. Magnetic primary buttons ───────────────────────────────────────── */
  function setupMagnetic() {
    if (reduce || !fine) return;
    var btns = [];
    each(document.querySelectorAll(
      '.cc-btn-primary, .pf-btn-primary, .btn-primary, [data-wv-magnetic]'
    ), function (btn) { btn.classList.add('wv-magnetic'); btns.push(btn); });
    if (!btns.length) return;
    var R = 95;              // activation radius beyond the button edge
    var raf = false, mx = 0, my = 0;
    function apply() {
      raf = false;
      var vh = window.innerHeight || 0;
      each(btns, function (btn) {
        var r = btn.getBoundingClientRect();
        if (r.bottom < -100 || r.top > vh + 100) return;   // offscreen: skip
        var ox = mx - (r.left + r.width / 2);
        var oy = my - (r.top + r.height / 2);
        var reach = Math.max(r.width, r.height) / 2 + R;
        var dx = 0, dy = 0;
        if (Math.hypot(ox, oy) < reach) {
          dx = Math.max(-16, Math.min(16, ox * 0.45));
          dy = Math.max(-16, Math.min(16, oy * 0.45));
        }
        btn.style.setProperty('--wv-dx', dx.toFixed(1) + 'px');
        btn.style.setProperty('--wv-dy', dy.toFixed(1) + 'px');
      });
    }
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (!raf) { raf = true; requestAnimationFrame(apply); }
    }, { passive: true });
  }

  /* ── 9. Background texture + nav picker ─────────────────────────────────── */
  var TEX = [['dots', 'Dot grid'],
             ['hairlines', 'Hairlines'], ['grid', 'Blueprint grid'],
             ['crosshatch', 'Crosshatch'], ['aurora', 'Aurora wash']];
  function texGet() { try { return localStorage.getItem('wv-texture'); } catch (e) { return null; } }
  function texSet(v) { try { localStorage.setItem('wv-texture', v); } catch (e) {} }
  function applyTexture(v) { root.setAttribute('data-texture', v); }

  function mountTexturePicker(toggle) {
    if (document.querySelector('.wv-tex')) return;
    var cur = root.getAttribute('data-texture') || 'grain';
    var inLi = toggle.closest ? toggle.closest('li') : null;
    var host = document.createElement(inLi ? 'li' : 'span');
    var tex = document.createElement('div');
    tex.className = 'wv-tex';
    var opts = TEX.map(function (t) {
      return '<button type="button" class="wv-tex-opt" role="menuitemradio" data-tex="' + t[0] +
        '" aria-checked="' + (t[0] === cur) + '"><span class="wv-tex-dot"></span>' + t[1] + '</button>';
    }).join('');
    tex.innerHTML =
      '<button type="button" class="wv-tex-btn" aria-label="Background texture" aria-haspopup="true" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
        '<path d="M4 15 15 4M9 20 20 9M4 9 9 4M14 20 20 14"/></svg></button>' +
      '<div class="wv-tex-menu" role="menu">' + opts + '</div>';
    host.appendChild(tex);
    var ref = inLi || toggle;
    ref.parentNode.insertBefore(host, ref);

    var btn = tex.querySelector('.wv-tex-btn');
    var menu = tex.querySelector('.wv-tex-menu');
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    each(tex.querySelectorAll('.wv-tex-opt'), function (o) {
      o.addEventListener('click', function () {
        applyTexture(o.getAttribute('data-tex'));
        texSet(o.getAttribute('data-tex'));
        each(tex.querySelectorAll('.wv-tex-opt'), function (x) {
          x.setAttribute('aria-checked', x === o ? 'true' : 'false');
        });
        close();
      });
    });
    document.addEventListener('click', function (e) { if (!tex.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  function setupTexture() {
    var tries = 0;
    (function find() {
      var t = document.querySelector('.theme-toggle');
      if (t) { try { mountTexturePicker(t); } catch (e) {} return; }
      if (tries++ > 25) return;
      setTimeout(find, 120);
    })();
  }

  /* ── 10. Card icons drift toward the pointer on hover ──────────────────── */
  function setupIconFollow() {
    if (reduce || !fine) return;
    each(document.querySelectorAll('.disc-card, .digital-card, .digital-sub-card'), function (card) {
      var icon = card.querySelector('.disc-card-icon, .digital-card-icon, .digital-sub-icon');
      if (!icon) return;
      icon.style.transition = 'transform 0.2s ease-out';
      icon.style.willChange = 'transform';
      var raf = false, tx = 0, ty = 0;
      function apply() { raf = false; icon.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px)'; }
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        if (!r.width) return;
        tx = ((e.clientX - r.left) / r.width - 0.5) * 18;   // ±9px
        ty = ((e.clientY - r.top) / r.height - 0.5) * 18;
        if (!raf) { raf = true; requestAnimationFrame(apply); }
      });
      card.addEventListener('mouseleave', function () {
        tx = 0; ty = 0; if (!raf) { raf = true; requestAnimationFrame(apply); }
      });
    });
  }

  // Apply the texture immediately (before paint). First-time visitors get a
  // random texture (not "none"), remembered thereafter; the picker overrides it.
  try {
    var savedTex = texGet();
    var valid = TEX.some(function (t) { return t[0] === savedTex; });
    if (!valid) {   // unset, or a since-removed option (none / grain)
      savedTex = TEX[Math.floor(Math.random() * TEX.length)][0];
      texSet(savedTex);
    }
    applyTexture(savedTex);
  } catch (e) {}

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  function setupVignette() {
    if (document.querySelector('.wv-vignette')) return;
    var v = document.createElement('div');
    v.className = 'wv-vignette';
    v.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(v);
  }

  ready(function () {
    try { setupVignette(); } catch (e) {}
    try { applyGlass(); } catch (e) {}
    try { applyLift(); } catch (e) {}
    var revealed = false;
    try { revealed = setupReveal(); } catch (e) {}
    // Only arm the hidden initial state once reveal wiring succeeded.
    if (revealed && !reduce) root.classList.add('wv-anim');
    try { setupParallax(); } catch (e) {}
    try { setupPointerDrift(); } catch (e) {}
    try { setupCursor(); } catch (e) {}
    try { setupTilt3d(); } catch (e) {}
    try { setupMagnetic(); } catch (e) {}
    try { setupTexture(); } catch (e) {}
    try { setupIconFollow(); } catch (e) {}
  });

  /* Pages that build card grids after load (e.g. the gallery) can re-wire the
     tilt on freshly-injected cards. Idempotent - only new cards are bound. */
  window.wvEnhance = window.wvEnhance || {};
  window.wvEnhance.rescanTilt = function () { try { setupTilt3d(); } catch (e) {} };
  // Re-wire lift + tilt on nodes injected after load (both idempotent).
  window.wvEnhance.rescan = function () { try { applyLift(); } catch (e) {} try { setupTilt3d(); } catch (e) {} };
})();
