/**
 * Cloudflare Turnstile — server-side verification only. A frontend widget
 * proves nothing by itself; this is what actually checks the token with
 * Cloudflare before the order is allowed to proceed.
 *
 * Required env var: TURNSTILE_SECRET_KEY (server-only secret, never sent
 * to the browser). TURNSTILE_SITE_KEY is the public counterpart, safe to
 * expose via /api/public-config.
 */
export async function verifyTurnstile(env, token, remoteIp) {
  if (!env.TURNSTILE_SECRET_KEY) {
    // Fail closed: if the site is supposed to be protected but isn't
    // configured, don't silently let every request through.
    return { success: false, reason: "not_configured" };
  }
  if (!token || typeof token !== "string") {
    return { success: false, reason: "missing_token" };
  }

  try {
    const body = new URLSearchParams();
    body.set("secret", env.TURNSTILE_SECRET_KEY);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = await res.json();

    if (!data.success) {
      // error-codes can include things like "timeout-or-duplicate" (token
      // already used/expired) — never echoed back to the client, just
      // used for our own server-side logging.
      return { success: false, reason: (data["error-codes"] || []).join(",") || "verification_failed" };
    }
    return { success: true };
  } catch (err) {
    console.error("Turnstile verification request failed:", err);
    return { success: false, reason: "verification_request_error" };
  }
}
