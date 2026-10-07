// Local folder storage via the File System Access API (Chrome / Edge).
// Layout inside the chosen folder:
//   samples/   imported audio, recordings, sound pulled from videos
//   projects/  <name>.json
//   exports/   finished WAV / MP3 files

const DB = 'chopped-beats';
const STORE = 'kv';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function kv(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}

export const supported = 'showDirectoryPicker' in window;

let root = null;
const dirs = {};

export function connected() { return !!root; }
export function folderName() { return root ? root.name : ''; }

async function setRoot(handle) {
  root = handle;
  for (const name of ['samples', 'projects', 'exports']) {
    dirs[name] = await root.getDirectoryHandle(name, { create: true });
  }
  try { await kv('readwrite', (s) => s.put(handle, 'root')); } catch { /* remembering is optional */ }
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'chopped-beats', mode: 'readwrite', startIn: 'music' });
  await setRoot(handle);
}

// Returns 'connected', 'needs-permission' (call reconnect() from a click) or 'none'.
export async function restore() {
  if (!supported) return 'none';
  let handle;
  try { handle = await kv('readonly', (s) => s.get('root')); } catch { return 'none'; }
  if (!handle) return 'none';
  const p = await handle.queryPermission({ mode: 'readwrite' });
  if (p === 'granted') { await setRoot(handle); return 'connected'; }
  restore.pending = handle;
  return 'needs-permission';
}

export async function reconnect() {
  const handle = restore.pending;
  if (!handle) return false;
  const p = await handle.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') return false;
  await setRoot(handle);
  return true;
}

export function safeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

// Writes without overwriting: "voice.wav" becomes "voice 2.wav" if taken.
export async function writeUnique(dirName, name, blob) {
  const dir = dirs[dirName];
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let final = name;
  for (let n = 2; await exists(dir, final); n++) final = `${base} ${n}${ext}`;
  await write(dirName, final, blob);
  return final;
}

export async function write(dirName, name, blob) {
  const fh = await dirs[dirName].getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

export async function read(dirName, name) {
  const fh = await dirs[dirName].getFileHandle(name);
  return fh.getFile();
}

export async function remove(dirName, name) {
  await dirs[dirName].removeEntry(name);
}

export async function list(dirName) {
  const out = [];
  for await (const [name, h] of dirs[dirName].entries()) {
    if (h.kind === 'file' && !name.startsWith('.')) out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
