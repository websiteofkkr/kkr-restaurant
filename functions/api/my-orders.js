import { dbSelect, getAuthUser, jsonResponse, withErrorHandling } from "../_shared/supabase.js";
import { checkRateLimit, rateLimitConfig, clientIp } from "../_shared/rate-limit.js";
import { newRequestId, logSecurityEvent } from "../_shared/log.js";

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const requestId = newRequestId();
  const ip = clientIp(request);

  const { limit, window } = rateLimitConfig(env, "CUSTOMER_VERIFY_RATE", 30, 600);
  const withinLimit = await checkRateLimit(env, `my-orders:ip:${ip}`, limit, window);
  if (!withinLimit) {
    logSecurityEvent(requestId, "rate_limit_exceeded", { scope: "my-orders", ip });
    return jsonResponse({ error: "Too many requests. Please wait a few minutes and try again." }, 429);
  }

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
});
