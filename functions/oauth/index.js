/**
 * Decap CMS "github" backend with auth_endpoint: oauth expects a
 * self-hosted OAuth proxy (this is the standard pattern documented by
 * Decap/Netlify CMS for anyone not hosting on Netlify itself, which has
 * this built in). This is step 1: send the admin to GitHub's own
 * authorize page. Step 2 (functions/callback/index.js) handles GitHub's
 * redirect back.
 *
 * Required env var: GITHUB_OAUTH_CLIENT_ID (not secret — this is fine to
 * construct a redirect URL with, though it's still only ever read
 * server-side here rather than hardcoded in the repo).
 * The matching GITHUB_OAUTH_CLIENT_SECRET is used only in callback.js and
 * must never appear here or anywhere client-facing.
 */
export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_OAUTH_CLIENT_ID) {
    return new Response(
      "OAuth is not configured yet. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET in Cloudflare Pages environment variables.",
      { status: 500 }
    );
  }

  const redirectUri = new URL("/callback", request.url).toString();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo,user");

  return Response.redirect(authorizeUrl.toString(), 302);
}
