// Auto-tune: track the pitch of a voice, pull each moment to the nearest note
// of a key, and shift it there without changing length (PSOLA, which also
// keeps the voice's natural tone instead of making it sound like a chipmunk).

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const MIN_HZ = 70;
const MAX_HZ = 1000;

export const keyName = (key, scale) => `${NOTE_NAMES[key]} ${scale === 'minor' ? 'minor' : 'major'}`;

// ── Pitch tracking (YIN) ──

function trackPitch(mono, sr, hop) {
  const W = Math.round(sr * 0.04); // 40 ms window: two periods of the lowest voice
  const maxLag = Math.min(W - 1, Math.floor(sr / MIN_HZ));
  const minLag = Math.floor(sr / MAX_HZ);
  const frames = Math.max(1, Math.floor((mono.length - W) / hop));
  const f0 = new Float32Array(frames);
  const d = new Float32Array(maxLag + 1);
  // Loudness gate: ignore breaths and room noise well below the loudest part.
  let peakRms = 0;
  const rmsAt = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 0; i < W; i += 4) s += mono[o + i] * mono[o + i];
    rmsAt[f] = Math.sqrt(s / (W / 4));
    peakRms = Math.max(peakRms, rmsAt[f]);
  }
  const gate = peakRms * 0.08;
  for (let f = 0; f < frames; f++) {
    if (rmsAt[f] < gate) continue;
    const o = f * hop;
    const half = W - maxLag;
    for (let tau = minLag; tau <= maxLag; tau++) {
      let s = 0;
      for (let i = 0; i < half; i += 2) { const v = mono[o + i] - mono[o + i + tau]; s += v * v; }
      d[tau] = s;
    }
    // Cumulative mean normalised difference; take the first dip under the threshold.
    let run = 0;
    let best = -1;
    let bestVal = 1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      run += d[tau];
      const v = run > 0 ? (d[tau] * (tau - minLag + 1)) / run : 1;
      d[tau] = v;
    }
    for (let tau = minLag + 1; tau < maxLag; tau++) {
      if (d[tau] < 0.15 && d[tau] <= d[tau + 1]) { best = tau; bestVal = d[tau]; break; }
      if (d[tau] < bestVal) { bestVal = d[tau]; best = tau; }
    }
    if (best < 0 || bestVal > 0.3) continue; // too noisy to call a note
    // Parabolic refinement between lags.
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1] ?? b;
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    f0[f] = sr / (best + (Math.abs(shift) < 1 ? shift : 0));
  }
  // Median of three removes single-frame octave jumps.
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const w = [f0[f - 1] || 0, f0[f], f0[f + 1] || 0];
    if (!f0[f]) continue;
    const v = w.filter(Boolean).sort((x, y) => x - y);
    out[f] = v[Math.floor(v.length / 2)];
  }
  return out;
}

const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);

// ── Key detection: which major or minor key the sung notes fit best ──

export function detectKey(f0) {
  const hist = new Float32Array(12);
  for (const hz of f0) if (hz) hist[((Math.round(midiOf(hz)) % 12) + 12) % 12] += 1;
  let best = { key: 0, scale: 'major', score: -1 };
  for (let key = 0; key < 12; key++) {
    for (const scale of ['major', 'minor']) {
      let s = 0;
      for (const n of SCALES[scale]) s += hist[(key + n) % 12];
      s += hist[key] * 0.5; // a slight pull towards the root
      if (s > best.score) best = { key, scale, score: s };
    }
  }
  return best;
}

function nearestInScale(midi, key, scale) {
  const notes = SCALES[scale] || SCALES.major;
  let best = Math.round(midi);
  let dist = Infinity;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
    if (!notes.includes((((m - key) % 12) + 12) % 12)) continue;
    const dd = Math.abs(m - midi);
    if (dd < dist) { dist = dd; best = m; }
  }
  return best;
}

// ── Correction curve: semitones to shift at each analysis frame ──

function correction(f0, key, scale, style, amount, hopSec) {
  const n = f0.length;
  const shift = new Float32Array(n);
  // Style 0 = natural (slow, gentle glide), 1 = hard (instant snap).
  const tau = (1 - style) * 0.14 + 0.002;
  const k = 1 - Math.exp(-hopSec / tau);
  let target = null;
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (!f0[i]) { target = null; cur += (0 - cur) * k; shift[i] = cur; continue; }
    const m = midiOf(f0[i]);
    const t = nearestInScale(m, key, scale);
    // Stick with the current note until the voice clearly moves, so it doesn't flutter.
    if (target === null || Math.abs(m - target) > 0.65) target = t;
    const want = (target - m) * amount;
    cur += (want - cur) * k;
    shift[i] = Math.max(-12, Math.min(12, cur));
  }
  return shift;
}

// ── Time-varying pitch shift that keeps length (PSOLA) ──

function psola(chs, mono, sr, f0, shift, hop) {
  const len = mono.length;
  const frameAt = (t) => Math.min(f0.length - 1, Math.max(0, Math.floor(t / hop)));
  const UNVOICED = Math.round(sr * 0.006);

  // Analysis marks: one per pitch period in voiced parts, lined up with the waveform peaks.
  const marks = [];
  let t = 0;
  let prevVoiced = false;
  while (t < len) {
    const f = frameAt(t);
    const voiced = f0[f] > 0;
    const T = voiced ? Math.round(sr / f0[f]) : UNVOICED;
    let m = t;
    if (voiced && prevVoiced) {
      const lo = Math.max(0, Math.round(t - T * 0.2));
      const hi = Math.min(len - 1, Math.round(t + T * 0.2));
      let best = -Infinity;
      for (let i = lo; i <= hi; i++) if (mono[i] > best) { best = mono[i]; m = i; }
    }
    marks.push({ at: m, T, r: Math.pow(2, shift[f] / 12) });
    prevVoiced = voiced;
    t = m + T;
  }

  const out = chs.map(() => new Float32Array(len));
  const norm = new Float32Array(len);
  let ts = 0;
  let mi = 0;
  while (ts < len) {
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1].at - ts) <= Math.abs(marks[mi].at - ts)) mi++;
    const { at, T, r } = marks[mi];
    const W = 2 * T;
    for (let i = 0; i < W; i++) {
      const src = at - T + i;
      const dst = Math.round(ts) - T + i;
      if (src < 0 || src >= len || dst < 0 || dst >= len) continue;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
      for (let c = 0; c < chs.length; c++) out[c][dst] += chs[c][src] * w;
      norm[dst] += w;
    }
    ts += Math.max(8, T / r);
  }
  for (let c = 0; c < out.length; c++) {
    const y = out[c];
    for (let i = 0; i < len; i++) if (norm[i] > 0.2) y[i] /= norm[i]; else y[i] = chs[c][i];
  }
  return out;
}

// Key setting: -1 detect from the voice, -2 any note (chromatic),
// 0..11 C..B major, 12..23 C..B minor.
export function keyLabel(k) {
  if (k === -1) return 'Auto-detect';
  if (k === -2) return 'Any note';
  return keyName(k % 12, k >= 12 ? 'minor' : 'major');
}

// Returns { chs, label } where label names the key that was used.
export function autotune(chs, sr, { amount, style, key }) {
  const len = chs[0].length;
  const mono = new Float32Array(len);
  for (const x of chs) for (let i = 0; i < len; i++) mono[i] += x[i] / chs.length;
  // Track pitch on a 12 kHz copy: plenty for a voice and many times faster.
  const fac = Math.max(1, Math.round(sr / 12000));
  const hop = fac * Math.max(1, Math.round((sr * 0.005) / fac));
  const dec = new Float32Array(Math.floor(len / fac));
  for (let i = 0; i < dec.length; i++) {
    let v = 0;
    for (let j = 0; j < fac; j++) v += mono[i * fac + j];
    dec[i] = v / fac;
  }
  const f0 = trackPitch(dec, sr / fac, hop / fac);
  let root;
  let scale;
  if (key === -2) { root = 0; scale = 'chromatic'; } else if (key < 0) {
    const found = detectKey(f0);
    root = found.key;
    scale = found.scale;
  } else { root = key % 12; scale = key >= 12 ? 'minor' : 'major'; }
  const shift = correction(f0, root, scale, style, amount, hop / sr);
  return { chs: psola(chs, mono, sr, f0, shift, hop), label: scale === 'chromatic' ? 'Any note' : keyName(root, scale) };
}
