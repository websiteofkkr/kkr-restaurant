import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** GET /api/admin/reservations — list all reservations, newest first */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "reservations", "select=*&order=created_at.desc&limit=200");
  return jsonResponse({ reservations: rows });
});

const VALID_STATUSES = ["new", "confirmed", "declined", "completed"];

/** PATCH /api/admin/reservations — { id, status } */
export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const id = String(body?.id || "").trim();
  const status = body?.status;
  if (!id) return jsonResponse({ error: "id is required." }, 400);
  if (!VALID_STATUSES.includes(status)) {
    return jsonResponse({ error: "Invalid status." }, 400);
  }

  const updated = await dbUpdate(env, "reservations", `id=eq.${encodeURIComponent(id)}`, { status });
  return jsonResponse({ reservation: updated[0] });
});
