// Floating, draggable player. Its position is kept per browser.
const KEY = 'cb-player-pos';

// `avoid` returns an element the default spot should sit above (the open pads), or null.
export function initPlayer(el, grip, avoid = () => null) {
  const save = (pos) => { try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* optional */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

  function place(x, y) {
    const r = el.getBoundingClientRect();
    const nx = Math.min(Math.max(8, x), window.innerWidth - r.width - 8);
    const ny = Math.min(Math.max(8, y), window.innerHeight - r.height - 8);
    el.style.left = nx + 'px';
    el.style.top = ny + 'px';
    el.style.bottom = 'auto';
    return { x: nx, y: ny };
  }

  function home() {
    const r = el.getBoundingClientRect();
    const block = avoid();
    const floor = block ? block.getBoundingClientRect().top - 12 : window.innerHeight - 24;
    place((window.innerWidth - r.width) / 2, floor - r.height);
  }

  function reset() {
    el.style.left = '';
    el.style.top = '';
    el.style.bottom = '';
    try { localStorage.removeItem(KEY); } catch { /* optional */ }
    home();
  }

  const saved = load();
  if (saved) place(saved.x, saved.y); else reset();

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    // Drag from the grip, or from any empty part of the panel (not its buttons).
    if (e.button !== 0 || (e.target !== grip && e.target !== el && !e.target.closest('.clock'))) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    const r = el.getBoundingClientRect();
    save({ x: r.left, y: r.top });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // Pointer capture retargets the double-click to the panel, so listen there.
  el.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) reset(); });
  window.addEventListener('resize', () => {
    if (!load()) { home(); return; }
    const r = el.getBoundingClientRect();
    place(r.left, r.top);
  });
  // Until it has been moved by hand, the player keeps to its default spot as the layout changes.
  return { settle: () => { if (!load()) home(); } };
}
