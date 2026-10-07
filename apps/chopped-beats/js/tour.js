// A short guided tour: dims the page, spotlights one control at a time.
const $ = (s) => document.querySelector(s);

export function runTour(steps, { before, onEnd } = {}) {
  const root = $('#tour');
  const spot = $('#tourSpot');
  const card = $('#tourCard');
  let i = 0;

  function show() {
    const step = steps[i];
    if (before) before(step);
    $('#tourStep').textContent = `Step ${i + 1} of ${steps.length}`;
    $('#tourTitle').textContent = step.title;
    $('#tourText').textContent = step.text;
    $('#tourBack').disabled = i === 0;
    $('#tourNext').textContent = i === steps.length - 1 ? 'Start making' : 'Next';
    // Let any panel the step opened lay out before measuring.
    requestAnimationFrame(() => position(step));
    $('#tourNext').focus();
  }

  function position(step) {
    const target = step.target && document.querySelector(step.target);
    const r = target && target.getBoundingClientRect();
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!r || !r.width) {
      spot.classList.add('none');
      card.style.left = (W - cw) / 2 + 'px';
      card.style.top = Math.max(16, (H - ch) / 2) + 'px';
      return;
    }
    spot.classList.remove('none');
    const pad = 6;
    const box = {
      left: Math.max(4, r.left - pad), top: Math.max(4, r.top - pad),
      right: Math.min(W - 4, r.right + pad), bottom: Math.min(H - 4, r.bottom + pad),
    };
    Object.assign(spot.style, {
      left: box.left + 'px', top: box.top + 'px',
      width: box.right - box.left + 'px', height: box.bottom - box.top + 'px',
    });
    // Card goes below the target, else above, else beside it.
    let top;
    let left = Math.min(Math.max(16, (box.left + box.right) / 2 - cw / 2), W - cw - 16);
    if (box.bottom + 14 + ch < H) top = box.bottom + 14;
    else if (box.top - 14 - ch > 0) top = box.top - 14 - ch;
    else {
      top = Math.min(Math.max(16, (box.top + box.bottom) / 2 - ch / 2), H - ch - 16);
      left = box.right + 14 + cw < W ? box.right + 14 : Math.max(16, box.left - 14 - cw);
    }
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function close() {
    root.hidden = true;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    $('#tourNext').onclick = $('#tourBack').onclick = $('#tourSkip').onclick = null;
    if (onEnd) onEnd();
  }
  const next = () => { if (i < steps.length - 1) { i++; show(); } else close(); };
  const back = () => { if (i > 0) { i--; show(); } };
  function onKey(e) {
    // The tour owns the keyboard while it is open.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  }
  const onResize = () => position(steps[i]);

  $('#tourNext').onclick = next;
  $('#tourBack').onclick = back;
  $('#tourSkip').onclick = close;
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  root.hidden = false;
  show();
}
