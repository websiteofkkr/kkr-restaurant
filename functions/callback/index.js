/**
 * Step 2 of the OAuth flow: GitHub redirects here with a one-time `code`
 * after the admin approves access. This exchanges that code for a real
 * access token (using the CLIENT SECRET — server-side only, never sent to
 * the browser) and passes the token back to the Decap CMS login popup via
 * postMessage, using the exact message format Decap/Netlify CMS expects.
 *
 * Required env vars: GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
 * (secret — Cloudflare Pages environment variable only).
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) {
    return new Response("OAuth is not configured (missing client ID/secret).", { status: 500 });
  }
  if (!code) {
    return new Response("Missing authorization code from GitHub.", { status: 400 });
  }

  let tokenData;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
      }),
    });
    tokenData = await tokenRes.json();
  } catch (err) {
    console.error("GitHub OAuth token exchange failed:", err);
    return new Response("Could not complete GitHub login. Please try again.", { status: 502 });
  }

  if (!tokenData.access_token) {
    console.error("GitHub OAuth token exchange returned no token:", tokenData.error || tokenData);
    return new Response("GitHub did not return an access token. Please try logging in again.", { status: 400 });
  }

  // Hand the token back to the CMS popup exactly the way Decap/Netlify CMS
  // expects it — the opener window is listening for this specific message
  // shape and closes this popup itself once it receives it.
  const message = JSON.stringify({ token: tokenData.access_token, provider: "github" });
  const html = `<!doctype html>
<html><body>
<script>
(function() {
  function receiveMessage() {
    window.opener.postMessage(
      'authorization:github:success:${message.replace(/'/g, "\\'")}',
      '*'
    );
    window.removeEventListener('message', receiveMessage, false);
  }
  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:github', '*');
})();
</script>
<p>Logging in, this window should close automatically…</p>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
