export default async function handler(req, res) {
  const { code } = req.query;

  let message;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.OAUTH_CLIENT_ID,
        client_secret: process.env.OAUTH_CLIENT_SECRET,
        code,
      }),
    });
    const { access_token, error } = await tokenRes.json();
    message = access_token
      ? `authorization:github:success:${JSON.stringify({ token: access_token, provider: 'github' })}`
      : `authorization:github:error:${error || 'no token'}`;
  } catch (e) {
    message = `authorization:github:error:${e.message}`;
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><body><script>
(function(){
  var msg = ${JSON.stringify(message)};
  function receive(e){ window.opener.postMessage(msg, e.origin); }
  window.addEventListener('message', receive, false);
  window.opener.postMessage('authorizing:github', '*');
})();
</script></body></html>`);
}
