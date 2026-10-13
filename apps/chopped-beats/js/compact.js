// Compact view: swaps the words on buttons, labels and headings for icons.
// The words stay in the page (visually hidden) so tooltips and screen readers
// still name everything. Toggled from the floating player; remembered per browser.

const P = {
  home: '<path d="M15 6l-6 6 6 6"/>',
  new: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/>',
  open: '<path d="M3 19V5h6l2 2h7v3"/><path d="M3 19l3-9h15l-3 9z"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  bpm: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  tap: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/>',
  snap: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h3M15 8h3"/>',
  click: '<path d="M9 3h6l3 18H6z"/><path d="M12 15l5-9"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  move: '<path d="M5 3l14 7-6 2-2 6z"/>',
  chop: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6M11 8v6"/>',
  pads: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  find: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  sounds: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
  beat: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="7" cy="7" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="10" cy="17" r="1.6" fill="currentColor"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  clear: '<path d="M6 6l12 12M18 6L6 18"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  bars: '<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  rec: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  compact: '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
  expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
};

export const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;

// What gets an icon. Labels and headings keep their inputs; only their words are swapped.
const TARGETS = [
  ['.home-link', 'home'],
  ['#btnNew', 'new'],
  ['#btnOpen', 'open'],
  ['#btnFolder', 'folder'],
  ['#bpm', 'bpm', 'label'],
  ['#btnTap', 'tap'],
  ['#snap', 'snap', 'label'],
  ['#btnMetro', 'click'],
  ['#btnLoop', 'loop'],
  ['#toolMove', 'move'],
  ['#toolChop', 'chop'],
  ['#zoom', 'zoom', 'label'],
  ['#btnPads', 'pads'],
  ['#btnExport', 'export'],
  ['#btnFind', 'find'],
  ['#btnImport', 'import'],
  ['#btnAddTrack', 'add'],
  ['.library .pane-head h2', 'sounds'],
  ['.pads-pad .pane-head h2', 'pads'],
  ['.pads-seq .pane-head h2', 'beat'],
  ['#recPads', 'rec', 'label'],
  ['#btnSeqPlay', 'play'],
  ['#btnSeqClear', 'clear'],
  ['#seqBars', 'bars', 'label'],
  ['#btnSeqStamp', 'add'],
];

function decorate(el, name) {
  // Wrap the element's own words so CSS can hide them, and name it for hover.
  const words = [];
  for (const n of [...el.childNodes]) {
    if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) continue;
    const span = document.createElement('span');
    span.className = 'tx';
    span.textContent = n.textContent;
    words.push(n.textContent.trim().replace(/^[←+]\s*/, ''));
    n.replaceWith(span);
  }
  if (!el.title && words.length) el.title = words.join(' ');
  el.insertAdjacentHTML('afterbegin', icon(name));
}

export function initCompact(btn, store) {
  for (const [sel, name, via] of TARGETS) {
    let el = document.querySelector(sel);
    if (el && via === 'label') el = el.closest('label');
    if (el) decorate(el, name);
  }
  const set = (on) => {
    document.body.classList.toggle('compact', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = icon(on ? 'expand' : 'compact');
    btn.title = on ? 'Show words again' : 'Compact view: icons instead of words';
    btn.setAttribute('aria-label', btn.title);
    store.set('compact', on);
  };
  set(!!store.get('compact', false));
  btn.addEventListener('click', () => set(!document.body.classList.contains('compact')));
}
