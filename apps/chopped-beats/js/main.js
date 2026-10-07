import * as A from './audio.js';
import { buildKit } from './drums.js';
import { detectHits, detectWords, guessBpm } from './analysis.js';
import * as S from './storage.js';
import { initPlayer } from './player.js';
import { runTour } from './tour.js';

const { ctx, SR } = A;
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const pref = {
  get(k, d) { try { const v = localStorage.getItem('cb-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb-' + k, JSON.stringify(v)); } catch { /* optional */ } },
};

const COLOURS = ['#C9A66B', '#8FA5B8', '#B88F8F', '#8FB89A', '#A68FB8', '#B8B08F', '#8FB8B5', '#C4927A'];
const PAD_KEYS = '1234qwerasdfzxcv';
const KIT_ORDER = ['Kick', 'Snare', 'Clap', 'Hat', 'Open hat', 'Rim', 'Tom', '808', 'Cowbell', 'Shaker', 'Crash', 'Zap'];

// ── State ──

const samples = new Map(); // id -> { id, name, kind: 'kit'|'user'|'mem', buffer, loading, missing }
const renders = new Map(); // clipId -> { key, promise, buffer }
let project = blankProject();
let selectedClip = null;
let selectedTrack = project.tracks[0].id;
let tool = 'move';
let pps = pref.get('pps', 80);
const undoStack = [];
const redoStack = [];

function newTrack(name, i) {
  return { id: uid(), name, vol: 0.9, mute: false, solo: false, colour: COLOURS[i % COLOURS.length] };
}

function blankProject() {
  const pads = Array(16).fill(null);
  KIT_ORDER.forEach((n, i) => { pads[i] = { sample: 'kit:' + n, s0: 0, s1: null, name: n }; });
  return {
    version: 1,
    name: 'Untitled',
    bpm: 100,
    snap: 0.25,
    metronome: false,
    loop: null,
    loopOn: false,
    tracks: [newTrack('Voice', 0), newTrack('Clips', 1), newTrack('Beat', 2)],
    clips: [],
    pads,
    pattern: {},
    bars: 4,
  };
}

const beat = () => 60 / project.bpm;
const bar = () => beat() * 4;
const track = (id) => project.tracks.find((t) => t.id === id);
const clipById = (id) => project.clips.find((c) => c.id === id);
const bodyLen = (c) => A.clipBodyLen(c, project.bpm);
const fullLen = (c) => bodyLen(c) * c.loops;

function snapT(t, force) {
  const div = project.snap;
  if (!div && !force) return Math.max(0, t);
  const g = beat() * (div || 0.25);
  return Math.max(0, Math.round(t / g) * g);
}

function songEnd(withTails) {
  let end = 0;
  for (const c of project.clips) {
    let e = c.start + fullLen(c);
    if (withTails) {
      const r = renders.get(c.id);
      const tail = r && r.buffer ? r.buffer.duration - bodyLen(c) : A.tailLen(c.fx);
      e += Math.max(0, tail);
    }
    end = Math.max(end, e);
  }
  return end;
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function fmtBars(t) {
  const b = Math.floor(t / bar());
  const bt = Math.floor((t - b * bar()) / beat());
  return `${b + 1}.${bt + 1}`;
}
function prettyName(id) {
  if (id.startsWith('kit:')) return id.slice(4);
  if (id.startsWith('mem:')) return id.split(':').slice(2).join(':');
  return id.replace(/\.[a-z0-9]+$/i, '');
}

// ── Toasts & modal ──

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3200);
}

function modal(title, html, onReady) {
  // A welcome image sits above the title; clear it so other dialogs don't inherit it.
  $('.modal-card').querySelectorAll(':scope > .welcome-mascot').forEach((el) => el.remove());
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  if (onReady) onReady($('#modalBody'));
}
function closeModal() {
  $('#modal').hidden = true;
  if (tourPending) { tourPending = false; setTimeout(startTour, 250); }
}
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });

// ── Undo / redo ──

const snap = () => JSON.stringify(project);
let pendingEdit = null;

function checkpoint(before = snap()) {
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function beginEdit() { if (!pendingEdit) pendingEdit = snap(); }
function endEdit() { if (pendingEdit) { checkpoint(pendingEdit); pendingEdit = null; changed(); } }

function restoreState(json) {
  project = JSON.parse(json);
  if (!track(selectedTrack)) selectedTrack = project.tracks[0] && project.tracks[0].id;
  if (selectedClip && !clipById(selectedClip)) selectedClip = null;
  syncControls();
  changed();
}
function undo() { if (!undoStack.length) return; redoStack.push(snap()); restoreState(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snap()); restoreState(redoStack.pop()); }

// ── Samples ──

async function ensureSample(id) {
  let s = samples.get(id);
  if (s && s.buffer) return s;
  if (s && s.loading) return s.loading;
  if (id.startsWith('kit:') || id.startsWith('mem:') || !S.connected()) return null;
  if (!s) { s = { id, name: prettyName(id), kind: 'user', buffer: null }; samples.set(id, s); }
  s.loading = S.read('samples', id)
    .then((f) => A.decodeFile(f))
    .then((b) => { s.buffer = b; s.missing = false; return s; })
    .catch(() => { s.missing = true; return null; })
    .finally(() => { s.loading = null; });
  return s.loading;
}

function isVideo(f) {
  return f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name);
}

async function importFiles(files) {
  const ids = [];
  for (const f of files) {
    const video = isVideo(f);
    toast(video ? `Pulling the sound out of ${f.name}…` : `Importing ${f.name}…`);
    let buffer;
    try {
      buffer = await A.decodeFile(f);
    } catch {
      toast(`Couldn't read any sound from ${f.name}. Try saving it as MP4 or WAV.`, true);
      continue;
    }
    const base = S.safeName(f.name.replace(/\.[^.]+$/, ''));
    let id;
    try {
      if (S.connected()) {
        id = video || !/\.(wav|mp3|ogg|flac|m4a|aac|opus|webm)$/i.test(f.name)
          ? await S.writeUnique('samples', base + '.wav', A.encodeWav(buffer))
          : await S.writeUnique('samples', S.safeName(f.name), f);
      } else {
        id = `mem:${uid()}:${base}`;
      }
    } catch (e) {
      toast(`Couldn't save ${f.name} to your folder: ${e.message}`, true);
      id = `mem:${uid()}:${base}`;
    }
    samples.set(id, { id, name: prettyName(id), kind: id.startsWith('mem:') ? 'mem' : 'user', buffer });
    ids.push(id);
  }
  renderLibrary();
  return ids;
}

async function saveRecording(buffer) {
  const n = [...samples.values()].filter((s) => s.name.startsWith('Voice ')).length + 1;
  const name = `Voice ${n}`;
  if (S.connected()) {
    try {
      const id = await S.writeUnique('samples', name + '.wav', A.encodeWav(buffer));
      samples.set(id, { id, name: prettyName(id), kind: 'user', buffer });
      return id;
    } catch (e) { toast(`Couldn't save the recording to your folder: ${e.message}`, true); }
  }
  const id = `mem:${uid()}:${name}`;
  samples.set(id, { id, name, kind: 'mem', buffer });
  return id;
}

// Move sounds that only exist in memory into the folder once one is chosen.
async function migrateMemSamples() {
  const remap = {};
  for (const s of [...samples.values()]) {
    if (s.kind !== 'mem' || !s.buffer) continue;
    const id = await S.writeUnique('samples', S.safeName(s.name) + '.wav', A.encodeWav(s.buffer));
    samples.delete(s.id);
    samples.set(id, { id, name: prettyName(id), kind: 'user', buffer: s.buffer });
    remap[s.id] = id;
  }
  for (const c of project.clips) if (remap[c.sample]) c.sample = remap[c.sample];
  for (const p of project.pads) if (p && remap[p.sample]) p.sample = remap[p.sample];
}

async function scanFolder() {
  if (!S.connected()) return;
  const names = await S.list('samples');
  for (const n of names) {
    if (!/\.(wav|mp3|ogg|flac|m4a|aac|opus|webm|mp4)$/i.test(n)) continue;
    if (!samples.has(n)) samples.set(n, { id: n, name: prettyName(n), kind: 'user', buffer: null });
  }
  renderLibrary();
}

// ── Library ──

let previewSrc = null;
async function preview(id, s0 = 0, s1 = null) {
  if (previewSrc) { try { previewSrc.stop(); } catch { /* already stopped */ } previewSrc = null; }
  const s = await ensureSample(id);
  if (!s) { toast('That sound is missing from your folder.', true); return; }
  await ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.connect(padBus);
  const end = s1 == null ? s.buffer.duration : s1;
  src.start(0, s0, Math.max(0.01, end - s0));
  previewSrc = src;
}

function libItem(s) {
  const dur = s.buffer ? s.buffer.duration.toFixed(1) + 's' : '';
  return `<li draggable="true" data-id="${esc(s.id)}" title="Drag onto a track or pad">
    <button data-act="play" title="Preview" aria-label="Preview">▶</button>
    <span class="nm">${esc(s.name)}</span><span class="dur">${dur}</span>
    <button data-act="add" title="Add at the playhead on the selected track" aria-label="Add to timeline">+</button>
    <button data-act="pad" title="Put on the first empty pad" aria-label="Put on a pad">▦</button>
  </li>`;
}

function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const match = (s) => !q || s.name.toLowerCase().includes(q);
  const mine = [...samples.values()].filter((s) => s.kind !== 'kit' && match(s)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const kit = [...samples.values()].filter((s) => s.kind === 'kit' && match(s));
  $('#libList').innerHTML = mine.length ? mine.map(libItem).join('')
    : `<li class="empty">${q ? 'Nothing matches.' : 'Import a file, drop one here, or record your voice.'}</li>`;
  $('#kitList').innerHTML = kit.map(libItem).join('');
}

function onLibClick(e) {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  const act = e.target.dataset.act;
  if (act === 'play') preview(id);
  else if (act === 'add') addClip(id, selectedTrack || project.tracks[0].id, transport.pos());
  else if (act === 'pad') {
    const i = project.pads.findIndex((p) => !p);
    if (i < 0) { toast('No empty pads. Drag the sound onto a pad to replace it.'); return; }
    setPad(i, { sample: id, s0: 0, s1: null, name: samples.get(id).name });
  }
}
for (const el of [$('#libList'), $('#kitList')]) {
  el.addEventListener('click', onLibClick);
  el.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    e.dataTransfer.setData('text/cb-sound', JSON.stringify({ sample: li.dataset.id }));
    e.dataTransfer.effectAllowed = 'copy';
  });
}
$('#libSearch').addEventListener('input', renderLibrary);
$('#btnImport').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const ids = await importFiles([...e.target.files]);
  e.target.value = '';
  if (ids.length === 1) addClip(ids[0], selectedTrack, transport.pos());
});

// ── Clips ──

async function addClip(sampleId, trackId, start, s0 = 0, s1 = null, opts = {}) {
  const s = await ensureSample(sampleId);
  if (!s) { toast('That sound could not be loaded.', true); return null; }
  if (!opts.noCheckpoint) checkpoint();
  if (!track(trackId)) trackId = project.tracks[0].id;
  const c = {
    id: uid(), track: trackId, sample: sampleId, name: opts.name || s.name,
    start: opts.noSnap ? Math.max(0, start) : snapT(start), srcStart: s0, srcEnd: s1 == null ? s.buffer.duration : s1,
    loops: 1, fx: { ...A.DEFAULT_FX },
  };
  project.clips.push(c);
  if (!opts.quiet) { selectedClip = c.id; selectedTrack = trackId; }
  changed();
  return c;
}

function renderKey(c) {
  const usesBpm = c.fx.stutter > 0 || c.fx.echo > 0;
  return JSON.stringify([c.sample, c.srcStart, c.srcEnd, c.fx, usesBpm ? project.bpm : 0]);
}

function getRender(c) {
  const key = renderKey(c);
  const r = renders.get(c.id);
  if (r && r.key === key) return r.promise;
  const entry = { key, buffer: null, promise: null };
  renders.set(c.id, entry);
  entry.promise = (async () => {
    await new Promise((res) => setTimeout(res)); // let the UI paint first
    const s = await ensureSample(c.sample);
    if (!s || renders.get(c.id) !== entry) return null;
    const buf = await A.renderClip(s.buffer, c, project.bpm);
    if (renders.get(c.id) === entry) {
      entry.buffer = buf;
      const el = document.querySelector(`.clip[data-id="${c.id}"]`);
      if (el) { el.classList.remove('busy'); drawClip(el, c); }
    }
    return buf;
  })().catch((e) => { console.error(e); toast('Could not process a clip: ' + e.message, true); return null; });
  return entry.promise;
}

function splitClip(c, t) {
  if (c.loops > 1) { toast('Set Loops to 1 before cutting this clip.'); return null; }
  const len = bodyLen(c);
  const srcLen = c.srcEnd - c.srcStart;
  const stut = len - srcLen / c.fx.speed;
  const rel = t - c.start - stut;
  if (rel <= 0.01 || rel >= srcLen / c.fx.speed - 0.01) return null;
  const cut = c.fx.reverse ? c.srcEnd - rel * c.fx.speed : c.srcStart + rel * c.fx.speed;
  const b = JSON.parse(JSON.stringify(c));
  b.id = uid();
  b.start = t;
  b.fx.stutter = 0;
  b.fx.fadeIn = 0;
  c.fx.fadeOut = 0;
  if (!c.fx.reverse) { c.srcEnd = cut; b.srcStart = cut; } else { c.srcStart = cut; b.srcEnd = cut; }
  project.clips.push(b);
  return b;
}

function deleteClip(id) {
  checkpoint();
  project.clips = project.clips.filter((c) => c.id !== id);
  renders.delete(id);
  if (selectedClip === id) selectedClip = null;
  changed();
}

function duplicateClip(c) {
  checkpoint();
  const b = JSON.parse(JSON.stringify(c));
  b.id = uid();
  b.start = c.start + fullLen(c);
  project.clips.push(b);
  selectedClip = b.id;
  changed();
}

function autoChop(c, mode, sens) {
  const s = samples.get(c.sample);
  if (!s || !s.buffer) return;
  const pts = (mode === 'words' ? detectWords : detectHits)(s.buffer, c.srcStart, c.srcEnd, sens);
  if (!pts.length) { toast('No cut points found. Try a higher sensitivity.'); return; }
  if (c.loops > 1) { toast('Set Loops to 1 before chopping this clip.'); return; }
  checkpoint();
  const len = bodyLen(c);
  const srcLen = c.srcEnd - c.srcStart;
  const stut = len - srcLen / c.fx.speed;
  const times = pts
    .map((p) => c.start + stut + (c.fx.reverse ? srcLen - p : p) / c.fx.speed)
    .sort((a, b) => a - b);
  let cur = c;
  let n = 0;
  for (const t of times) {
    const b = splitClip(cur, t);
    if (b) { cur = b; n++; }
  }
  toast(`Chopped into ${n + 1} pieces. Drag them around, or send them to pads.`);
  changed();
}

function chopsToPads(c) {
  // Every piece that came from the same sound on this track, left to right.
  const pieces = project.clips
    .filter((x) => x.track === c.track && x.sample === c.sample)
    .sort((a, b) => a.start - b.start);
  let placed = 0;
  checkpoint();
  for (const p of pieces) {
    const i = project.pads.findIndex((x) => !x);
    if (i < 0) break;
    project.pads[i] = { sample: p.sample, s0: p.srcStart, s1: p.srcEnd, name: `${p.name} ${placed + 1}` };
    placed++;
  }
  if (!placed) toast('No empty pads. Clear a pad first (hover it and press ×).');
  else toast(`${placed} chop${placed > 1 ? 's' : ''} sent to pads.`);
  changed();
  renderPads();
}

// ── Timeline rendering ──

const tl = $('#tl');
const tlInner = $('#tlInner');
const headW = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-w')) || 168;

function contentSec() { return Math.max(90, songEnd(true) + 30, (project.loop ? project.loop.b : 0) + 30); }

function renderTimeline() {
  const W = contentSec() * pps;
  tlInner.style.width = headW() + W + 'px';
  const bpx = beat() * pps;
  const grid = `repeating-linear-gradient(to right, var(--rule) 0 1px, transparent 1px ${bpx * 4}px),` +
    (bpx > 12 ? `repeating-linear-gradient(to right, color-mix(in srgb, var(--rule) 45%, transparent) 0 1px, transparent 1px ${bpx}px)` : 'none');

  const rows = project.tracks.map((t) => {
    const clips = project.clips.filter((c) => c.track === t.id).map((c) => {
      const s = samples.get(c.sample);
      const r = renders.get(c.id);
      const busy = !(r && r.buffer && r.key === renderKey(c));
      const cls = ['clip', c.id === selectedClip ? 'selected' : '', s && s.missing ? 'missing' : '', busy ? 'busy' : ''].join(' ');
      const marks = [];
      for (let i = 1; i < c.loops; i++) marks.push(`<span class="loop-mark" style="left:${(i / c.loops) * 100}%"></span>`);
      return `<div class="${cls}" data-id="${c.id}" style="left:${c.start * pps}px;width:${fullLen(c) * pps}px">
        <span class="clip-name">${esc(c.name)}${c.fx.reverse ? ' ⇠' : ''}</span><canvas></canvas>${marks.join('')}
        <div class="h h-l"></div><div class="h h-r"></div></div>`;
    }).join('');
    return `<div class="row ${t.id === selectedTrack ? 'selected' : ''}" data-track="${t.id}" style="--tc:${t.colour}">
      <div class="th">
        <div class="th-top">
          <input class="th-name" value="${esc(t.name)}" aria-label="Track name" spellcheck="false" />
          <button class="th-btn" data-act="mute" aria-pressed="${t.mute}" title="Mute">M</button>
          <button class="th-btn" data-act="solo" aria-pressed="${t.solo}" title="Solo">S</button>
          <button class="th-btn x" data-act="del" title="Delete track" aria-label="Delete track">×</button>
        </div>
        <input type="range" min="0" max="1.2" step="0.01" value="${t.vol}" data-act="vol" aria-label="Track volume" title="Volume" />
        <span class="rec-target">● Records here</span>
      </div>
      <div class="lane" data-track="${t.id}" style="background-image:${grid}">${clips}</div>
    </div>`;
  }).join('');
  $('#tracks').innerHTML = rows +
    (project.clips.length ? '' : `<div class="empty-tl"><h3>Make something.</h3>
      <p>Drop a TikTok video or any audio file here, or press <strong>●</strong> to record your voice.</p>
      <p>Then chop it up, drag the pieces around, and add some drums from the pads.</p></div>`);

  for (const el of $('#tracks').querySelectorAll('.clip')) {
    const c = clipById(el.dataset.id);
    drawClip(el, c);
    const r = renders.get(c.id);
    if (!(r && r.key === renderKey(c))) getRender(c);
  }
  drawRuler();
  placePlayhead();
  placeLoop();
  updateTrackGains();
}

function drawClip(el, c) {
  const cv = el.querySelector('canvas');
  if (!c || !cv) return;
  const len = bodyLen(c);
  const w = Math.max(2, Math.min(6000, Math.round(fullLen(c) * pps)));
  const h = Math.max(10, (el.clientHeight || 60) - 14);
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const r = renders.get(c.id);
  let buf, s0, s1, reverse = false;
  if (r && r.buffer && r.key === renderKey(c)) { buf = r.buffer; s0 = 0; s1 = Math.min(len, buf.duration); }
  else {
    const s = samples.get(c.sample);
    if (!s || !s.buffer) return;
    buf = s.buffer; s0 = c.srcStart; s1 = c.srcEnd; reverse = c.fx.reverse;
  }
  const per = Math.max(1, Math.floor(w / c.loops));
  const pk = A.peaks(buf, s0, s1, per);
  g.fillStyle = getComputedStyle(el).color;
  for (let l = 0; l < c.loops; l++) {
    for (let i = 0; i < per; i++) {
      const v = Math.min(1, Math.sqrt(pk[reverse ? per - 1 - i : i]) * 1.1);
      const bh = Math.max(1, v * h * 0.92);
      g.fillRect(l * per + i, (h - bh) / 2, 1, bh);
    }
  }
}

function drawRuler() {
  const view = $('.ruler-view');
  const cv = $('#ruler');
  const w = Math.max(10, tl.clientWidth - headW());
  view.style.width = w + 'px';
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr;
  cv.height = 28 * dpr;
  cv.style.width = w + 'px';
  cv.style.height = '28px';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const off = tl.scrollLeft;
  const t0 = off / pps;
  const t1 = (off + w) / pps;
  if (project.loop) {
    g.fillStyle = project.loopOn ? cssVar('--stone') : cssVar('--rule');
    g.globalAlpha = 0.45;
    g.fillRect(project.loop.a * pps - off, 0, (project.loop.b - project.loop.a) * pps, 28);
    g.globalAlpha = 1;
  }
  g.font = '10px Inter, sans-serif';
  const barPx = bar() * pps;
  const every = Math.max(1, Math.ceil(46 / barPx));
  for (let b = Math.floor(t0 / bar()); b * bar() <= t1; b++) {
    const x = Math.round(b * bar() * pps - off) + 0.5;
    g.fillStyle = cssVar('--stone');
    g.fillRect(x, b % every === 0 ? 12 : 20, 1, 28);
    if (b % every === 0) g.fillText(String(b + 1), x + 3, 11);
    if (barPx > 40) for (let k = 1; k < 4; k++) g.fillRect(Math.round(x + k * beat() * pps), 23, 1, 5);
  }
}

function placePlayhead() {
  $('#playhead').style.left = headW() + transport.pos() * pps + 'px';
}
function placeLoop() {
  const band = $('#loopBand');
  if (!project.loop) { band.hidden = true; return; }
  band.hidden = false;
  band.classList.toggle('off', !project.loopOn);
  band.style.left = headW() + project.loop.a * pps + 'px';
  band.style.width = (project.loop.b - project.loop.a) * pps + 'px';
}

tl.addEventListener('scroll', drawRuler);
window.addEventListener('resize', () => { drawRuler(); });
tl.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = tl.getBoundingClientRect();
  const x = e.clientX - rect.left - headW();
  const t = (tl.scrollLeft + x) / pps;
  setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  tl.scrollLeft = t * pps - x;
}, { passive: false });

function setZoom(v) {
  pps = clamp(v, 15, 400);
  $('#zoom').value = pps;
  pref.set('pps', pps);
  renderTimeline();
}
$('#zoom').addEventListener('input', (e) => setZoom(+e.target.value));

// Song time under a pointer.
function timeAt(clientX) {
  const rect = tl.getBoundingClientRect();
  return Math.max(0, (clientX - rect.left - headW() + tl.scrollLeft) / pps);
}

// ── Track header events ──

$('#tracks').addEventListener('input', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const t = track(row.dataset.track);
  if (e.target.dataset.act === 'vol') { beginEdit(); t.vol = +e.target.value; updateTrackGains(); }
  if (e.target.classList.contains('th-name')) { beginEdit(); t.name = e.target.value; }
});
$('#tracks').addEventListener('change', (e) => { if (e.target.closest('.th')) { endEdit(); } });
$('#tracks').addEventListener('click', (e) => {
  const th = e.target.closest('.th');
  if (!th) return;
  const row = th.closest('.row');
  const t = track(row.dataset.track);
  const act = e.target.dataset.act;
  if (act === 'mute' || act === 'solo') {
    checkpoint();
    t[act] = !t[act];
    changed();
    return;
  }
  if (act === 'del') {
    const n = project.clips.filter((c) => c.track === t.id).length;
    if (project.tracks.length === 1) { toast('You need at least one track.'); return; }
    if (n && !confirm(`Delete "${t.name}" and its ${n} clip${n > 1 ? 's' : ''}?`)) return;
    checkpoint();
    project.tracks = project.tracks.filter((x) => x !== t);
    project.clips = project.clips.filter((c) => c.track !== t.id);
    if (selectedTrack === t.id) selectedTrack = project.tracks[0].id;
    changed();
    return;
  }
});
function selectTrack(id) {
  if (selectedTrack === id) return;
  selectedTrack = id;
  for (const r of document.querySelectorAll('.row')) r.classList.toggle('selected', r.dataset.track === id);
}
$('#btnAddTrack').addEventListener('click', () => addTrack());
function addTrack(name) {
  checkpoint();
  const t = newTrack(name || `Track ${project.tracks.length + 1}`, project.tracks.length);
  project.tracks.push(t);
  selectedTrack = t.id;
  changed();
  return t;
}
function findOrAddTrack(name) {
  return project.tracks.find((t) => t.name === name) || (() => {
    const t = newTrack(name, project.tracks.length);
    project.tracks.push(t);
    return t;
  })();
}

// ── Clip & lane pointer interactions ──

let drag = null;

$('#tracks').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const th = e.target.closest('.th');
  if (th) { selectTrack(th.closest('.row').dataset.track); return; }
  const lane = e.target.closest('.lane');
  if (!lane) return;
  const clipEl = e.target.closest('.clip');
  const t = timeAt(e.clientX);
  selectedTrack = lane.dataset.track;

  if (!clipEl) {
    selectedClip = null;
    if (!transport.playing) transport.seek(project.snap ? snapT(t) : t);
    else transport.seek(t);
    renderTimeline();
    renderInspector();
    return;
  }
  const c = clipById(clipEl.dataset.id);
  if (tool === 'chop' || e.shiftKey) {
    checkpoint();
    const b = splitClip(c, project.snap ? snapT(t) : t);
    if (!b) undoStack.pop();
    else selectedClip = b.id;
    changed();
    return;
  }
  e.preventDefault();
  let target = c;
  const before = snap();
  if (e.altKey) {
    target = JSON.parse(JSON.stringify(c));
    target.id = uid();
    project.clips.push(target);
  }
  selectedClip = target.id;
  const mode = e.target.classList.contains('h-l') ? 'left' : e.target.classList.contains('h-r') ? 'right' : 'move';
  drag = {
    mode, c: target, before, moved: e.altKey, x0: e.clientX, y0: e.clientY,
    start: target.start, srcStart: target.srcStart, srcEnd: target.srcEnd, len: bodyLen(target),
    grabOffset: t - target.start,
  };
  if (e.altKey) renderTimeline();
  else {
    for (const el of document.querySelectorAll('.clip.selected')) el.classList.remove('selected');
    clipEl.classList.add('selected');
  }
  renderInspector();
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3 && Math.abs(e.clientY - drag.y0) < 3) return;
  drag.moved = true;
  const c = drag.c;
  const el = document.querySelector(`.clip[data-id="${c.id}"]`);
  if (!el) return;
  el.classList.add('dragging');
  const t = timeAt(e.clientX);
  const s = samples.get(c.sample);
  const srcDur = s && s.buffer ? s.buffer.duration : c.srcEnd;
  const sp = c.fx.speed;

  if (drag.mode === 'move') {
    c.start = project.snap ? snapT(t - drag.grabOffset) : Math.max(0, t - drag.grabOffset);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const lane = under && under.closest('.lane');
    if (lane && lane.dataset.track !== c.track) { c.track = lane.dataset.track; lane.appendChild(el); }
    el.style.left = c.start * pps + 'px';
  } else if (drag.mode === 'left') {
    let ns = project.snap ? snapT(t) : t;
    let d = ns - drag.start;
    // Keep inside the source and at least 20 ms long.
    const room = c.fx.reverse ? (srcDur - drag.srcEnd) / sp : drag.srcStart / sp;
    d = clamp(d, -room, drag.len - 0.02);
    c.start = drag.start + d;
    if (c.fx.reverse) c.srcEnd = drag.srcEnd - d * sp; else c.srcStart = drag.srcStart + d * sp;
    el.style.left = c.start * pps + 'px';
    el.style.width = fullLen(c) * pps + 'px';
    drawClip(el, c);
  } else {
    const end = project.snap ? snapT(t) : t;
    let d = end - (drag.start + drag.len);
    const room = c.fx.reverse ? drag.srcStart / sp : (srcDur - drag.srcEnd) / sp;
    d = clamp(d, -(drag.len - 0.02), room);
    if (c.fx.reverse) c.srcStart = drag.srcStart - d * sp; else c.srcEnd = drag.srcEnd + d * sp;
    el.style.width = fullLen(c) * pps + 'px';
    drawClip(el, c);
  }
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.moved) { checkpoint(d.before); changed(); }
});

// Drop sounds or files onto the timeline.
tl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  for (const l of document.querySelectorAll('.lane.over')) l.classList.remove('over');
  const lane = e.target.closest('.lane');
  if (lane) lane.classList.add('over');
});
tl.addEventListener('dragleave', (e) => { if (!tl.contains(e.relatedTarget)) for (const l of document.querySelectorAll('.lane.over')) l.classList.remove('over'); });
tl.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  for (const l of document.querySelectorAll('.lane.over')) l.classList.remove('over');
  const lane = e.target.closest('.lane');
  const trackId = lane ? lane.dataset.track : selectedTrack;
  const t = timeAt(e.clientX);
  const sound = e.dataTransfer.getData('text/cb-sound');
  if (sound) {
    const d = JSON.parse(sound);
    addClip(d.sample, trackId, t, d.s0 || 0, d.s1 ?? null, d.name ? { name: d.name } : {});
    return;
  }
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  const ids = await importFiles(files);
  let at = t;
  for (const id of ids) {
    const c = await addClip(id, trackId, at);
    if (c) at = c.start + fullLen(c);
  }
});
// Files dropped elsewhere still import into the library.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  if (files.length) await importFiles(files);
});

// Ruler: click to move the playhead, drag to mark a loop.
$('.ruler-view').addEventListener('pointerdown', (e) => {
  const t0 = timeAt(e.clientX);
  let moved = false;
  const move = (ev) => {
    const t1 = timeAt(ev.clientX);
    if (!moved && Math.abs(t1 - t0) * pps < 5) return;
    moved = true;
    const a = snapT(Math.min(t0, t1), true);
    const b = snapT(Math.max(t0, t1), true);
    if (b - a > 0.05) { project.loop = { a, b }; project.loopOn = true; syncControls(); drawRuler(); placeLoop(); }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved) transport.seek(project.snap ? snapT(t0) : t0);
    else changed();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// ── Inspector ──

const pct = (v) => Math.round(v * 100) + '%';
const FX_UI = [
  ['Voice', [
    ['pitch', 'Pitch', -24, 24, 1, (v) => (v > 0 ? '+' : '') + v + ' semitones'],
    ['speed', 'Speed', 0.25, 3, 0.01, (v) => v.toFixed(2) + '×'],
    ['wobble', 'Warp', 0, 1, 0.01, pct],
    ['robot', 'Robot', 0, 1, 0.01, pct],
  ]],
  ['Tone', [
    ['filter', 'Muffled / tinny', -1, 1, 0.01, (v) => (v < -0.005 ? 'Muffled ' + pct(-v) : v > 0.005 ? 'Tinny ' + pct(v) : 'Off')],
    ['drive', 'Distortion', 0, 1, 0.01, pct],
    ['crush', 'Lo-fi', 0, 1, 0.01, pct],
  ]],
  ['Space', [
    ['echo', 'Echo', 0, 1, 0.01, pct],
    ['reverb', 'Reverb', 0, 1, 0.01, pct],
  ]],
  ['Level', [
    ['gain', 'Volume', -24, 12, 0.5, (v) => (v > 0 ? '+' : '') + v + ' dB'],
    ['fadeIn', 'Fade in', 0, 3, 0.01, (v) => v.toFixed(2) + 's'],
    ['fadeOut', 'Fade out', 0, 3, 0.01, (v) => v.toFixed(2) + 's'],
  ]],
];

const PRESETS = {
  Deep: { pitch: -5 },
  Demon: { pitch: -12, drive: 0.3, reverb: 0.3 },
  Chipmunk: { pitch: 8, speed: 1.1 },
  Robot: { robot: 0.85, crush: 0.15 },
  Warped: { wobble: 0.6, filter: -0.15 },
  Radio: { filter: 0.6, drive: 0.45 },
  'Slowed + reverb': { speed: 0.8, pitch: -4, reverb: 0.5 },
  'Sped up': { speed: 1.25, pitch: 4 },
  Underwater: { filter: -0.8, wobble: 0.3, reverb: 0.3 },
  Echoey: { echo: 0.5, reverb: 0.2 },
};

const STUTTER_DIVS = [[0.125, '1/32'], [0.25, '1/16'], [0.5, '1/8'], [1, '1 beat']];

function renderInspector() {
  const el = $('#inspector');
  const c = selectedClip && clipById(selectedClip);
  if (!c) {
    el.innerHTML = `<h2>No clip selected</h2>
      <p class="meta">Click a clip to change its sound.</p>
      <section><h3>Quick start</h3>
      <p class="hint">1. Choose a folder (top right) so your sounds, projects and exports save on your PC.</p>
      <p class="hint">2. Drop in a TikTok video or audio file, or press ● to record your voice onto the highlighted track.</p>
      <p class="hint">3. Select a clip, then use Auto-chop to cut it into words or hits.</p>
      <p class="hint">4. Drag pieces around, add drums from Pads, then Export.</p></section>`;
    return;
  }
  const fx = c.fx;
  const s = samples.get(c.sample);
  const sliders = FX_UI.map(([title, rows]) => `<section><h3>${title}</h3>${rows.map(([k, label, min, max, step, fmt]) =>
    `<div class="fx-row"><label for="fx-${k}" title="Double-click to reset">${label}</label><output id="out-${k}">${fmt(fx[k])}</output>
     <input id="fx-${k}" data-k="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${fx[k]}" /></div>`).join('')}</section>`).join('');

  el.innerHTML = `<h2>${esc(c.name)}</h2>
    <p class="meta">${fmtBars(c.start)} · ${bodyLen(c).toFixed(2)}s${c.loops > 1 ? ' × ' + c.loops : ''}${s && s.missing ? ' · sound file missing' : ''}</p>
    <section><h3>Voice presets</h3><div class="presets">
      ${Object.keys(PRESETS).map((p) => `<button class="btn small" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}
      <button class="btn small" data-preset="">Clean</button></div></section>
    ${sliders}
    <section><h3>Chop & repeat</h3>
      <div class="inline">
        <label class="check"><input type="checkbox" id="fxReverse" ${fx.reverse ? 'checked' : ''}/> Reverse</label>
        <label class="lbl">Loops <input type="number" id="fxLoops" min="1" max="64" value="${c.loops}" /></label>
      </div>
      <div class="fx-row"><label for="fx-stutter">Stutter</label><output id="out-stutter">${fx.stutter ? fx.stutter + '×' : 'Off'}</output>
        <input id="fx-stutter" data-k="stutter" type="range" min="0" max="8" step="1" value="${fx.stutter}" /></div>
      <div class="inline"><label class="lbl">Stutter length
        <select id="fxStutDiv">${STUTTER_DIVS.map(([v, l]) => `<option value="${v}" ${fx.stutterDiv === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="actions">
        <button class="btn small" id="actFit" title="Stretch so it lasts a whole number of bars (keeps pitch)">Fit to bars</button>
        <button class="btn small" id="actBpm" title="Guess the tempo of this clip and set the project BPM">Detect BPM</button>
      </div>
    </section>
    <section><h3>Auto-chop</h3>
      <div class="inline">
        <select id="chopMode"><option value="words">Words / phrases</option><option value="hits">Beats / hits</option></select>
        <label class="lbl">More <input id="chopSens" type="range" min="0" max="1" step="0.05" value="${pref.get('chopSens', 0.5)}" style="width:70px" /></label>
      </div>
      <div class="actions">
        <button class="btn small primary" id="actChop">Auto-chop</button>
        <button class="btn small" id="actPads" title="Put each piece of this sound on this track onto empty pads">Chops to pads</button>
      </div>
      <p class="hint">Words cuts at the pauses. Beats cuts at each hit. Slide right for more pieces.</p>
    </section>
    <section><h3>Clip</h3><div class="actions">
      <button class="btn small" id="actSplit" title="Cut at the playhead (S)">Cut at playhead</button>
      <button class="btn small" id="actDup" title="Duplicate (Ctrl+D)">Duplicate</button>
      <button class="btn small" id="actPad">Send to pad</button>
      <button class="btn small" id="actPreview">Preview</button>
      <button class="btn small danger" id="actDel" title="Delete">Delete</button>
    </div></section>`;
  $('#chopMode').value = pref.get('chopMode', 'words');
}

let rerenderTimer = 0;
function fxChanged() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => { renderTimeline(); scheduleSave(); }, 220);
}

$('#inspector').addEventListener('input', (e) => {
  const c = selectedClip && clipById(selectedClip);
  if (!c) return;
  const k = e.target.dataset.k;
  if (k) {
    beginEdit();
    c.fx[k] = +e.target.value;
    const row = FX_UI.flatMap((g) => g[1]).find((r) => r[0] === k);
    $('#out-' + k).textContent = row ? row[5](c.fx[k]) : (c.fx[k] ? c.fx[k] + '×' : 'Off');
    fxChanged();
  }
  if (e.target.id === 'chopSens') pref.set('chopSens', +e.target.value);
});
$('#inspector').addEventListener('change', (e) => {
  const c = selectedClip && clipById(selectedClip);
  if (!c) return;
  if (e.target.dataset.k) { endEdit(); return; }
  if (e.target.id === 'fxReverse') { checkpoint(); c.fx.reverse = e.target.checked; changed(); }
  if (e.target.id === 'fxLoops') { checkpoint(); c.loops = clamp(Math.round(+e.target.value) || 1, 1, 64); changed(); }
  if (e.target.id === 'fxStutDiv') { checkpoint(); c.fx.stutterDiv = +e.target.value; changed(); }
  if (e.target.id === 'chopMode') pref.set('chopMode', e.target.value);
});
$('#inspector').addEventListener('dblclick', (e) => {
  const c = selectedClip && clipById(selectedClip);
  const lab = e.target.closest('.fx-row label');
  if (!c || !lab) return;
  const k = lab.getAttribute('for').slice(3);
  checkpoint();
  c.fx[k] = A.DEFAULT_FX[k];
  changed();
});
$('#inspector').addEventListener('click', (e) => {
  const c = selectedClip && clipById(selectedClip);
  if (!c) return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.preset !== undefined) {
    checkpoint();
    const keep = { gain: c.fx.gain, fadeIn: c.fx.fadeIn, fadeOut: c.fx.fadeOut, stutter: c.fx.stutter, stutterDiv: c.fx.stutterDiv, reverse: c.fx.reverse };
    c.fx = { ...A.DEFAULT_FX, ...keep, ...(PRESETS[b.dataset.preset] || {}) };
    changed();
    return;
  }
  switch (b.id) {
    case 'actSplit': cutAtPlayhead(); break;
    case 'actDup': duplicateClip(c); break;
    case 'actDel': deleteClip(c.id); break;
    case 'actPreview': previewClip(c); break;
    case 'actChop': autoChop(c, $('#chopMode').value, +$('#chopSens').value); break;
    case 'actPads': chopsToPads(c); break;
    case 'actPad': {
      const i = project.pads.findIndex((p) => !p);
      if (i < 0) { toast('No empty pads. Clear one first.'); break; }
      setPad(i, { sample: c.sample, s0: c.srcStart, s1: c.srcEnd, name: c.name });
      break;
    }
    case 'actFit': {
      const len = (c.srcEnd - c.srcStart);
      const bars = Math.max(1, Math.round(len / bar()));
      checkpoint();
      c.fx.speed = clamp(len / (bars * bar()), 0.25, 3);
      c.fx.stutter = 0;
      changed();
      toast(`Fitted to ${bars} bar${bars > 1 ? 's' : ''}.`);
      break;
    }
    case 'actBpm': {
      const s = samples.get(c.sample);
      const g = s && s.buffer && guessBpm(s.buffer, c.srcStart, c.srcEnd);
      if (!g) { toast('Could not hear a steady beat in this clip.'); break; }
      checkpoint();
      project.bpm = g;
      syncControls();
      changed();
      toast(`Tempo set to ${g} BPM.`);
      break;
    }
  }
});

async function previewClip(c) {
  const buf = await getRender(c);
  if (!buf) return;
  await ctx.resume();
  if (previewSrc) { try { previewSrc.stop(); } catch { /* ok */ } }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(padBus);
  src.start();
  previewSrc = src;
}

function cutAtPlayhead() {
  const t = transport.pos();
  const c = (selectedClip && clipById(selectedClip)) ||
    project.clips.find((x) => x.track === selectedTrack && t > x.start && t < x.start + fullLen(x));
  if (!c) { toast('Select a clip under the playhead first.'); return; }
  checkpoint();
  const b = splitClip(c, t);
  if (!b) { undoStack.pop(); toast('The playhead is not inside that clip.'); return; }
  selectedClip = b.id;
  changed();
}

// ── Audio graph & transport ──

const master = ctx.createGain();
const analyser = ctx.createAnalyser();
analyser.fftSize = 512;
analyser.smoothingTimeConstant = 0.75;
master.connect(analyser).connect(ctx.destination);
const padBus = ctx.createGain();
padBus.connect(master);
const trackGains = new Map();

function trackGain(id) {
  let g = trackGains.get(id);
  if (!g) { g = ctx.createGain(); g.connect(master); trackGains.set(id, g); }
  return g;
}
function trackLevel(t, list) {
  const solo = list.some((x) => x.solo);
  return t.mute || (solo && !t.solo) ? 0 : t.vol;
}
function updateTrackGains() {
  for (const t of project.tracks) trackGain(t.id).gain.setTargetAtTime(trackLevel(t, project.tracks), ctx.currentTime, 0.01);
}

function click(when, accent) {
  const o = ctx.createOscillator();
  transport.sources.add(o);
  o.onended = () => transport.sources.delete(o);
  const g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(when);
  o.stop(when + 0.06);
}

const transport = {
  playing: false,
  head: 0,
  passes: [],
  sources: new Set(),
  range: null,

  pos(at) {
    if (!this.playing) return this.head;
    const now = at ?? ctx.currentTime;
    const ps = this.passes;
    for (let i = ps.length - 1; i >= 0; i--) {
      if (now >= ps[i].ctx) return Math.min(ps[i].b, ps[i].a + (now - ps[i].ctx));
    }
    return ps.length ? ps[0].a - (ps[0].ctx - now) : this.head;
  },

  seek(t) {
    const was = this.playing;
    if (was) this.stop(true);
    this.head = Math.max(0, t);
    if (was) this.play();
    placePlayhead();
    updateClock();
  },

  async play() {
    if (this.playing) return;
    await ctx.resume();
    $('#btnPlay').disabled = true;
    await Promise.all(project.clips.map(getRender));
    $('#btnPlay').disabled = false;
    const loop = project.loopOn && project.loop;
    let a = this.head;
    let b;
    if (loop) {
      if (a < loop.a || a >= loop.b) a = loop.a;
      b = loop.b;
    } else {
      b = Math.max(songEnd(true), a + 0.1);
      if (a >= songEnd(true) - 0.01 && !recorder.active) a = 0;
      if (recorder.active) b = Infinity;
    }
    this.playing = true;
    this.range = { a, b, loop: !!loop };
    this.passes = [];
    this.schedulePass(a, b, ctx.currentTime + 0.06);
    $('#btnPlay').textContent = '❚❚';
    $('#btnPlay').setAttribute('aria-label', 'Pause');
  },

  schedulePass(a, b, t0) {
    this.passes.push({ a, b, ctx: t0, next: false });
    if (this.passes.length > 4) this.passes.shift();
    for (const c of project.clips) {
      const r = renders.get(c.id);
      const buf = r && r.buffer;
      if (!buf) continue;
      const len = bodyLen(c);
      for (let i = 0; i < c.loops; i++) {
        const s = c.start + i * len;
        if (s >= b || s + buf.duration <= a) continue;
        const off = Math.max(0, a - s);
        const when = t0 + Math.max(0, s - a);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(trackGain(c.track));
        src.start(when, off);
        src.onended = () => this.sources.delete(src);
        this.sources.add(src);
      }
    }
    this.passes[this.passes.length - 1].clicked = a;
    this.scheduleClicks(this.passes[this.passes.length - 1], a + 20);
  },

  // Metronome clicks are scheduled in short batches so stopping never leaves any behind.
  scheduleClicks(pass, until) {
    if (!project.metronome) { pass.clicked = Math.max(pass.clicked, until); return; }
    const bt = beat();
    const end = Math.min(pass.b, until);
    for (let t = Math.ceil(pass.clicked / bt - 1e-6) * bt; t < end; t += bt) {
      if (t >= pass.clicked) click(pass.ctx + (t - pass.a), Math.round(t / bt) % 4 === 0);
    }
    pass.clicked = Math.max(pass.clicked, end);
  },

  stop(keepHead) {
    if (!this.playing) return;
    const p = this.pos();
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources.clear();
    this.playing = false;
    if (!keepHead) this.head = Math.max(0, p);
    $('#btnPlay').textContent = '▶';
    $('#btnPlay').setAttribute('aria-label', 'Play');
  },

  tick() {
    if (!this.playing) return;
    const r = this.range;
    const last = this.passes[this.passes.length - 1];
    if (last.clicked < this.pos() + 2) this.scheduleClicks(last, last.clicked + 20);
    if (r.loop) {
      const end = last.ctx + (last.b - last.a);
      if (!last.next && ctx.currentTime > end - 0.3) {
        last.next = true;
        this.schedulePass(r.a, r.b, end);
      }
    } else if (!recorder.active && this.pos() >= r.b) {
      this.stop();
      this.head = 0;
    }
  },
};

function updateClock() {
  const t = transport.pos();
  $('#clock').innerHTML = `${fmtTime(t)}<small>${fmtBars(t)}</small>`;
}

function frame() {
  transport.tick();
  if (transport.playing) {
    const t = transport.pos();
    placePlayhead();
    updateClock();
    const x = t * pps;
    const view = tl.clientWidth - headW();
    if (!drag && (x < tl.scrollLeft || x > tl.scrollLeft + view - 40)) tl.scrollLeft = x - 40;
  }
  drawViz();
  seq.tick();
  requestAnimationFrame(frame);
}

const vizData = new Uint8Array(analyser.frequencyBinCount);
function drawViz() {
  const cv = $('#viz');
  const g = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);
  analyser.getByteFrequencyData(vizData);
  g.fillStyle = cssVar('--ink');
  const bars = 32;
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const lo = Math.floor(Math.pow(i / bars, 2) * vizData.length * 0.7);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 2) * vizData.length * 0.7));
    let m = 0;
    for (let j = lo; j < hi; j++) m = Math.max(m, vizData[j]);
    const bh = Math.max(1, (m / 255) * h);
    g.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  }
}

$('#btnPlay').addEventListener('click', () => (transport.playing ? stopAll() : transport.play()));
$('#btnStart').addEventListener('click', () => transport.seek(project.loopOn && project.loop ? project.loop.a : 0));

function stopAll() {
  if (recorder.active) recorder.stop();
  transport.stop();
  placePlayhead();
  updateClock();
}

// ── Recording ──

const WORKLET = `class R extends AudioWorkletProcessor{process(i){const x=i[0];if(x&&x.length)this.port.postMessage({t:currentTime,ch:x.map(c=>c.slice())});return true}}registerProcessor('cb-rec',R);`;

const recorder = {
  active: false,
  stream: null,
  node: null,
  srcNode: null,
  chunks: [],
  firstT: null,
  track: null,

  async start() {
    if (this.active) return;
    await ctx.resume();
    try {
      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: pref.get('cleanMic', true), autoGainControl: false, channelCount: 1 },
        });
      }
    } catch (e) {
      toast('Microphone blocked. Allow it in the address bar (the camera/mic icon) and try again.', true);
      return;
    }
    if (!this.node) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(ctx, 'cb-rec');
      const sink = ctx.createGain();
      sink.gain.value = 0;
      this.node.connect(sink).connect(ctx.destination);
      this.srcNode = ctx.createMediaStreamSource(this.stream);
    }
    this.chunks = [];
    this.firstT = null;
    this.track = selectedTrack;
    this.node.port.onmessage = (e) => {
      if (!this.active) return;
      if (this.firstT === null) this.firstT = e.data.t;
      this.chunks.push(e.data.ch);
    };
    this.active = true;
    this.srcNode.connect(this.node);
    $('#btnRec').classList.add('on');
    if (!transport.playing) await transport.play();
    else if (!transport.range.loop) transport.range.b = transport.passes[transport.passes.length - 1].b = Infinity;
  },

  async stop() {
    if (!this.active) return;
    this.active = false;
    this.srcNode.disconnect();
    $('#btnRec').classList.remove('on');
    if (!this.chunks.length) return;
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    let start = transport.pos(this.firstT) - latency;
    const chs = this.chunks[0].length;
    const len = this.chunks.reduce((n, c) => n + c[0].length, 0);
    const buf = ctx.createBuffer(chs, len, SR);
    for (let c = 0; c < chs; c++) {
      const d = buf.getChannelData(c);
      let o = 0;
      for (const ch of this.chunks) { d.set(ch[c], o); o += ch[c].length; }
    }
    this.chunks = [];
    let s0 = 0;
    if (start < 0) { s0 = -start; start = 0; }
    const id = await saveRecording(buf);
    renderLibrary();
    await addClip(id, this.track, start, Math.min(s0, buf.duration - 0.01), null, { noSnap: true });
    toast('Recording added. Select it to add effects or auto-chop it.');
  },
};

$('#btnRec').addEventListener('click', () => {
  if (recorder.active) { recorder.stop(); transport.stop(); } else recorder.start();
});

// ── Pads ──

const padBtns = [];
function buildPadGrid() {
  const grid = $('#padGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('div');
    b.className = 'pad';
    b.dataset.i = i;
    b.tabIndex = 0;
    b.setAttribute('role', 'button');
    grid.appendChild(b);
    padBtns.push(b);
  }
  grid.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad || e.target.classList.contains('clear')) return;
    hitPad(+pad.dataset.i);
  });
  grid.addEventListener('click', (e) => {
    if (!e.target.classList.contains('clear')) return;
    const i = +e.target.closest('.pad').dataset.i;
    checkpoint();
    project.pads[i] = null;
    delete project.pattern[i];
    changed();
    renderPads();
  });
  grid.addEventListener('dragstart', (e) => {
    const pad = e.target.closest('.pad');
    const p = pad && project.pads[+pad.dataset.i];
    if (!p) return;
    e.dataTransfer.setData('text/cb-sound', JSON.stringify(p));
  });
  grid.addEventListener('dragover', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    e.preventDefault();
    e.stopPropagation();
    pad.classList.add('over');
  });
  grid.addEventListener('dragleave', (e) => { const pad = e.target.closest('.pad'); if (pad) pad.classList.remove('over'); });
  grid.addEventListener('drop', async (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    e.preventDefault();
    e.stopPropagation();
    pad.classList.remove('over');
    const i = +pad.dataset.i;
    const sound = e.dataTransfer.getData('text/cb-sound');
    if (sound) {
      const d = JSON.parse(sound);
      setPad(i, { sample: d.sample, s0: d.s0 || 0, s1: d.s1 ?? null, name: d.name || samples.get(d.sample)?.name || 'Sound' });
      return;
    }
    const ids = await importFiles([...e.dataTransfer.files]);
    if (ids[0]) setPad(i, { sample: ids[0], s0: 0, s1: null, name: samples.get(ids[0]).name });
  });
}

function renderPads() {
  project.pads.forEach((p, i) => {
    const b = padBtns[i];
    b.classList.toggle('empty', !p);
    b.draggable = !!p;
    b.innerHTML = `<span class="k">${PAD_KEYS[i]}</span><span class="n">${p ? esc(p.name) : 'Empty'}</span>${p ? '<button class="clear" title="Clear pad" aria-label="Clear pad">×</button>' : ''}`;
  });
  renderSeq();
}

function setPad(i, p) {
  checkpoint();
  project.pads[i] = p;
  changed();
  renderPads();
  toast(`"${p.name}" is on pad ${PAD_KEYS[i].toUpperCase()}.`);
}

async function playPad(i, when = 0) {
  const p = project.pads[i];
  if (!p) return;
  const s = await ensureSample(p.sample);
  if (!s) return;
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.connect(padBus);
  const s1 = p.s1 == null ? s.buffer.duration : p.s1;
  src.start(when, p.s0 || 0, Math.max(0.01, s1 - (p.s0 || 0)));
}

function flashPad(i) {
  const b = padBtns[i];
  b.classList.add('hit');
  setTimeout(() => b.classList.remove('hit'), 110);
}

async function hitPad(i) {
  const p = project.pads[i];
  if (!p) return;
  await ctx.resume();
  flashPad(i);
  playPad(i);
  if ($('#recPads').checked && transport.playing) {
    const t = transport.pos() - (ctx.outputLatency || 0);
    const tr = findOrAddTrack('Pads');
    await addClip(p.sample, tr.id, t, p.s0 || 0, p.s1, { name: p.name, quiet: true });
  }
}

// Step sequencer: 16 steps (one bar of sixteenths) per pad.
const seq = {
  playing: false,
  step: 0,
  nextT: 0,
  shown: -1,
  start() {
    ctx.resume();
    this.playing = true;
    this.step = 0;
    this.nextT = ctx.currentTime + 0.05;
    $('#btnSeqPlay').setAttribute('aria-pressed', 'true');
  },
  stop() {
    this.playing = false;
    $('#btnSeqPlay').setAttribute('aria-pressed', 'false');
    this.show(-1);
  },
  tick() {
    if (!this.playing) return;
    const dur = beat() / 4;
    while (this.nextT < ctx.currentTime + 0.12) {
      for (const [i, steps] of Object.entries(project.pattern)) if (steps[this.step]) playPad(+i, this.nextT);
      const s = this.step;
      setTimeout(() => this.show(s), Math.max(0, (this.nextT - ctx.currentTime) * 1000));
      this.nextT += dur;
      this.step = (this.step + 1) % 16;
    }
  },
  show(s) {
    if (!this.playing && s >= 0) return;
    if (this.shown === s) return;
    this.shown = s;
    for (const el of document.querySelectorAll('.seq-grid .st')) el.classList.toggle('now', +el.dataset.s === s);
  },
};

function renderSeq() {
  const rows = project.pads.map((p, i) => [p, i]).filter(([p]) => p);
  if (!rows.length) { $('#seqGrid').innerHTML = '<p class="seq-empty">Put sounds on the pads to build a beat.</p>'; return; }
  $('#seqGrid').innerHTML = rows.map(([p, i]) => {
    const steps = project.pattern[i] || [];
    let cells = '';
    for (let s = 0; s < 16; s++) {
      cells += `<button class="st ${s % 4 === 0 ? 'beat' : ''} ${steps[s] ? 'on' : ''}" data-i="${i}" data-s="${s}" aria-label="${esc(p.name)} step ${s + 1}"></button>`;
    }
    return `<span class="rn" data-i="${i}" title="Play">${esc(p.name)}</span>${cells}`;
  }).join('');
}

$('#seqGrid').addEventListener('click', (e) => {
  const rn = e.target.closest('.rn');
  if (rn) { playPad(+rn.dataset.i); return; }
  const st = e.target.closest('.st');
  if (!st) return;
  const i = +st.dataset.i;
  const s = +st.dataset.s;
  checkpoint();
  const steps = project.pattern[i] || (project.pattern[i] = Array(16).fill(false));
  steps[s] = !steps[s];
  if (!steps.some(Boolean)) delete project.pattern[i];
  st.classList.toggle('on', !!steps[s]);
  if (steps[s]) playPad(i);
  scheduleSave();
});
$('#btnSeqPlay').addEventListener('click', () => (seq.playing ? seq.stop() : seq.start()));
$('#btnSeqClear').addEventListener('click', () => { checkpoint(); project.pattern = {}; renderSeq(); scheduleSave(); });
$('#seqBars').addEventListener('change', (e) => { project.bars = clamp(Math.round(+e.target.value) || 1, 1, 64); e.target.value = project.bars; scheduleSave(); });
$('#btnSeqStamp').addEventListener('click', async () => {
  const entries = Object.entries(project.pattern).filter(([i]) => project.pads[i]);
  if (!entries.length) { toast('Tap some steps in the beat maker first.'); return; }
  checkpoint();
  const start = Math.floor(transport.pos() / bar() + 1e-6) * bar();
  const dur = beat() / 4;
  let n = 0;
  for (const [i, steps] of entries) {
    const p = project.pads[i];
    if (!(await ensureSample(p.sample))) continue;
    const tr = findOrAddTrack(p.name);
    for (let b = 0; b < project.bars; b++) {
      steps.forEach((on, s) => {
        if (!on) return;
        const s1 = p.s1 == null ? samples.get(p.sample).buffer.duration : p.s1;
        project.clips.push({
          id: uid(), track: tr.id, sample: p.sample, name: p.name,
          start: start + (b * 16 + s) * dur, srcStart: p.s0 || 0, srcEnd: s1, loops: 1, fx: { ...A.DEFAULT_FX },
        });
        n++;
      });
    }
  }
  changed();
  toast(`Added ${n} hits over ${project.bars} bar${project.bars > 1 ? 's' : ''} from bar ${Math.round(start / bar()) + 1}.`);
});

function togglePads(force) {
  const open = force ?? $('#pads').hidden;
  $('#pads').hidden = !open;
  $('#btnPads').setAttribute('aria-pressed', String(open));
  pref.set('padsOpen', open);
  if (!open && seq.playing) seq.stop();
  drawRuler();
}
$('#btnPads').addEventListener('click', () => togglePads());

// ── Transport controls ──

function syncControls() {
  $('#projName').value = project.name;
  $('#bpm').value = project.bpm;
  $('#snap').value = String(project.snap);
  $('#btnMetro').setAttribute('aria-pressed', String(project.metronome));
  $('#btnLoop').setAttribute('aria-pressed', String(!!project.loopOn));
  $('#seqBars').value = project.bars;
}

$('#bpm').addEventListener('change', (e) => {
  checkpoint();
  project.bpm = clamp(Math.round(+e.target.value) || 100, 40, 240);
  e.target.value = project.bpm;
  changed();
});
let taps = [];
$('#btnTap').addEventListener('click', () => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  if (taps.length >= 3) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b) / gaps.length));
    project.bpm = clamp(bpm, 40, 240);
    $('#bpm').value = project.bpm;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => { checkpoint(); changed(); }, 900);
  }
});
$('#snap').addEventListener('change', (e) => { project.snap = +e.target.value; scheduleSave(); });
$('#btnMetro').addEventListener('click', () => { project.metronome = !project.metronome; syncControls(); scheduleSave(); });
$('#btnLoop').addEventListener('click', toggleLoop);
function toggleLoop() {
  if (!project.loop) {
    const a = Math.floor(transport.pos() / bar()) * bar();
    project.loop = { a, b: a + bar() * 4 };
    project.loopOn = true;
    toast('Looping 4 bars. Drag on the ruler to change the loop.');
  } else project.loopOn = !project.loopOn;
  syncControls();
  drawRuler();
  placeLoop();
  scheduleSave();
}
function setTool(t) {
  tool = t;
  $('#toolMove').setAttribute('aria-pressed', String(t === 'move'));
  $('#toolChop').setAttribute('aria-pressed', String(t === 'chop'));
  tl.classList.toggle('chop', t === 'chop');
}
$('#toolMove').addEventListener('click', () => setTool('move'));
$('#toolChop').addEventListener('click', () => setTool('chop'));
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#projName').addEventListener('change', (e) => {
  project.name = S.safeName(e.target.value) || 'Untitled';
  e.target.value = project.name;
  scheduleSave();
});

// ── Saving & projects ──

let saveTimer = 0;
function setSaveState(text, warn) {
  const el = $('#saveState');
  el.textContent = text;
  el.classList.toggle('warn', !!warn);
}
function scheduleSave() {
  if (!S.connected()) {
    setSaveState(project.clips.length ? 'Not saved: choose a folder' : '', true);
    return;
  }
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}
async function saveNow() {
  if (!S.connected()) return;
  try {
    await S.write('projects', S.safeName(project.name) + '.json', new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' }));
    pref.set('last', project.name);
    setSaveState('Saved');
  } catch (e) {
    setSaveState('Save failed', true);
    toast('Could not save the project: ' + e.message, true);
  }
}

function changed() {
  renderTimeline();
  renderInspector();
  scheduleSave();
}

async function loadProject(name) {
  try {
    const f = await S.read('projects', name);
    const p = JSON.parse(await f.text());
    if (!p || !Array.isArray(p.clips)) throw new Error('Not a Chopped Beats project.');
    transport.stop();
    project = { ...blankProject(), ...p };
    for (const c of project.clips) c.fx = { ...A.DEFAULT_FX, ...c.fx };
    undoStack.length = 0;
    redoStack.length = 0;
    renders.clear();
    selectedClip = null;
    selectedTrack = project.tracks[0] && project.tracks[0].id;
    transport.head = 0;
    syncControls();
    setSaveState('Loading sounds…');
    const missing = [];
    for (const id of new Set([...project.clips.map((c) => c.sample), ...project.pads.filter(Boolean).map((p) => p.sample)])) {
      if (!(await ensureSample(id))) missing.push(prettyName(id));
    }
    if (missing.length) toast(`Missing from samples folder: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}`, true);
    pref.set('last', project.name);
    renderPads();
    renderLibrary();
    changed();
    setSaveState('Saved');
  } catch (e) {
    toast(`Could not open ${name}: ${e.message}`, true);
  }
}

$('#btnOpen').addEventListener('click', async () => {
  if (!S.connected()) { toast('Choose your Chopped Beats folder first.'); return; }
  const names = (await S.list('projects')).filter((n) => n.endsWith('.json'));
  modal('Open project', names.length
    ? `<ul class="proj-list">${names.map((n) => `<li><button data-n="${esc(n)}">${esc(n.replace(/\.json$/, ''))}</button></li>`).join('')}</ul>`
    : '<p>No projects saved yet.</p>', (body) => {
    body.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]');
      if (b) { closeModal(); loadProject(b.dataset.n); }
    });
  });
});

$('#btnNew').addEventListener('click', async () => {
  if (project.clips.length && !S.connected() && !confirm('This project is not saved. Start a new one anyway?')) return;
  if (S.connected()) { clearTimeout(saveTimer); await saveNow(); }
  transport.stop();
  project = blankProject();
  let n = 1;
  const taken = S.connected() ? await S.list('projects') : [];
  while (taken.includes(`Song ${n}.json`)) n++;
  project.name = `Song ${n}`;
  undoStack.length = 0;
  redoStack.length = 0;
  renders.clear();
  selectedClip = null;
  selectedTrack = project.tracks[0].id;
  transport.head = 0;
  syncControls();
  renderPads();
  changed();
});

async function connectFolder(reconnect) {
  try {
    if (reconnect) { if (!(await S.reconnect())) return false; }
    else await S.pickFolder();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Could not open that folder: ' + e.message, true);
    return false;
  }
  await migrateMemSamples();
  await scanFolder();
  updateFolderBtn();
  scheduleSave();
  toast(`Saving to "${S.folderName()}" on your computer.`);
  return true;
}
function updateFolderBtn() {
  const b = $('#btnFolder');
  b.textContent = S.connected() ? `Folder: ${S.folderName()}` : 'Choose folder';
  b.title = S.connected() ? 'Sounds, projects and exports save here. Click to change.' : 'Pick a folder on your PC to keep everything in';
}
$('#btnFolder').addEventListener('click', () => {
  if (!S.supported) { toast('Saving to a folder needs Chrome or Edge on a computer.', true); return; }
  connectFolder(false);
});

// ── Export ──

$('#btnExport').addEventListener('click', () => {
  if (!project.clips.length) { toast('Add some clips first.'); return; }
  const fmt = pref.get('expFmt', 'mp3');
  modal('Export', `
    <div class="field"><span>Format</span><div class="opts">
      <label><input type="radio" name="fmt" value="mp3" ${fmt === 'mp3' ? 'checked' : ''}/> MP3 (small, good for TikTok and CapCut)</label>
      <label><input type="radio" name="fmt" value="wav" ${fmt === 'wav' ? 'checked' : ''}/> WAV (full quality)</label></div></div>
    <div class="field"><span>What</span><div class="opts">
      <label><input type="radio" name="rng" value="all" checked/> Whole song (${fmtTime(songEnd(true))})</label>
      <label><input type="radio" name="rng" value="loop" ${project.loop ? '' : 'disabled'}/> Loop region only</label></div></div>
    <div class="field"><span>Options</span><div class="opts">
      <label><input type="checkbox" id="expNorm" checked/> Make it loud (normalise)</label></div></div>
    <p>${S.connected() ? `Saves into <strong>${esc(S.folderName())}/exports</strong>.` : 'Downloads to your Downloads folder (no folder chosen).'}</p>
    <div class="row-btns"><button class="btn primary" id="expGo">Export</button><button class="btn" id="expCancel">Cancel</button></div>`,
  (body) => {
    $('#expCancel', body).addEventListener('click', closeModal);
    $('#expGo', body).addEventListener('click', async () => {
      const f = $('input[name="fmt"]:checked', body).value;
      const range = $('input[name="rng"]:checked', body).value;
      pref.set('expFmt', f);
      $('#expGo', body).disabled = true;
      $('#expGo', body).textContent = 'Rendering…';
      $('#modal').dataset.locked = '1';
      try { await exportMix(f, range, $('#expNorm', body).checked); closeModal(); }
      catch (e) { toast('Export failed: ' + e.message, true); $('#expGo', body).disabled = false; $('#expGo', body).textContent = 'Export'; }
      finally { delete $('#modal').dataset.locked; }
    });
  });
});

async function exportMix(fmt, range, norm) {
  await Promise.all(project.clips.map(getRender));
  let a = 0;
  let b = songEnd(true);
  if (range === 'loop' && project.loop) { a = project.loop.a; b = project.loop.b; }
  const len = Math.max(1, Math.ceil((b - a) * SR));
  const oc = new OfflineAudioContext(2, len, SR);
  const gains = new Map();
  for (const t of project.tracks) {
    const g = oc.createGain();
    g.gain.value = trackLevel(t, project.tracks);
    g.connect(oc.destination);
    gains.set(t.id, g);
  }
  for (const c of project.clips) {
    const r = renders.get(c.id);
    const buf = r && r.buffer;
    if (!buf || !gains.has(c.track)) continue;
    const L = bodyLen(c);
    for (let i = 0; i < c.loops; i++) {
      const s = c.start + i * L;
      if (s >= b || s + buf.duration <= a) continue;
      const src = oc.createBufferSource();
      src.buffer = buf;
      src.connect(gains.get(c.track));
      src.start(Math.max(0, s - a), Math.max(0, a - s));
    }
  }
  let out = await oc.startRendering();
  if (norm) out = A.normalise(out, -1);
  const blob = fmt === 'mp3' ? await A.encodeMp3(out, 192) : A.encodeWav(out);
  const name = `${S.safeName(project.name)}.${fmt}`;
  if (S.connected()) {
    const saved = await S.writeUnique('exports', name, blob);
    toast(`Exported to exports/${saved}`);
  } else {
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(blob);
    a2.download = name;
    a2.click();
    setTimeout(() => URL.revokeObjectURL(a2.href), 10000);
    toast(`Downloaded ${name}`);
  }
}

// ── Theme & help ──

$('#btnTheme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('wv-theme', next); } catch { /* optional */ }
  renderTimeline();
});

function showHelp() {
  modal('How it works', `
    <p><strong>Everything stays on your computer.</strong> Choose a folder once; Chopped Beats keeps <em>samples</em>, <em>projects</em> and <em>exports</em> inside it and saves as you work.</p>
    <p><strong>Get sounds in:</strong> drop audio or video files (TikTok downloads work; only the sound is kept), or press ● to record your voice onto the highlighted track. Use headphones so the mic doesn't pick up the music.</p>
    <p><strong>Make it weird:</strong> select a clip and use the presets or sliders: pitch, speed, warp, robot, echo, reverb and more.</p>
    <p><strong>Chop it:</strong> Auto-chop cuts a clip at pauses (words) or hits (beats). Or use the Chop tool, or Shift-click a clip, to cut by hand. Alt-drag copies a clip.</p>
    <p><strong>Drums:</strong> open Pads. Tap pads with your keyboard, tick "Record hits" to play them into the song, or build a pattern in the beat maker and add it to the timeline.</p>
    <div class="keys">
      <kbd>Space</kbd><span>Play / pause</span>
      <kbd>R</kbd><span>Record</span>
      <kbd>Home</kbd><span>Back to start</span>
      <kbd>V</kbd> <span>Move tool</span>
      <kbd>C</kbd><span>Chop tool</span>
      <kbd>S</kbd><span>Cut selected clip at the playhead</span>
      <kbd>Ctrl+D</kbd><span>Duplicate clip</span>
      <kbd>Delete</kbd><span>Delete clip</span>
      <kbd>Ctrl+Z / Ctrl+Y</kbd><span>Undo / redo</span>
      <kbd>L</kbd><span>Loop on / off</span>
      <kbd>M</kbd><span>Metronome</span>
      <kbd>P</kbd><span>Pads</span>
      <kbd>1–4 Q–R A–F Z–V</kbd><span>Hit pads (while Pads is open)</span>
      <kbd>Ctrl + scroll</kbd><span>Zoom</span>
    </div>
    <div class="field"><span>Microphone</span><div class="opts">
      <label><input type="checkbox" id="optClean" ${pref.get('cleanMic', true) ? 'checked' : ''}/> Reduce background noise</label></div></div>
    <div class="row-btns"><button class="btn primary" id="helpOk">Got it</button><button class="btn" id="helpTour">Show the tour</button></div>`, (body) => {
    $('#helpOk', body).addEventListener('click', closeModal);
    $('#helpTour', body).addEventListener('click', () => { tourPending = true; closeModal(); });
    $('#optClean', body).addEventListener('change', (e) => {
      pref.set('cleanMic', e.target.checked);
      if (recorder.stream) { recorder.stream.getTracks().forEach((t) => t.stop()); recorder.stream = null; recorder.srcNode = null; recorder.node = null; }
    });
  });
}
$('#btnHelp').addEventListener('click', showHelp);

// ── Keyboard ──

window.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input[type="text"], input[type="search"], input[type="number"], input:not([type]), select, textarea');
  if (typing) return;
  if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;

  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); const c = clipById(selectedClip); if (c) duplicateClip(c); return; }
  if (mod && k === 's') { e.preventDefault(); if (S.connected()) saveNow(); else toast('Choose a folder to save.'); return; }
  if (mod || e.altKey) return;

  if (e.key === ' ') { e.preventDefault(); transport.playing ? stopAll() : transport.play(); return; }
  if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); $('#btnStart').click(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedClip) { e.preventDefault(); deleteClip(selectedClip); } return; }
  if (e.key === 'Escape') { selectedClip = null; renderTimeline(); renderInspector(); return; }
  if (e.repeat) return;

  if (!$('#pads').hidden) {
    const i = PAD_KEYS.indexOf(k);
    if (i >= 0) { e.preventDefault(); hitPad(i); return; }
  }
  switch (k) {
    case 'r': $('#btnRec').click(); break;
    case 'v': setTool('move'); break;
    case 'c': setTool('chop'); break;
    case 's': cutAtPlayhead(); break;
    case 'l': toggleLoop(); break;
    case 'm': project.metronome = !project.metronome; syncControls(); break;
    case 'p': togglePads(); break;
    case '=': case '+': setZoom(pps * 1.25); break;
    case '-': setZoom(pps / 1.25); break;
  }
});

// ── First-run tour ──

let tourPending = false;
const TOUR = [
  { title: 'Welcome to Chopped Beats', text: 'A quick tour of the basics. It takes under a minute. Use Next, or the arrow keys.' },
  { target: '#btnFolder', title: 'Your folder', text: 'Pick a folder on your PC once. Your sounds, projects and exports save there automatically. Nothing is uploaded.' },
  { target: '.library', title: 'Sounds', text: 'Import audio or TikTok videos here, or drop files anywhere on the page. Videos keep only the sound. Drag any sound onto a track.' },
  { target: '#player', title: 'The player', text: 'Play, go back to the start, and record your voice with ●. Recording goes onto the highlighted track. Drag the ⠿ grip to move this anywhere; double-click it to put it back.' },
  { target: '.timeline-wrap', title: 'The timeline', text: 'Drag clips to move them, between tracks too. Pull a clip\'s edges to trim. Shift-click a clip to cut it. Alt-drag copies. Drag on the ruler to mark a loop.' },
  { target: '#inspector', title: 'Make it weird', text: 'Click a clip and its effects show here: presets like Deep, Robot or Slowed + reverb, plus pitch, speed, warp, echo and more. Auto-chop cuts a clip into words or beats.' },
  { target: '.transport', title: 'Tempo and tools', text: 'Set the BPM (or Tap it), choose how clips snap to the grid, and turn on the Click and Loop. Chop switches to the cutting tool.' },
  { target: '#pads', title: 'Pads and beat maker', text: 'Hit pads with keys 1–4, Q–R, A–F, Z–V. Click steps in the beat maker to build a pattern, then Add to timeline. Chops from your clips can go on pads too.' },
  { target: '#btnExport', title: 'Export', text: 'When it sounds right, export an MP3 for TikTok or CapCut, or a full-quality WAV. It lands in your folder\'s exports.' },
  { title: 'That\'s it', text: 'Drop in a clip and start chopping. You can see this tour again from the ? button.' },
];

function startTour() {
  const padsWereOpen = !$('#pads').hidden;
  runTour(TOUR, {
    before: (step) => togglePads(step.target === '#pads' ? true : padsWereOpen),
    onEnd: () => { togglePads(padsWereOpen); pref.set('toured', true); },
  });
}

// Leaving with work that only exists in memory would lose it, so ask first.
window.addEventListener('beforeunload', (e) => {
  if (!S.connected() && project.clips.length) { e.preventDefault(); e.returnValue = ''; }
});

// ── Start-up ──

async function init() {
  $('#zoom').value = pps;
  buildPadGrid();
  const kit = await buildKit();
  for (const k of kit) samples.set('kit:' + k.name, { id: 'kit:' + k.name, name: k.name, kind: 'kit', buffer: k.buffer });
  syncControls();
  renderPads();
  renderLibrary();
  changed();
  togglePads(pref.get('padsOpen', false));
  initPlayer($('#player'), $('#playerGrip'));
  requestAnimationFrame(frame);
  tourPending = !pref.get('toured', false);

  const state = await S.restore();
  updateFolderBtn();
  if (state === 'connected') {
    await scanFolder();
    const last = pref.get('last', null);
    const names = await S.list('projects');
    if (last && names.includes(S.safeName(last) + '.json')) await loadProject(S.safeName(last) + '.json');
    else scheduleSave();
    if (tourPending) { tourPending = false; startTour(); }
    return;
  }
  const reconnect = state === 'needs-permission';
  modal('Chopped Beats', `
    <img class="welcome-mascot" src="/apps/chopped-beats/mascot.png" alt="" onerror="this.remove()" />
    <p>Chop TikTok clips, your voice and any sound into songs. <strong>Nothing is uploaded.</strong> Your sounds, projects and exports live in a folder on your computer.</p>
    ${S.supported ? '' : '<p><strong>This browser can\'t save to a folder.</strong> Use Chrome or Edge on a computer to keep your work.</p>'}
    <div class="row-btns">
      ${S.supported ? `<button class="btn primary" id="wFolder">${reconnect ? 'Reconnect my folder' : 'Choose a folder'}</button>` : ''}
      <button class="btn" id="wTry">Just try it</button>
    </div>
    <p class="hint" style="margin-top:14px">Tip: make a new folder called “Chopped Beats” in Music.</p>`, (body) => {
    const pic = $('.welcome-mascot', body);
    if (pic) $('#modalTitle').before(pic);
    const f = $('#wFolder', body);
    if (f) f.addEventListener('click', async () => { if (await connectFolder(reconnect)) { closeModal(); const last = pref.get('last', null); const names = await S.list('projects'); if (last && names.includes(S.safeName(last) + '.json')) loadProject(S.safeName(last) + '.json'); } });
    $('#wTry', body).addEventListener('click', closeModal);
  });
}

init();
