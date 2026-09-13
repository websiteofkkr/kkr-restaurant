import { dbSelect, getAuthUser, jsonResponse } from "../_shared/supabase.js";

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  const accessToken = auth.replace(/^Bearer\s+/i, "");
  const user = await getAuthUser(env, accessToken);
  if (!user || !user.id) {
    return jsonResponse({ error: "Please log in to view your orders." }, 401);
  }

  const orders = await dbSelect(
    env,
    "orders",
    `customer_id=eq.${user.id}&select=*,order_items(*),order_status_history(*)&order=created_at.desc`
  );

  return jsonResponse({ orders });
}
