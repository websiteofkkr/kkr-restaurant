import { dbSelect, dbUpdate, dbInsert, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** GET /api/admin/reward?q=search+term — search registered customers by
 *  name, phone, or email so the admin can find who to award points to. */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return jsonResponse({ customers: [] });

  const escaped = q.replace(/[%,]/g, "");
  const filter = `or=(full_name.ilike.*${escaped}*,phone.ilike.*${escaped}*,email.ilike.*${escaped}*)`;
  const customers = await dbSelect(
    env,
    "profiles",
    `${filter}&select=id,full_name,phone,email,reward_points&limit=20`
  );
  return jsonResponse({ customers });
});

/** POST /api/admin/reward — { customerId, points, reason } — award points
 *  not tied to any order (e.g. a photo competition prize). */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { customerId, points, reason } = body || {};
  const pointsNum = Number(points);

  if (!customerId || !Number.isInteger(pointsNum) || pointsNum === 0) {
    return jsonResponse({ error: "customerId and a non-zero integer points value are required." }, 400);
  }
  if (!String(reason || "").trim()) {
    return jsonResponse({ error: "A reason is required for every manual award (kept for the audit trail)." }, 400);
  }

  const profileRows = await dbSelect(env, "profiles", `id=eq.${customerId}&select=id,reward_points`);
  const profile = profileRows[0];
  if (!profile) return jsonResponse({ error: "Customer not found." }, 404);

  await dbInsert(env, "reward_ledger", [
    {
      customer_id: customerId,
      order_id: null,
      points: pointsNum,
      reason: String(reason).trim(),
    },
  ]);

  const newBalance = Math.max(0, profile.reward_points + pointsNum);
  await dbUpdate(env, "profiles", `id=eq.${customerId}`, { reward_points: newBalance });

  return jsonResponse({ success: true, newBalance });
});
