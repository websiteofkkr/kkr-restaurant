import { dbSelect, dbInsert, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** GET /api/admin/menu-discounts — list all discounts (active and inactive) */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "menu_item_discounts", "select=*&order=updated_at.desc");
  return jsonResponse({ discounts: rows });
});

/** POST /api/admin/menu-discounts — { itemId, discountedPrice, badgeLabel, active }
 *  Sets (creates or replaces) the discount for one menu item. Applies to
 *  the item as a whole — variant-level (Single/Family) discounts aren't
 *  supported yet. */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { itemId, discountedPrice, badgeLabel, active } = body || {};
  const price = Number(discountedPrice);

  if (!String(itemId || "").trim()) {
    return jsonResponse({ error: "itemId is required." }, 400);
  }
  if (!Number.isFinite(price) || price <= 0) {
    return jsonResponse({ error: "discountedPrice must be a positive number." }, 400);
  }

  // Upsert via PostgREST's Prefer: resolution=merge-duplicates on the
  // (item_id, variant_id) primary key.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/menu_item_discounts`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([
      {
        item_id: String(itemId).trim(),
        variant_id: "",
        discounted_price: price,
        badge_label: badgeLabel ? String(badgeLabel).trim() : null,
        active: active !== false,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("menu_item_discounts upsert failed:", res.status, detail);
    return jsonResponse({ error: "Could not save discount." }, 500);
  }
  const rows = await res.json();
  return jsonResponse({ discount: rows[0] });
});

/** PATCH /api/admin/menu-discounts — { itemId, active } — quick on/off
 *  toggle without re-entering the price. */
export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { itemId, active } = body || {};
  if (!String(itemId || "").trim()) {
    return jsonResponse({ error: "itemId is required." }, 400);
  }
  const updated = await dbUpdate(
    env,
    "menu_item_discounts",
    `item_id=eq.${encodeURIComponent(itemId)}&variant_id=eq.`,
    { active: active === true, updated_at: new Date().toISOString() }
  );
  return jsonResponse({ discount: updated[0] });
});

/** DELETE /api/admin/menu-discounts?itemId=... — remove a discount entirely */
export const onRequestDelete = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) return jsonResponse({ error: "itemId is required." }, 400);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/menu_item_discounts?item_id=eq.${encodeURIComponent(itemId)}&variant_id=eq.`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!res.ok) return jsonResponse({ error: "Could not remove discount." }, 500);
  return jsonResponse({ success: true });
});
