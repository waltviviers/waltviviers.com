// Server-side password gates. Passwords live in Vercel environment
// variables; a page with no password set stays locked.
//   /clients/<slug>/ -> CLIENT_PASSWORD_<SLUG> (one per client, e.g.
//                       /clients/manifesto-wellness/ -> CLIENT_PASSWORD_MANIFESTO_WELLNESS)
//   /admin-index/    -> ADMIN_PASSWORD
//
// Public client sites skip the gate and live on their own subdomain:
//   manifesto.waltviviers.com/* serves /clients/manifesto-wellness/*, and the
//   old waltviviers.com/clients/manifesto-wellness/ address redirects there.
//   menzies.waltviviers.com/* serves /clients/menzies-media/* the same way.
//
// App subdomains map only their entry pages; the apps load their own assets
// by absolute /apps/... paths, which every host serves as-is. This lives here
// rather than in vercel.json because Vercel serves the root index.html for "/"
// before vercel.json rewrites run.

export const config = { matcher: ['/:path*'] };

const PUBLIC_SITES = {
  'manifesto.waltviviers.com': 'manifesto-wellness',
  'menzies.waltviviers.com': 'menzies-media',
};
const MAIN_HOSTS = ['waltviviers.com', 'www.waltviviers.com'];
const APP_SITES = {
  'chopped-beats.waltviviers.com': { '/': '/apps/chopped-beats/' },
  'scritch-scratch.waltviviers.com': {
    '/': '/apps/scritch-scratch/',
    '/play': '/apps/scritch-scratch/play/',
    '/play/': '/apps/scritch-scratch/play/',
  },
  'static-protocol.waltviviers.com': {
    '/': '/apps/static-protocol/',
    '/play': '/apps/static-protocol/play/',
    '/play/': '/apps/static-protocol/play/',
  },
};
// Subdomains for things hosted elsewhere: send the whole host there, keeping the path.
const EXTERNAL_SITES = {};

const ADMIN_GATE = {
  prefix: '/admin-index',
  env: 'ADMIN_PASSWORD',
  cookie: 'admin_session',
  maxAge: 60 * 60 * 24 * 7, // 7 days
  title: 'Admin access',
  intro: 'Enter the admin password to continue.',
  button: 'Enter',
};

function clientGate(slug) {
  return {
    prefix: '/clients/' + slug,
    env: 'CLIENT_PASSWORD_' + slug.toUpperCase().replace(/-/g, '_'),
    cookie: 'client_' + slug.replace(/-/g, '_'),
    maxAge: 60 * 60 * 24 * 30, // 30 days
    title: 'Client preview',
    intro: 'This page is private. Enter the password Walt sent you.',
    button: 'View preview',
  };
}

function findGate(pathname) {
  if (pathname === ADMIN_GATE.prefix || pathname.startsWith(ADMIN_GATE.prefix + '/')) return ADMIN_GATE;
  const match = pathname.match(/^\/clients\/([a-z0-9-]+)(\/|$)/);
  return match ? clientGate(match[1]) : null;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function page(gate, message, status) {
  const html = `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${gate.title} · Walt Viviers</title>
<style>
  :root { --bg: #f4f4f2; --card: #fff; --fg: #1c1c1c; --muted: #6b6b6b; --line: #d9d9d4; --err: #b3261e; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151515; --card: #1f1f1f; --fg: #f1f1ee; --muted: #a3a3a0; --line: #3a3a38; --err: #f2867e; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; display: grid; gap: 14px; }
  h1 { margin: 0; font-size: 1.25rem; }
  p { margin: 0; color: var(--muted); font-size: .95rem; }
  label { font-size: .85rem; font-weight: 600; }
  input { font: inherit; width: 100%; padding: .75em .85em; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); }
  button { font: inherit; font-weight: 600; padding: .8em; border: 0; border-radius: 8px; background: var(--fg); color: var(--bg); cursor: pointer; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
  .pw { position: relative; }
  .pw input { padding-right: 3em; }
  .peek { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); width: 36px; height: 36px; padding: 0; display: grid; place-items: center; background: transparent; color: var(--muted); border-radius: 6px; touch-action: none; user-select: none; -webkit-user-select: none; }
  .peek:hover, .peek[aria-pressed="true"] { color: var(--fg); }
  .peek svg { width: 20px; height: 20px; pointer-events: none; }
  .err { color: var(--err); font-weight: 500; }
</style>
</head>
<body>
<form method="post">
  <h1>${gate.title}</h1>
  <p>${gate.intro}</p>
  ${message ? `<p class="err" role="alert">${message}</p>` : ''}
  <label for="password">Password</label>
  <div class="pw">
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="peek" type="button" aria-label="Hold to show password" aria-pressed="false" aria-controls="password">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </div>
  <button type="submit">${gate.button}</button>
</form>
<script>
  // Hold the eye to reveal the password; it hides again as soon as you let go.
  (function () {
    var input = document.getElementById('password');
    var peek = document.querySelector('.peek');
    function show(on) { input.type = on ? 'text' : 'password'; peek.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    peek.addEventListener('pointerdown', function (e) { e.preventDefault(); show(true); });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (t) { peek.addEventListener(t, function () { show(false); }); });
    peek.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); show(true); } });
    peek.addEventListener('keyup', function () { show(false); });
    peek.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();
</script>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function publicSiteRoute(url) {
  const slug = PUBLIC_SITES[url.hostname];
  if (slug) {
    const prefix = '/clients/' + slug;
    // Old full paths on the subdomain fold back to the short form.
    if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
      return Response.redirect(new URL((url.pathname.slice(prefix.length) || '/') + url.search, url), 308);
    }
    return new Response(null, { headers: { 'x-middleware-rewrite': new URL(prefix + url.pathname + url.search, url).toString() } });
  }
  for (const [host, site] of Object.entries(PUBLIC_SITES)) {
    const prefix = '/clients/' + site;
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) continue;
    // On the main domain, send visitors to the subdomain; preview deployments serve it in place.
    if (MAIN_HOSTS.includes(url.hostname)) {
      return Response.redirect('https://' + host + (url.pathname.slice(prefix.length) || '/') + url.search, 308);
    }
    return 'serve';
  }
  return null;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;
  const external = EXTERNAL_SITES[url.hostname];
  if (external) return Response.redirect(external + pathname + url.search, 307);
  const app = APP_SITES[url.hostname] && APP_SITES[url.hostname][pathname];
  if (app) return new Response(null, { headers: { 'x-middleware-rewrite': new URL(app + url.search, url).toString() } });
  const site = publicSiteRoute(url);
  if (site === 'serve') return;
  if (site) return site;
  if (!/^\/(clients|admin-index)(\/|$)/.test(pathname)) return; // the rest of the site is public
  const gate = findGate(pathname);
  // /clients/ itself, or anything that isn't a valid client folder, is not public.
  if (!gate) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

  const secret = process.env[gate.env];
  if (!secret) return page(gate, 'This page is not available right now.', 503);

  const token = await sha256(gate.cookie + ':' + secret);
  if (readCookie(request, gate.cookie) === token) return; // let the static page through

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const attempt = String(form?.get('password') || '');
    if ((await sha256(gate.cookie + ':' + attempt)) === token) {
      return new Response(null, {
        status: 303,
        headers: {
          location: request.url,
          'cache-control': 'no-store',
          'set-cookie': `${gate.cookie}=${token}; Path=${gate.prefix}; Max-Age=${gate.maxAge}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return page(gate, 'That password is incorrect. Try again.', 401);
  }

  return page(gate, '', 401);
}
