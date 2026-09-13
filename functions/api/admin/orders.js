import { dbSelect, dbUpdate, dbInsert, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import {
  requireAdmin,
  PAYMENT_TRANSITIONS,
  DELIVERY_ORDER_TRANSITIONS,
  PICKUP_ORDER_TRANSITIONS,
  isValidTransition,
} from "../../_shared/admin.js";

const REWARD_RATE_FALLBACK = 0.01; // 1 point per Rs. 100, used only if the
// reward_rate row is somehow missing from settings

export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const orders = await dbSelect(
    env,
    "orders",
    "select=*,order_items(*)&order=created_at.desc&limit=200"
  );
  return jsonResponse({ orders });
});

export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { orderId, paymentStatus, orderStatus } = body || {};
  if (!orderId || (!paymentStatus && !orderStatus)) {
    return jsonResponse({ error: "orderId and at least one status field are required." }, 400);
  }

  const existingRows = await dbSelect(env, "orders", `id=eq.${orderId}&select=*`);
  const order = existingRows[0];
  if (!order) return jsonResponse({ error: "Order not found." }, 404);

  const patch = { updated_at: new Date().toISOString() };
  const historyRows = [];

  if (paymentStatus) {
    if (!isValidTransition(PAYMENT_TRANSITIONS, order.payment_status, paymentStatus)) {
      return jsonResponse(
        { error: `Cannot move payment status from "${order.payment_status}" to "${paymentStatus}".` },
        400
      );
    }
    patch.payment_status = paymentStatus;
    historyRows.push({
      order_id: orderId,
      status_type: "payment",
      status_value: paymentStatus,
      changed_by: auth.profile.id,
    });
  }

  if (orderStatus) {
    const transitionMap = order.order_type === "delivery" ? DELIVERY_ORDER_TRANSITIONS : PICKUP_ORDER_TRANSITIONS;
    if (!isValidTransition(transitionMap, order.order_status, orderStatus)) {
      return jsonResponse(
        { error: `Cannot move order status from "${order.order_status}" to "${orderStatus}".` },
        400
      );
    }
    patch.order_status = orderStatus;
    historyRows.push({
      order_id: orderId,
      status_type: "order",
      status_value: orderStatus,
      changed_by: auth.profile.id,
    });
  }

  // Reward points are proportional to what was actually spent on food
  // (the subtotal — delivery charges and tax don't earn points), at a
  // rate the admin can change any time via the Settings tab. Awarded
  // exactly once, only for a logged-in customer, only once the order has
  // genuinely reached a confirmed state (payment verified/confirmed by
  // staff — never automatically on "Place Order").
  const nowConfirmed =
    patch.payment_status === "verified" || patch.payment_status === "confirmed";
  if (nowConfirmed && order.customer_id && order.reward_points_awarded === 0) {
    const settingRows = await dbSelect(env, "settings", "key=eq.reward_rate&select=value");
    const rewardRate = settingRows[0] ? Number(settingRows[0].value) : REWARD_RATE_FALLBACK;
    const pointsEarned = Math.floor(Number(order.subtotal) * rewardRate);

    if (pointsEarned > 0) {
      patch.reward_points_awarded = pointsEarned;
      await dbInsert(env, "reward_ledger", [
        {
          customer_id: order.customer_id,
          order_id: order.id,
          points: pointsEarned,
          reason: `Order ${order.order_number}`,
        },
      ]);
      const profileRows = await dbSelect(env, "profiles", `id=eq.${order.customer_id}&select=reward_points`);
      const currentPoints = profileRows[0]?.reward_points ?? 0;
      await dbUpdate(env, "profiles", `id=eq.${order.customer_id}`, {
        reward_points: currentPoints + pointsEarned,
      });
    }
  }

  const updated = await dbUpdate(env, "orders", `id=eq.${orderId}`, patch);
  if (historyRows.length) await dbInsert(env, "order_status_history", historyRows);

  return jsonResponse({ order: updated[0] });
});
