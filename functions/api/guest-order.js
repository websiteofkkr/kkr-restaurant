import { dbSelect, jsonResponse, withErrorHandling } from "../_shared/supabase.js";

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("order");
  const token = url.searchParams.get("token");

  if (!orderNumber || !token) {
    return jsonResponse({ error: "Missing order number or token." }, 400);
  }

  // Both the order number AND the guest_token must match — this is the
  // "secure order confirmation mechanism" the spec calls for. Knowing the
  // order number alone (e.g. guessing sequential numbers) is not enough.
  const rows = await dbSelect(
    env,
    "orders",
    `order_number=eq.${encodeURIComponent(orderNumber)}&guest_token=eq.${encodeURIComponent(token)}&select=*,order_items(*)`
  );

  if (rows.length === 0) {
    return jsonResponse({ error: "Order not found." }, 404);
  }

  return jsonResponse({ order: rows[0] });
});
