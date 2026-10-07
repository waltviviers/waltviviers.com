// Audio core: shared context, decoding, clip processing (effects) and encoding.

export const ctx = new AudioContext({ latencyHint: 'interactive' });
export const SR = ctx.sampleRate;

export const DEFAULT_FX = {
  gain: 0,        // dB
  pitch: 0,       // semitones, keeps length
  speed: 1,       // tempo, keeps pitch
  reverse: false,
  stutter: 0,     // extra repeats of the opening slice
  stutterDiv: 0.25, // slice length in beats
  wobble: 0,      // 0..1 warped / seasick pitch wobble
  drive: 0,       // 0..1 distortion
  crush: 0,       // 0..1 lo-fi bit crush
  robot: 0,       // 0..1 ring-mod robot voice
  filter: 0,      // -1..1, negative = muffled (low-pass), positive = tinny (high-pass)
  echo: 0,        // 0..1 mix
  reverb: 0,      // 0..1 mix
  fadeIn: 0,      // seconds
  fadeOut: 0,     // seconds
};

export async function decodeFile(file) {
  const data = await file.arrayBuffer();
  return ctx.decodeAudioData(data);
}

// ── Clip length maths (shared by the timeline and the renderer) ──

export function sliceLen(fx, bpm) {
  return (60 / bpm) * fx.stutterDiv;
}

// Seconds the clip takes on the timeline for one loop (effect tails excluded).
export function clipBodyLen(clip, bpm) {
  const fx = clip.fx;
  const src = Math.max(0.001, clip.srcEnd - clip.srcStart);
  const body = src / fx.speed;
  const stut = fx.stutter > 0 ? Math.min(sliceLen(fx, bpm), body) * fx.stutter : 0;
  return body + stut;
}

export function tailLen(fx) {
  return Math.max(fx.echo > 0 ? 1.6 : 0, fx.reverb > 0 ? 2.5 : 0);
}

// ── Effects ──

function extract(buffer, s0, s1) {
  const a = Math.max(0, Math.floor(s0 * buffer.sampleRate));
  const b = Math.min(buffer.length, Math.ceil(s1 * buffer.sampleRate));
  const chs = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    chs.push(buffer.getChannelData(c).slice(a, Math.max(a + 1, b)));
  }
  return chs;
}

function resampleRate(chs, from, to) {
  if (from === to) return chs;
  return resample(chs, from / to);
}

// Linear resample; ratio > 1 shortens (and raises pitch).
function resample(chs, ratio) {
  const len = Math.max(1, Math.floor(chs[0].length / ratio));
  return chs.map((x) => {
    const y = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const p = i * ratio;
      const j = p | 0;
      const f = p - j;
      const a = x[j] || 0;
      const b = x[j + 1] || 0;
      y[i] = a + (b - a) * f;
    }
    return y;
  });
}

// WSOLA time stretch: changes length, keeps pitch. stretch > 1 = longer.
function wsola(chs, stretch) {
  const N = 1024;
  const Hs = N / 2;
  const Ha = Hs / stretch;
  const tol = 256;
  const len = chs[0].length;
  const outLen = Math.ceil(len * stretch) + N;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const mono = new Float32Array(len + N + tol * 2);
  for (const x of chs) for (let i = 0; i < len; i++) mono[i] += x[i] / chs.length;
  const out = chs.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);

  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * Hs;
    if (outPos + N > outLen) break;
    const nominal = Math.round(k * Ha);
    if (nominal >= len) break;
    let pos = nominal;
    if (k > 0) {
      const target = prev + Hs; // natural continuation of the last frame
      let best = -Infinity;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(len - 1, nominal + tol);
      for (let d = lo; d <= hi; d += 2) {
        let s = 0;
        for (let i = 0; i < N; i += 8) s += mono[d + i] * mono[target + i];
        if (s > best) { best = s; pos = d; }
      }
    }
    for (let c = 0; c < chs.length; c++) {
      const x = chs[c];
      const y = out[c];
      for (let i = 0; i < N; i++) y[outPos + i] += (x[pos + i] || 0) * win[i];
    }
    for (let i = 0; i < N; i++) norm[outPos + i] += win[i];
    prev = pos;
  }
  for (let c = 0; c < out.length; c++) {
    const y = out[c];
    for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) y[i] /= norm[i];
  }
  const want = Math.ceil(len * stretch);
  return out.map((y) => y.subarray(0, want));
}

function fitLength(chs, len) {
  return chs.map((x) => {
    if (x.length === len) return x;
    const y = new Float32Array(len);
    y.set(x.subarray(0, Math.min(len, x.length)));
    return y;
  });
}

function applyWobble(chs, amt) {
  // Modulated delay line: pitch drifts up and down like a warped tape.
  const rate = 0.6 + amt * 4;
  const depth = (0.002 + amt * 0.012) * SR;
  const base = depth + 2;
  return chs.map((x) => {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const d = base + depth * Math.sin((2 * Math.PI * rate * i) / SR);
      const p = i - d;
      const j = Math.floor(p);
      const f = p - j;
      const a = j >= 0 ? x[j] : 0;
      const b = j + 1 >= 0 ? x[j + 1] || 0 : 0;
      y[i] = a + (b - a) * f;
    }
    return y;
  });
}

function applyStutter(chs, fx, bpm) {
  if (!(fx.stutter > 0)) return chs;
  const n = Math.min(chs[0].length, Math.max(1, Math.round(sliceLen(fx, bpm) * SR)));
  const total = chs[0].length + n * fx.stutter;
  const fade = Math.min(64, n >> 2);
  return chs.map((x) => {
    const y = new Float32Array(total);
    for (let r = 0; r < fx.stutter; r++) {
      for (let i = 0; i < n; i++) {
        let g = 1;
        if (i < fade) g = i / fade;
        else if (i > n - fade) g = (n - i) / fade;
        y[r * n + i] = x[i] * g;
      }
    }
    y.set(x, n * fx.stutter);
    return y;
  });
}

function applySampleFx(chs, fx) {
  const drive = fx.drive;
  const robot = fx.robot;
  const crush = fx.crush;
  if (!drive && !robot && !crush) return chs;
  const k = 1 + drive * 30;
  const norm = Math.tanh(k);
  const hold = crush ? Math.max(1, Math.round(1 + crush * 24)) : 1;
  const steps = crush ? Math.pow(2, 16 - crush * 12) : 0;
  const ringHz = 55;
  return chs.map((x) => {
    const y = new Float32Array(x.length);
    let held = 0;
    for (let i = 0; i < x.length; i++) {
      let v = x[i];
      if (robot) {
        const ring = v * Math.sin((2 * Math.PI * ringHz * i) / SR) * 1.6;
        v = v * (1 - robot) + ring * robot;
      }
      if (drive) v = Math.tanh(v * k) / norm;
      if (crush) {
        if (i % hold === 0) held = Math.round(v * steps) / steps;
        v = held;
      }
      y[i] = v;
    }
    return y;
  });
}

function applyFades(chs, fx, bodyLen) {
  const fi = Math.min(bodyLen, Math.round(fx.fadeIn * SR));
  const fo = Math.min(bodyLen, Math.round(fx.fadeOut * SR));
  if (!fi && !fo) return chs;
  for (const x of chs) {
    for (let i = 0; i < fi; i++) x[i] *= i / fi;
    for (let i = 0; i < fo; i++) x[bodyLen - 1 - i] *= i / fo;
  }
  return chs;
}

let impulse = null;
function reverbImpulse(c) {
  const len = Math.round(2.4 * SR);
  const ir = c.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let seed = 1234 + ch * 777;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      d[i] = noise * Math.pow(1 - i / len, 3.2);
    }
  }
  return ir;
}

async function applyGraphFx(chs, fx, bpm) {
  const needs = fx.filter !== 0 || fx.echo > 0 || fx.reverb > 0;
  if (!needs) return chs;
  const tail = Math.round(tailLen(fx) * SR);
  const len = chs[0].length + tail;
  const oc = new OfflineAudioContext(2, len, SR);
  const buf = oc.createBuffer(chs.length, chs[0].length, SR);
  chs.forEach((x, i) => buf.copyToChannel(x, i));
  const src = oc.createBufferSource();
  src.buffer = buf;
  let node = src;

  if (fx.filter !== 0) {
    const f = oc.createBiquadFilter();
    if (fx.filter < 0) {
      f.type = 'lowpass';
      f.frequency.value = 18000 * Math.pow(200 / 18000, -fx.filter);
    } else {
      f.type = 'highpass';
      f.frequency.value = 40 * Math.pow(4000 / 40, fx.filter);
    }
    f.Q.value = 0.9;
    node.connect(f);
    node = f;
  }

  const out = oc.createGain();
  out.connect(oc.destination);
  node.connect(out);

  if (fx.echo > 0) {
    const delay = oc.createDelay(4);
    delay.delayTime.value = (60 / bpm) * 0.75; // dotted eighth
    const fb = oc.createGain();
    fb.gain.value = 0.45;
    const wet = oc.createGain();
    wet.gain.value = fx.echo;
    node.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(out);
  }
  if (fx.reverb > 0) {
    impulse = impulse || reverbImpulse(oc);
    const conv = oc.createConvolver();
    conv.buffer = impulse;
    const wet = oc.createGain();
    wet.gain.value = fx.reverb * 0.9;
    node.connect(conv).connect(wet).connect(out);
  }
  src.start();
  const r = await oc.startRendering();
  return [r.getChannelData(0), r.getChannelData(1)];
}

// Render a clip with all its effects into an AudioBuffer (body + effect tail).
export async function renderClip(buffer, clip, bpm) {
  const fx = clip.fx;
  let chs = extract(buffer, clip.srcStart, clip.srcEnd);
  chs = resampleRate(chs, buffer.sampleRate, SR);
  if (fx.reverse) chs = chs.map((x) => x.slice().reverse());

  const r = Math.pow(2, fx.pitch / 12);
  const bodySrc = Math.round((chs[0].length) / fx.speed);
  if (Math.abs(r - 1) > 1e-4 || Math.abs(fx.speed - 1) > 1e-4) {
    const stretch = r / fx.speed;
    if (Math.abs(stretch - 1) > 1e-4) chs = wsola(chs, stretch);
    if (Math.abs(r - 1) > 1e-4) chs = resample(chs, r);
    chs = fitLength(chs, bodySrc);
  }
  if (fx.wobble > 0) chs = applyWobble(chs, fx.wobble);
  chs = applyStutter(chs, fx, bpm);
  const bodyLen = chs[0].length;
  chs = applySampleFx(chs, fx);
  chs = applyFades(chs, fx, bodyLen);
  chs = await applyGraphFx(chs, fx, bpm);

  const g = Math.pow(10, fx.gain / 20);
  const out = ctx.createBuffer(chs.length, chs[0].length, SR);
  chs.forEach((x, i) => {
    if (g !== 1) for (let j = 0; j < x.length; j++) x[j] *= g;
    out.copyToChannel(x, i);
  });
  return out;
}

// ── Peaks for waveform drawing ──

export function peaks(buffer, s0, s1, columns) {
  const d0 = buffer.getChannelData(0);
  const d1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : d0;
  const a = Math.floor(s0 * buffer.sampleRate);
  const b = Math.min(buffer.length, Math.floor(s1 * buffer.sampleRate));
  const per = Math.max(1, (b - a) / columns);
  const out = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    const i0 = Math.floor(a + c * per);
    const i1 = Math.min(b, Math.floor(i0 + per));
    let m = 0;
    const step = Math.max(1, ((i1 - i0) / 64) | 0);
    for (let i = i0; i < i1; i += step) {
      const v = Math.max(Math.abs(d0[i]), Math.abs(d1[i]));
      if (v > m) m = v;
    }
    out[c] = m;
  }
  return out;
}

// ── Encoding ──

export function encodeWav(buffer) {
  const chs = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const bytes = 44 + len * chs * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, chs, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * chs * 2, true); view.setUint16(32, chs * 2, true);
  view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, len * chs * 2, true);
  const data = [];
  for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chs; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

let lameLoading = null;
function loadLame() {
  if (window.lamejs) return Promise.resolve();
  lameLoading = lameLoading || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/apps/chopped-beats/vendor/lame.min.js';
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load the MP3 encoder.'));
    document.head.appendChild(s);
  });
  return lameLoading;
}

export async function encodeMp3(buffer, kbps = 192) {
  await loadLame();
  const chs = Math.min(2, buffer.numberOfChannels);
  const enc = new window.lamejs.Mp3Encoder(chs, buffer.sampleRate, kbps);
  const toInt = (f) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  };
  const L = toInt(buffer.getChannelData(0));
  const R = chs > 1 ? toInt(buffer.getChannelData(1)) : null;
  const parts = [];
  const block = 1152;
  for (let i = 0; i < L.length; i += block) {
    const l = L.subarray(i, i + block);
    const chunk = R ? enc.encodeBuffer(l, R.subarray(i, i + block)) : enc.encodeBuffer(l);
    if (chunk.length) parts.push(new Uint8Array(chunk));
    if (i % (block * 200) === 0) await new Promise((r) => setTimeout(r)); // keep the UI alive
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}

export function normalise(buffer, peakDb = -1) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  if (peak < 1e-6) return buffer;
  const g = Math.pow(10, peakDb / 20) / peak;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buffer;
}
