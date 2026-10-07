// Built-in drum kit, synthesised at start-up so there are no sample files to ship.
import { SR } from './audio.js';

function noiseBuffer(oc, secs) {
  const b = oc.createBuffer(1, Math.round(secs * SR), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function env(param, t, peak, decay, attack = 0.001) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(oc, { type = 'highpass', freq = 7000, q = 0.7, decay = 0.1, peak = 0.6, at = 0 }) {
  const n = oc.createBufferSource();
  n.buffer = noiseBuffer(oc, decay + 0.05);
  const f = oc.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = oc.createGain();
  env(g.gain, at, peak, decay);
  n.connect(f).connect(g).connect(oc.destination);
  n.start(at);
}

function tone(oc, { type = 'sine', f0, f1, sweep = 0.05, decay, peak = 0.9, at = 0, drive = 0 }) {
  const o = oc.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, at + sweep);
  const g = oc.createGain();
  env(g.gain, at, peak, decay);
  let node = o.connect(g);
  if (drive) {
    const ws = oc.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * drive); }
    ws.curve = curve;
    node = node.connect(ws);
  }
  node.connect(oc.destination);
  o.start(at);
  o.stop(at + decay + 0.05);
}

const KIT = {
  Kick: [0.6, (oc) => { tone(oc, { f0: 150, f1: 45, sweep: 0.08, decay: 0.45, peak: 1 }); noise(oc, { freq: 3000, decay: 0.01, peak: 0.3 }); }],
  Snare: [0.4, (oc) => { tone(oc, { type: 'triangle', f0: 220, f1: 160, sweep: 0.05, decay: 0.12, peak: 0.6 }); noise(oc, { type: 'bandpass', freq: 3500, q: 0.6, decay: 0.22, peak: 0.7 }); }],
  Clap: [0.45, (oc) => { [0, 0.012, 0.024].forEach((at) => noise(oc, { type: 'bandpass', freq: 1400, q: 1.4, decay: 0.03, peak: 0.8, at })); noise(oc, { type: 'bandpass', freq: 1300, q: 1, decay: 0.25, peak: 0.6, at: 0.036 }); }],
  'Hat': [0.12, (oc) => noise(oc, { freq: 8000, decay: 0.05, peak: 0.45 })],
  'Open hat': [0.5, (oc) => noise(oc, { freq: 7500, decay: 0.38, peak: 0.4 })],
  Rim: [0.12, (oc) => { tone(oc, { type: 'square', f0: 1700, decay: 0.03, peak: 0.35 }); noise(oc, { type: 'bandpass', freq: 2500, q: 3, decay: 0.03, peak: 0.4 }); }],
  Tom: [0.5, (oc) => tone(oc, { f0: 220, f1: 110, sweep: 0.2, decay: 0.4, peak: 0.9 })],
  '808': [1.4, (oc) => tone(oc, { f0: 110, f1: 48, sweep: 0.12, decay: 1.3, peak: 0.9, drive: 2.5 })],
  Cowbell: [0.4, (oc) => { tone(oc, { type: 'square', f0: 540, decay: 0.3, peak: 0.25 }); tone(oc, { type: 'square', f0: 800, decay: 0.3, peak: 0.25 }); }],
  Shaker: [0.15, (oc) => noise(oc, { type: 'bandpass', freq: 6000, q: 0.8, decay: 0.09, peak: 0.5, at: 0.01 })],
  Crash: [1.8, (oc) => noise(oc, { freq: 5000, q: 0.3, decay: 1.7, peak: 0.45 })],
  Zap: [0.3, (oc) => tone(oc, { type: 'sawtooth', f0: 2000, f1: 80, sweep: 0.25, decay: 0.28, peak: 0.35 })],
};

export async function buildKit() {
  const out = [];
  for (const [name, [len, make]] of Object.entries(KIT)) {
    const oc = new OfflineAudioContext(1, Math.round(len * SR), SR);
    make(oc);
    out.push({ name, buffer: await oc.startRendering() });
  }
  return out;
}
