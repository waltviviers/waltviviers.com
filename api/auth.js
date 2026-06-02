export default function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/callback`;

  const params = new URLSearchParams({
    client_id: 'Ov23liftA5BwWxORy9ui',
    redirect_uri: redirectUri,
    scope: 'repo,user',
  });

  res.redirect(302, `https://github.com/login/oauth/authorize?${params}`);
}
