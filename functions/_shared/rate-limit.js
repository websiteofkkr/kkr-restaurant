/**
 * Backend rate limiting, backed by the existing Supabase Postgres database
 * (see migration: check_rate_limit()) rather than introducing Redis or any
 * new infrastructure. Callable only with the service role key — a client
 * can never call this directly or fake its own rate-limit state.
 *
 * Limits are read from environment variables with sane fallbacks, so they
 * can be tuned per-deployment without a code change.
 */
export async function checkRateLimit(env, key, limit, windowSeconds) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds }),
    });
    if (!res.ok) {
      console.error("Rate limit check failed to execute:", res.status, await res.text().catch(() => ""));
      // Fail open on infrastructure error — an outage in the rate-limit
      // mechanism itself should not take down ordering entirely. Real
      // abuse is still caught by Turnstile, price validation, and
      // idempotency regardless.
      return true;
    }
    return await res.json();
  } catch (err) {
    console.error("Rate limit check errored:", err);
    return true;
  }
}

/** Config helper — reads NAME_LIMIT / NAME_WINDOW style env vars with a
 *  fallback, so limits are configurable without hunting through code. */
export function rateLimitConfig(env, prefix, defaultLimit, defaultWindowSeconds) {
  const limit = Number(env[`${prefix}_LIMIT`]) || defaultLimit;
  const window = Number(env[`${prefix}_WINDOW`]) || defaultWindowSeconds;
  return { limit, window };
}

/** Builds a request's best-effort client identifier for rate limiting —
 *  Cloudflare's connecting IP header, since Pages Functions don't get a
 *  raw socket address. */
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}
