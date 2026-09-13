import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

const NUMERIC_KEYS = ["tax_rate", "delivery_fee", "free_delivery_threshold", "reward_rate"];
const BOOLEAN_KEYS = [
  "ordering_enabled",
  "delivery_enabled",
  "pickup_enabled",
  "cash_enabled",
  "easypaisa_enabled",
  "reservations_enabled",
  "promo_banner_enabled",
];
const STRING_KEYS = ["easypaisa_number", "promo_banner_text", "promo_banner_link"];

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "settings", "select=*");
  return jsonResponse({ settings: rows });
});

/** PATCH /api/admin/settings — { key, value } — e.g. { "key": "tax_rate",
 *  "value": 0.05 } to set tax to 5%, or { "key": "delivery_enabled",
 *  "value": false } to turn a feature off. Kept generic (one key/value at
 *  a time) so any future setting can use the same endpoint without new
 *  code. */
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

  let storedValue;
  if (NUMERIC_KEYS.includes(key)) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return jsonResponse({ error: "Value must be a non-negative number." }, 400);
    }
    if ((key === "tax_rate" || key === "reward_rate") && num > 1) {
      return jsonResponse({ error: "This should be a fraction (e.g. 0.01 for 1 point per Rs. 100), not a whole number." }, 400);
    }
    storedValue = num;
  } else if (BOOLEAN_KEYS.includes(key)) {
    if (typeof value !== "boolean") {
      return jsonResponse({ error: "Value must be true or false." }, 400);
    }
    storedValue = value;
  } else if (STRING_KEYS.includes(key)) {
    if (typeof value !== "string" || value.length > 500) {
      return jsonResponse({ error: "Value must be text under 500 characters." }, 400);
    }
    storedValue = value;
  } else {
    return jsonResponse({ error: `Unknown setting "${key}".` }, 400);
  }

  const updated = await dbUpdate(env, "settings", `key=eq.${key}`, {
    value: storedValue,
    updated_at: new Date().toISOString(),
  });
  return jsonResponse({ setting: updated[0] });
});
