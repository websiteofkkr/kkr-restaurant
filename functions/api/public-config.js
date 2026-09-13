import { jsonResponse, withErrorHandling } from "../_shared/supabase.js";

/**
 * Returns configuration that is safe to expose publicly. The Turnstile
 * SITE key (as opposed to the SECRET key) is meant to be public — it's
 * embedded in every Turnstile widget on the web. Serving it from an env
 * var instead of hardcoding it into static JS means it can be rotated by
 * changing a Cloudflare Pages environment variable, no code change.
 */
export const onRequestGet = withErrorHandling(async ({ env }) => {
  return jsonResponse({
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  });
});
