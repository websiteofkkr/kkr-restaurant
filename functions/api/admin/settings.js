import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "settings", "select=*");
  return jsonResponse({ settings: rows });
});

/** PATCH /api/admin/settings — { key, value } — e.g. { "key": "tax_rate",
 *  "value": 0.05 } to set tax to 5%. Kept generic (one key/value at a
 *  time) so any future setting (delivery fee, free-delivery threshold,
 *  etc.) can use the same endpoint without new code. */
export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { key, value } = body || {};
  const allowedKeys = ["tax_rate", "delivery_fee", "free_delivery_threshold", "reward_rate"];
  if (!allowedKeys.includes(key)) {
    return jsonResponse({ error: `Unknown setting "${key}".` }, 400);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return jsonResponse({ error: "Value must be a non-negative number." }, 400);
  }
  if ((key === "tax_rate" || key === "reward_rate") && num > 1) {
    return jsonResponse({ error: "This should be a fraction (e.g. 0.01 for 1 point per Rs. 100), not a whole number." }, 400);
  }

  const updated = await dbUpdate(env, "settings", `key=eq.${key}`, {
    value: num,
    updated_at: new Date().toISOString(),
  });
  return jsonResponse({ setting: updated[0] });
});
