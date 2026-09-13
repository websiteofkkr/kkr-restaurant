/**
 * Minimal Supabase REST helpers for Cloudflare Pages Functions.
 *
 * Deliberately dependency-free (plain fetch calls to PostgREST + GoTrue)
 * rather than pulling in @supabase/supabase-js, so there's no bundler step
 * required to deploy these Functions.
 *
 * Required environment variables (set in Cloudflare Pages → Settings →
 * Environment variables — NEVER commit these to the repo):
 *   SUPABASE_URL              e.g. https://eiwkolocxqjnxgrzbntk.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY the service_role secret key (server-side only)
 *   SUPABASE_ANON_KEY         the public anon key (safe to expose to the
 *                             browser too, but also used here to validate
 *                             a customer's access token)
 */

export function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

/** Insert row(s) into a table using the service role (bypasses RLS). */
export async function dbInsert(env, table, rows, { single = false } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(env),
      Prefer: `return=representation${single ? ",resolution=merge-duplicates" : ""}`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase insert into ${table} failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return single ? data[0] : data;
}

/** Select rows from a table using the service role (bypasses RLS). */
export async function dbSelect(env, table, queryString) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${queryString}`, {
    headers: serviceHeaders(env),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase select from ${table} failed (${res.status}): ${detail}`);
  }
  return res.json();
}

/** Update rows in a table using the service role (bypasses RLS). */
export async function dbUpdate(env, table, queryString, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${queryString}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env), Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase update on ${table} failed (${res.status}): ${detail}`);
  }
  return res.json();
}

/**
 * Verify a customer's Supabase Auth access token (sent from the browser
 * after they log in). Returns the auth user object, or null if the token
 * is missing/invalid. NEVER trust a customer_id sent directly from the
 * browser — always derive it from this.
 */
export async function getAuthUser(env, accessToken) {
  if (!accessToken) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Look up a profile row (and whether it's an admin) by auth user id. */
export async function getProfile(env, userId) {
  const rows = await dbSelect(env, "profiles", `id=eq.${userId}&select=*`);
  return rows[0] || null;
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
