import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** GET /api/admin/featured-items — list all featured items */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "featured_items", "select=*&order=section.asc,sort_order.asc");
  return jsonResponse({ items: rows });
});

/** POST /api/admin/featured-items — { itemId, section, blurb } — feature
 *  a menu item in a homepage section. */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const itemId = String(body?.itemId || "").trim();
  const section = body?.section === "favourites" ? "favourites" : "signature";
  const blurb = body?.blurb ? String(body.blurb).trim() : null;

  if (!itemId) return jsonResponse({ error: "itemId is required." }, 400);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/featured_items`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([{ item_id: itemId, section, blurb }]),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("featured_items upsert failed:", res.status, detail);
    return jsonResponse({ error: "Could not feature this item." }, 500);
  }
  const rows = await res.json();
  return jsonResponse({ item: rows[0] });
});

/** DELETE /api/admin/featured-items?itemId=...&section=... — unfeature */
export const onRequestDelete = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const section = url.searchParams.get("section");
  if (!itemId || !section) return jsonResponse({ error: "itemId and section are required." }, 400);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/featured_items?item_id=eq.${encodeURIComponent(itemId)}&section=eq.${encodeURIComponent(section)}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!res.ok) return jsonResponse({ error: "Could not remove." }, 500);
  return jsonResponse({ success: true });
});
