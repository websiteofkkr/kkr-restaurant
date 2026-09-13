import { getAuthUser, getProfile, jsonResponse } from "./supabase.js";

/** Verifies the request carries a valid admin's access token. Returns the
 *  profile row, or a Response to send back immediately if not authorized. */
export async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const accessToken = auth.replace(/^Bearer\s+/i, "");
  const user = await getAuthUser(env, accessToken);
  if (!user || !user.id) {
    return { error: jsonResponse({ error: "Please log in." }, 401) };
  }
  const profile = await getProfile(env, user.id);
  if (!profile || !profile.is_admin) {
    return { error: jsonResponse({ error: "Admin access required." }, 403) };
  }
  return { profile };
}

/** Controlled status transitions — reject anything not explicitly allowed
 *  rather than letting the admin UI jump to an arbitrary state. */
export const PAYMENT_TRANSITIONS = {
  pending: ["verified", "rejected", "confirmed"],
  verified: ["rejected"],
  rejected: ["pending"],
  confirmed: [],
};

export const DELIVERY_ORDER_TRANSITIONS = {
  received: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};

export const PICKUP_ORDER_TRANSITIONS = {
  received: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: [],
  cancelled: [],
};

export function isValidTransition(map, from, to) {
  return Array.isArray(map[from]) && map[from].includes(to);
}
