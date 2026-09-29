// Password gate for client previews under /clients/.
// Set CLIENT_PREVIEW_PASSWORD in the Vercel project's environment variables.
// Without it the pages stay locked.

export const config = { matcher: ['/clients', '/clients/:path*'] };

const COOKIE = 'client_preview';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

function page(message, status) {
  const html = `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Client preview · Walt Viviers</title>
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
  .err { color: var(--err); font-weight: 500; }
</style>
</head>
<body>
<form method="post">
  <h1>Client preview</h1>
  <p>This page is private. Enter the password Walt sent you.</p>
  ${message ? `<p class="err" role="alert">${message}</p>` : ''}
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">View preview</button>
</form>
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

export default async function middleware(request) {
  const secret = process.env.CLIENT_PREVIEW_PASSWORD;
  if (!secret) return page('Previews are not available right now.', 503);

  const token = await sha256('client-preview:' + secret);
  if (readCookie(request, COOKIE) === token) return; // let the static page through

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const attempt = String(form?.get('password') || '');
    if ((await sha256('client-preview:' + attempt)) === token) {
      return new Response(null, {
        status: 303,
        headers: {
          location: request.url,
          'cache-control': 'no-store',
          'set-cookie': `${COOKIE}=${token}; Path=/clients; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return page('That password is incorrect. Try again.', 401);
  }

  return page('', 401);
}
