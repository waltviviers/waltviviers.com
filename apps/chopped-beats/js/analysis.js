// Auto-chop: find cut points in a stretch of audio.
//   'hits'  - transients (drum hits, plosives, beat onsets)
//   'words' - pauses between words or phrases
// Both return cut times in seconds relative to s0, strictly inside (0, s1 - s0).

function mono(buffer, s0, s1) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(s0 * sr));
  const b = Math.min(buffer.length, Math.floor(s1 * sr));
  const out = new Float32Array(Math.max(0, b - a));
  const n = buffer.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += d[a + i] / n;
  }
  return out;
}

// sensitivity 0..1: higher finds more cuts.
export function detectHits(buffer, s0, s1, sensitivity = 0.5) {
  const sr = buffer.sampleRate;
  const x = mono(buffer, s0, s1);
  const hop = Math.round(sr * 0.0058);
  const win = hop * 4;
  const frames = Math.floor((x.length - win) / hop);
  if (frames < 4) return [];
  // High-frequency-weighted energy (first difference), in log scale.
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 1; i < win; i++) { const d = x[o + i] - x[o + i - 1]; s += d * d + x[o + i] * x[o + i] * 0.1; }
    e[f] = Math.log10(1e-9 + s / win);
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, e[f] - e[f - 1]);

  const k = 2.6 - sensitivity * 2.1;
  const W = 12;
  const minGap = Math.round(0.09 / (hop / sr));
  const cuts = [];
  let last = -minGap;
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    let sum = 0, sum2 = 0, n = 0;
    for (let j = Math.max(0, f - W); j < Math.min(frames, f + W); j++) { sum += flux[j]; sum2 += flux[j] * flux[j]; n++; }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    if (flux[f] > mean + k * sd && flux[f] > 0.25 && f - last >= minGap) {
      cuts.push(Math.max(0, f * hop - hop) / sr); // land just before the attack
      last = f;
    }
  }
  const total = s1 - s0;
  return cuts.filter((t) => t > 0.03 && t < total - 0.03);
}

export function detectWords(buffer, s0, s1, sensitivity = 0.5) {
  const sr = buffer.sampleRate;
  const x = mono(buffer, s0, s1);
  const hop = Math.round(sr * 0.01);
  const frames = Math.floor(x.length / hop);
  if (frames < 5) return [];
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < hop; i++) { const v = x[f * hop + i]; s += v * v; }
    db[f] = 10 * Math.log10(1e-10 + s / hop);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(frames * 0.1)];
  const peak = sorted[Math.floor(frames * 0.98)];
  const thr = floor + (peak - floor) * (0.15 + (1 - sensitivity) * 0.3);
  const minGap = Math.round((0.04 + (1 - sensitivity) * 0.16) / 0.01);

  const cuts = [];
  let quietStart = -1;
  let seenSound = false;
  for (let f = 0; f < frames; f++) {
    const loud = db[f] > thr;
    if (!loud && quietStart < 0) quietStart = f;
    if (loud) {
      if (quietStart >= 0 && seenSound && f - quietStart >= minGap) {
        cuts.push(((quietStart + f) / 2) * 0.01); // middle of the pause
      }
      quietStart = -1;
      seenSound = true;
    }
  }
  const total = s1 - s0;
  return cuts.filter((t) => t > 0.05 && t < total - 0.05);
}

// Tempo guess from transient spacing, for the "detect BPM" helper.
export function guessBpm(buffer, s0, s1) {
  const hits = detectHits(buffer, s0, s1, 0.6);
  if (hits.length < 4) return null;
  const votes = new Map();
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < Math.min(hits.length, i + 5); j++) {
      let bpm = 60 / (hits[j] - hits[i]);
      while (bpm < 70) bpm *= 2;
      while (bpm > 160) bpm /= 2;
      const key = Math.round(bpm);
      votes.set(key, (votes.get(key) || 0) + 1 / (j - i));
    }
  }
  let best = null, bestV = 0;
  for (const [bpm, v] of votes) {
    const near = v + (votes.get(bpm - 1) || 0) * 0.5 + (votes.get(bpm + 1) || 0) * 0.5;
    if (near > bestV) { bestV = near; best = bpm; }
  }
  return best;
}
