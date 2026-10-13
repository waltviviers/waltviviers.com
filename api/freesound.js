// Freesound search for Chopped Beats. Keeps the API key on the server
// (FREESOUND_API_KEY in Vercel) and only returns sounds that are free to use
// in videos: CC0 always, CC BY (needs a credit) when asked. Non-commercial and
// Sampling+ sounds are left out, since TikTok posts can earn money.
//   GET /api/freesound?q=crowd%20laugh&credit=1&page=1  -> JSON results
//   GET /api/freesound?id=12345                         -> the sound's MP3 preview

const API = 'https://freesound.org/apiv2';
const FIELDS = 'id,name,username,license,duration,previews';

// Freesound reports licences as deed URLs.
function licence(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('publicdomain/zero')) return { code: 'CC0', credit: false };
  if (/\/licenses\/by\/(\d)/.test(u)) return { code: 'CC BY ' + u.match(/\/licenses\/by\/([\d.]+)/)[1], credit: true };
  return null; // by-nc, sampling+ and anything unexpected
}

async function call(path, key) {
  return fetch(API + path, { headers: { Authorization: 'Token ' + key } });
}

export default async function handler(req, res) {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) return res.status(503).json({ error: 'not-set-up' });

  try {
    const { q, id, credit, page } = req.query;

    if (id) {
      if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ error: 'bad-id' });
      const info = await call(`/sounds/${id}/?fields=${FIELDS}`, key);
      if (!info.ok) return res.status(info.status === 404 ? 404 : 502).json({ error: 'lookup-failed' });
      const s = await info.json();
      if (!licence(s.license)) return res.status(403).json({ error: 'licence' });
      const audio = await fetch(s.previews['preview-hq-mp3']);
      if (!audio.ok) return res.status(502).json({ error: 'preview-failed' });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(await audio.arrayBuffer()));
    }

    const query = String(q || '').trim().slice(0, 100);
    if (!query) return res.status(400).json({ error: 'no-query' });
    const allowed = credit === '1' ? '("Creative Commons 0" OR "Attribution")' : '"Creative Commons 0"';
    const params = new URLSearchParams({
      query,
      filter: `license:${allowed} duration:[0 TO 120]`,
      fields: FIELDS,
      page_size: '20',
      page: String(Math.max(1, Math.min(50, parseInt(page, 10) || 1))),
    });
    let r = await call(`/search/text/?${params}`, key);
    if (r.status === 404) r = await call(`/search/?${params}`, key); // newer API path
    if (r.status === 404) return res.status(200).json({ results: [], more: false });
    if (!r.ok) return res.status(502).json({ error: 'search-failed', status: r.status });
    const data = await r.json();
    const results = (data.results || []).flatMap((s) => {
      const l = licence(s.license);
      if (!l || (l.credit && credit !== '1')) return [];
      return [{ id: s.id, name: s.name, user: s.username, duration: s.duration, licence: l.code, credit: l.credit }];
    });
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json({ results, more: !!data.next });
  } catch {
    return res.status(502).json({ error: 'unreachable' });
  }
}
