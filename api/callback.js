export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Missing code parameter');
  }

  let payload;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: 'Ov23liftA5BwWxORy9ui',
        client_secret: process.env.OAUTH_CLIENT_SECRET,
        code,
      }),
    });
    const data = await tokenRes.json();
    payload = data.access_token
      ? `authorization:github:success:${JSON.stringify({ token: data.access_token, provider: 'github' })}`
      : `authorization:github:error:${JSON.stringify({ message: data.error_description || 'Authentication failed' })}`;
  } catch (err) {
    payload = `authorization:github:error:${JSON.stringify({ message: 'Server error' })}`;
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><body><script>
(function () {
  function onMessage(e) {
    window.removeEventListener('message', onMessage);
    window.opener.postMessage(${JSON.stringify(payload)}, e.origin);
  }
  window.addEventListener('message', onMessage);
  window.opener && window.opener.postMessage('authorizing:github', '*');
})();
</script></body></html>`);
}
