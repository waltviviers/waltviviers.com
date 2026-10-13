// Chopped Beats phone companion: record or collect sounds, keep them on the
// phone, and send them to the computer through the phone's own share menu.
// Nothing is uploaded anywhere by this page.
import { encodeWav, ctx } from '/apps/chopped-beats/js/audio.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const audioCtx = () => ctx;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

// ── Storage (IndexedDB on this phone) ──

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('chopped-beats-phone', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function store(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('sounds', mode);
    const req = fn(tx.objectStore('sounds'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const allSounds = () => store('readonly', (s) => s.getAll());
const putSound = (x) => store('readwrite', (s) => s.put(x));
const delSound = (id) => store('readwrite', (s) => s.delete(id));

// ── Turning anything into a WAV the desktop app can read ──

async function toWav(blob) {
  const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
  // Mix down to mono: half the size, and plenty for voice and samples.
  const mono = audioCtx().createBuffer(1, buf.length, buf.sampleRate);
  const out = mono.getChannelData(0);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return { wav: encodeWav(mono), duration: buf.duration };
}

function cleanName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'Sound';
}

async function addSound(blob, name) {
  let entry;
  try {
    const { wav, duration } = await toWav(blob);
    entry = { blob: wav, ext: 'wav', duration };
  } catch {
    // The phone couldn't read it; keep the original so the computer can try.
    const ext = (blob.name && blob.name.split('.').pop()) || (blob.type.split('/')[1] || 'bin').split(';')[0];
    entry = { blob, ext, duration: 0 };
  }
  const sounds = await allSounds();
  let base = cleanName(name), n = 2, finalName = base;
  while (sounds.some((s) => s.name === finalName)) finalName = `${base} ${n++}`;
  await putSound({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: finalName, created: Date.now(), ...entry });
  await render();
}

// ── Recording ──

let rec = null;
async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
  } catch {
    toast('Microphone blocked. Allow it in your browser settings and try again.');
    return;
  }
  const chunks = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    const count = (await allSounds()).filter((s) => /^Voice \d+$/.test(s.name)).length;
    await addSound(blob, `Voice ${count + 1}`);
    toast('Saved. Tap Send to get it to your computer.');
  };
  // Level meter and timer.
  const src = audioCtx().createMediaStreamSource(stream);
  const an = audioCtx().createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const data = new Uint8Array(an.fftSize);
  const t0 = performance.now();
  const tick = () => {
    if (!rec) return;
    an.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    $('#meter span').style.width = Math.min(100, (peak / 128) * 160) + '%';
    $('#timer').textContent = fmt((performance.now() - t0) / 1000);
    requestAnimationFrame(tick);
  };
  await audioCtx().resume();
  mr.start();
  rec = mr;
  $('#btnRec').classList.add('on');
  $('#btnRec').setAttribute('aria-label', 'Stop recording');
  $('#recLabel').textContent = 'Stop';
  tick();
}
function stopRecording() {
  if (!rec) return;
  rec.stop();
  rec = null;
  $('#btnRec').classList.remove('on');
  $('#btnRec').setAttribute('aria-label', 'Start recording');
  $('#recLabel').textContent = 'Record';
  $('#meter span').style.width = '0';
}
$('#btnRec').addEventListener('click', () => (rec ? stopRecording() : startRecording()));

$('#fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    toast(`Adding ${f.name}…`);
    await addSound(f, f.name);
  }
  if (files.length) toast(files.length === 1 ? 'Added.' : `Added ${files.length} sounds.`);
});

// ── Sending ──

const fileFor = (s) => new File([s.blob], `${s.name}.${s.ext}`, { type: s.ext === 'wav' ? 'audio/wav' : s.blob.type || 'application/octet-stream' });

async function send(list) {
  const files = list.map(fileFor);
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: 'Chopped Beats sounds' });
    } catch (e) {
      if (e.name !== 'AbortError') toast('Sharing failed. Try sending one sound at a time.');
    }
    return;
  }
  // No share menu (or it can't take files): download instead.
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  toast('Saved to your downloads. Send them on from there.');
}

// ── List ──

let player = null;
async function render() {
  const sounds = (await allSounds()).sort((a, b) => b.created - a.created);
  $('#empty').hidden = sounds.length > 0;
  $('#btnSendAll').hidden = sounds.length < 2;
  $('#list').innerHTML = sounds.map((s) => `
    <li class="item" data-id="${s.id}">
      <button class="play" aria-label="Play ${esc(s.name)}">▶</button>
      <input class="name" value="${esc(s.name)}" aria-label="Name" />
      <span class="meta">${s.duration ? fmt(s.duration) : ''} ${s.ext.toUpperCase()}</span>
      <span class="acts">
        <button class="btn primary send">Send</button>
        <button class="del" aria-label="Delete ${esc(s.name)}">×</button>
      </span>
    </li>`).join('');
}

$('#list').addEventListener('click', async (e) => {
  const li = e.target.closest('.item');
  if (!li) return;
  const s = (await allSounds()).find((x) => x.id === li.dataset.id);
  if (!s) return;
  if (e.target.closest('.play')) {
    if (player) { player.pause(); URL.revokeObjectURL(player.src); }
    player = new Audio(URL.createObjectURL(s.blob));
    player.play();
  } else if (e.target.closest('.send')) {
    send([s]);
  } else if (e.target.closest('.del')) {
    if (confirm(`Delete "${s.name}" from this phone?`)) { await delSound(s.id); render(); }
  }
});
$('#list').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('name')) return;
  const li = e.target.closest('.item');
  const s = (await allSounds()).find((x) => x.id === li.dataset.id);
  if (!s) return;
  s.name = cleanName(e.target.value);
  e.target.value = s.name;
  await putSound(s);
});
$('#btnSendAll').addEventListener('click', async () => send(await allSounds()));

render();
