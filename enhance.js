/* ============================================================================
   enhance.js — frosted glass + motion behaviour for waltviviers.com
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

    // After images load the layout settles — reveal whatever is now in view.
    window.addEventListener('load', revealInView);

    // Safety net: never leave content hidden.
    setTimeout(forceAll, 3000);
    window.addEventListener('load', function () { setTimeout(forceAll, 800); });
    return true;
  }

  /* ── 3. Hover lift on card-like blocks ─────────────────────────────────── */
  function applyLift() {
    each(document.querySelectorAll(
      '.disc-card, .digital-card, .digital-sub-card, .work-thumb, .essay-card, ' +
      '.app-card, .blog-card, .post-card, .card, [data-wv-lift]'
    ), function (el) { el.classList.add('wv-lift'); });
    // Subtle sheen on primary buttons.
    each(document.querySelectorAll(
      '.cc-btn-primary, .pf-btn-primary, .btn-primary, [data-wv-shimmer]'
    ), function (el) { el.classList.add('wv-shimmer'); });
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
    // (b) Background-image hero bands (no inner img) — translate the element.
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

  /* ── 5. Desktop pointer drift on the main hero background ───────────────── */
  function setupPointerDrift() {
    if (reduce || !fine) return;
    var band = document.querySelector('.cc-hero');
    var bg = band && band.querySelector('.cc-hero-bg');
    if (!band || !bg) return;
    var raf = false, px = 0, py = 0;
    function apply() {
      raf = false;
      bg.style.setProperty('--wv-px', px.toFixed(1) + 'px');
      bg.style.setProperty('--wv-py', py.toFixed(1) + 'px');
    }
    band.addEventListener('mousemove', function (e) {
      var r = band.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width - 0.5) * -44;   // ±22px
      py = ((e.clientY - r.top) / r.height - 0.5) * -44;
      if (!raf) { raf = true; requestAnimationFrame(apply); }
    });
    band.addEventListener('mouseleave', function () {
      px = 0; py = 0; if (!raf) { raf = true; requestAnimationFrame(apply); }
    });
  }

  /* ── 6. Cursor-following spotlight (whole page) ────────────────────────── */
  function setupSpotlight() {
    if (reduce || !fine) return;
    var el = document.createElement('div');
    el.className = 'wv-spotlight';
    el.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(el);
    var raf = false, mx = 0, my = 0;
    function apply() {
      raf = false;
      el.style.setProperty('--wv-mx', mx + 'px');
      el.style.setProperty('--wv-my', my + 'px');
    }
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (!el.classList.contains('on')) el.classList.add('on');
      if (!raf) { raf = true; requestAnimationFrame(apply); }
    }, { passive: true });
    document.addEventListener('mouseleave', function () { el.classList.remove('on'); });
    document.addEventListener('mouseenter', function () { el.classList.add('on'); });
  }

  /* ── 7. Card tilt toward the pointer ───────────────────────────────────── */
  function setupTilt3d() {
    if (reduce || !fine) return;
    each(document.querySelectorAll(
      '.disc-card, .digital-card, .digital-sub-card, .work-thumb, ' +
      '.essay-card, .app-card, .blog-card, .post-card, [data-wv-tilt]'
    ), function (card) {
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

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  ready(function () {
    try { applyGlass(); } catch (e) {}
    try { applyLift(); } catch (e) {}
    var revealed = false;
    try { revealed = setupReveal(); } catch (e) {}
    // Only arm the hidden initial state once reveal wiring succeeded.
    if (revealed && !reduce) root.classList.add('wv-anim');
    try { setupParallax(); } catch (e) {}
    try { setupPointerDrift(); } catch (e) {}
    try { setupSpotlight(); } catch (e) {}
    try { setupTilt3d(); } catch (e) {}
    try { setupMagnetic(); } catch (e) {}
  });
})();
