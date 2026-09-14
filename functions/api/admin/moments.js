import { dbSelect, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** GET /api/admin/moments — list all moments */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "moments", "select=*&order=sort_order.asc");
  return jsonResponse({ moments: rows });
});

/** DELETE /api/admin/moments?id=... — removes both the database row and
 *  the actual video (and poster, if any) file from storage, so deleting
 *  a moment genuinely frees up space rather than leaving orphaned files
 *  behind on the free storage tier. */
export const onRequestDelete = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "id is required." }, 400);

  const rows = await dbSelect(env, "moments", `id=eq.${encodeURIComponent(id)}&select=storage_path,poster_url`);
  const moment = rows[0];
  if (!moment) return jsonResponse({ error: "Moment not found." }, 404);

  // Best-effort storage cleanup — the DB row is still deleted even if a
  // file happens to already be gone, so a stuck record can never block
  // removal from the site.
  const pathsToDelete = [moment.storage_path];
  if (moment.poster_url) {
    const match = moment.poster_url.match(/public-uploads\/(.+)$/);
    if (match) pathsToDelete.push(match[1]);
  }
  try {
    await fetch(`${env.SUPABASE_URL}/storage/v1/object/public-uploads`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: pathsToDelete }),
    });
  } catch (err) {
    console.error("Moment storage cleanup failed:", err);
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/moments?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return jsonResponse({ error: "Could not delete moment." }, 500);
  return jsonResponse({ success: true });
});
