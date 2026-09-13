import { dbSelect, jsonResponse, withErrorHandling } from "../_shared/supabase.js";
import { checkRateLimit, rateLimitConfig, clientIp } from "../_shared/rate-limit.js";
import { newRequestId, logSecurityEvent } from "../_shared/log.js";

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const requestId = newRequestId();
  const ip = clientIp(request);

  // guest_token is a high-entropy UUID, so brute-forcing it is already
  // impractical — this limit exists mainly to blunt scripted scraping of
  // this endpoint rather than because a single guess is likely to land.
  const { limit, window } = rateLimitConfig(env, "CUSTOMER_VERIFY_RATE", 10, 600);
  const withinLimit = await checkRateLimit(env, `guest-order:ip:${ip}`, limit, window);
  if (!withinLimit) {
    logSecurityEvent(requestId, "rate_limit_exceeded", { scope: "guest-order", ip });
    return jsonResponse({ error: "Too many requests. Please wait a few minutes and try again." }, 429);
  }

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
    logSecurityEvent(requestId, "guest_order_lookup_failed", { ip, orderNumber });
    return jsonResponse({ error: "Order not found." }, 404);
  }

  return jsonResponse({ order: rows[0] });
});
