/* ============================================================================
   fabs.js — the floating game buttons, shared site-wide.
   ----------------------------------------------------------------------------
   One place for the three game badges in the bottom-left corner:
     • Chopped Beats (beet DJ)   → chopped-beats.waltviviers.com
     • Static Protocol (turquoise prompt) → static-protocol.waltviviers.com
     • Scritch Scratch (dog, cat or rat, picked at random) → scritch-scratch.waltviviers.com
   Desktop stacks them up the left edge; mobile puts the dog and Static
   Protocol side by side with the beet above the dog, clear of Enquire.

   Loading: chrome.js injects this file on every page it runs on; pages
   without chrome.js (the home page, app landing pages) include it directly:
     <script defer src="/fabs.js"></script>
   To hide the buttons on a page, add its path to HIDE_ON below.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__wvFabs) return;
  window.__wvFabs = true;

  /* Pages (path prefixes) that don't show the game buttons. */
  var HIDE_ON = [
    '/blog/', '/artist-bio/', '/privacy/',
    '/master-cv/', '/budtender-cv/', '/senior-graphic-design-cv/',
    '/consignment-note/', '/artist-gallery-agreement/',
    '/admin', '/clients/', '/apps/chopped-beats/', '/apps/scritch-scratch/'
  ];
  var path = location.pathname;
  for (var i = 0; i < HIDE_ON.length; i++) if (path.indexOf(HIDE_ON[i]) === 0) return;

  /* [normal, hover, nudge]: the cat and rat art sits 4px lower in its image
     than the dog's, so it's lifted to keep the gaps between badges even. */
  var PETS = [
    ['ss-up.webp', 'ss-over.webp', 0],
    ['ss-cat-up.png', 'ss-cat-over.png', -4],
    ['ss-rat-up.png', 'ss-rat-over.png', -4]
  ];

  var CSS = [
    /* Static Protocol: turquoise glowing prompt */
    '.game-fab{position:fixed;left:21px;bottom:170px;z-index:150;width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(6,20,18,.55);border:1px solid rgba(34,230,212,.35);box-shadow:0 0 16px rgba(34,230,212,.45),0 0 32px rgba(34,230,212,.25),0 5px 10px rgba(0,0,0,.35);transition:transform .18s ease,bottom .2s ease,box-shadow .2s ease;}',
    '.game-fab svg{width:22px;height:22px;}',
    '.game-fab:hover{transform:translateY(-3px) scale(1.07);}',
    /* Image badges with a hover swap (Scritch Scratch, Chopped Beats) */
    '.scritch-fab,.beat-fab{position:fixed;left:16px;z-index:150;width:66px;height:66px;display:block;transition:transform .18s ease,bottom .2s ease;filter:drop-shadow(0 5px 10px rgba(0,0,0,.35));}',
    '.scritch-fab{bottom:90px;}',
    /* Bottoms are set so the visible circles (not the image boxes) sit ~17px apart */
    '.beat-fab{bottom:240px;}',
    '.scritch-fab img,.beat-fab img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transition:opacity .15s ease;}',
    '.scritch-fab .fab-over,.beat-fab .fab-over{opacity:0;}',
    '.scritch-fab:hover,.beat-fab:hover{transform:translateY(-3px) scale(1.07);}',
    '.scritch-fab:hover .fab-up,.beat-fab:hover .fab-up{opacity:0;}',
    '.scritch-fab:hover .fab-over,.beat-fab:hover .fab-over{opacity:1;}',
    /* Mobile: all three badges in a single row along the bottom-left,
       clear of the Enquire pill on the right. Slightly smaller so the row
       fits beside Enquire even on narrow phones. */
    '@media (max-width:900px){',
    '.scritch-fab,.beat-fab{width:56px;height:56px;}',
    '.game-fab{width:50px;height:50px;}',
    '.scritch-fab{left:12px;bottom:16px;}',
    '.game-fab{left:76px;bottom:19px;}',
    '.beat-fab{left:134px;bottom:16px;}',
    /* The home page's privacy notice lifts the whole row clear of it */
    'body.privacy-visible .scritch-fab{bottom:max(90px,calc(var(--privacy-h,48px) + 28px));}',
    'body.privacy-visible .game-fab{bottom:max(93px,calc(var(--privacy-h,48px) + 31px));}',
    'body.privacy-visible .beat-fab{bottom:max(90px,calc(var(--privacy-h,48px) + 28px));}',
    '}',
    'body.menu-open .game-fab,body.menu-open .scritch-fab,body.menu-open .beat-fab{display:none !important;}'
  ].join('');

  function badge(cls, href, label, up, over) {
    var a = document.createElement('a');
    a.className = cls;
    a.href = href;
    a.setAttribute('aria-label', label);
    a.innerHTML =
      '<img class="fab-up" src="' + up + '" alt="" width="66" height="66" />' +
      '<img class="fab-over" src="' + over + '" alt="" aria-hidden="true" width="66" height="66" />';
    return a;
  }

  function mount() {
    if (document.querySelector('.game-fab, .scritch-fab, .beat-fab')) return;
    var style = document.createElement('style');
    style.id = 'wv-fabs-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var game = document.createElement('a');
    game.className = 'game-fab';
    game.href = 'https://static-protocol.waltviviers.com/';
    game.setAttribute('aria-label', 'Play Static Protocol');
    game.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6l6 6-6 6" stroke="#22e6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="18" x2="20" y2="18" stroke="#22e6d4" stroke-width="2" stroke-linecap="round"/></svg>';

    var pet = PETS[Math.floor(Math.random() * PETS.length)];
    var dog = badge('scritch-fab', 'https://scritch-scratch.waltviviers.com/play', 'Play Scritch Scratch',
      '/apps/scritch-scratch/' + pet[0], '/apps/scritch-scratch/' + pet[1]);
    if (pet[2]) dog.querySelectorAll('img').forEach(function (img) { img.style.top = pet[2] + 'px'; });
    var beet = badge('beat-fab', 'https://chopped-beats.waltviviers.com/', "Open Chopped Beats",
      '/apps/chopped-beats/fab-up.webp', '/apps/chopped-beats/fab-over.webp');

    var frag = document.createDocumentFragment();
    frag.appendChild(game);
    frag.appendChild(dog);
    frag.appendChild(beet);
    document.body.appendChild(frag);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
