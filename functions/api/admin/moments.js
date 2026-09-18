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

  // Delete the database row first, then clean up storage — deliberately
  // in that order. The database row is what the homepage carousel
  // actually reads, so if something goes wrong partway through, it
  // matters a lot which half completed: a row deleted with its storage
  // file left behind is just a few invisible orphaned KB on the free
  // tier, but a storage file deleted with its row left behind is a
  // moment that still displays with a video pointing at nothing — which
  // looks exactly like a blank gap in the reel where a clip used to be.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/moments?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return jsonResponse({ error: "Could not delete moment." }, 500);

  // Best-effort storage cleanup — only applies to videos actually
  // uploaded to Supabase Storage. A moment with no storage_path is one
  // of the site's built-in static clips (served for free from Cloudflare
  // Pages, not Supabase), so there's nothing to reclaim there.
  if (moment.storage_path) {
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
      console.error("Moment storage cleanup failed (row already deleted, file is now just orphaned):", err);
    }
  }

  return jsonResponse({ success: true });
});
