import { dbInsert, dbSelect, getAuthUser, jsonResponse, withErrorHandling } from "../_shared/supabase.js";
import { verifyTurnstile } from "../_shared/turnstile.js";
import { checkRateLimit, rateLimitConfig, clientIp } from "../_shared/rate-limit.js";
import { newRequestId, logSecurityEvent } from "../_shared/log.js";

/** Reads the current storefront settings (tax rate, delivery fee, free
 *  delivery threshold) from the settings table — this is what makes them
 *  changeable by an admin without a code deployment. Falls back to sane
 *  defaults only if a row is somehow missing. */
async function getSettings(env) {
  const rows = await dbSelect(env, "settings", "select=key,value");
  const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  return {
    taxRate: map.tax_rate ?? 0,
    deliveryFee: map.delivery_fee ?? 200,
    freeDeliveryThreshold: map.free_delivery_threshold ?? 1000,
  };
}

export const onRequestPost = withErrorHandling(handleOrder);

async function handleOrder({ request, env }) {
  const requestId = newRequestId();
  const ip = clientIp(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const {
    items,
    orderType,
    paymentMethod,
    paymentReference,
    customer,
    accessToken,
    turnstileToken,
    idempotencyKey,
  } = body || {};
  const deliveryLat = Number.isFinite(Number(body?.deliveryLat)) ? Number(body.deliveryLat) : null;
  const deliveryLng = Number.isFinite(Number(body?.deliveryLng)) ? Number(body.deliveryLng) : null;

  // -------------------------------------------------------- rate limit
  // Order creation is rate-limited by IP first, before any other work —
  // this is what actually stops API flooding/order-spam bots, independent
  // of whatever Cloudflare-level protection is configured at the edge.
  const { limit: orderLimit, window: orderWindow } = rateLimitConfig(env, "ORDER_RATE", 5, 600);
  const withinLimit = await checkRateLimit(env, `order:ip:${ip}`, orderLimit, orderWindow);
  if (!withinLimit) {
    logSecurityEvent(requestId, "rate_limit_exceeded", { scope: "order", ip });
    return jsonResponse({ error: "Too many order attempts. Please wait a few minutes and try again." }, 429);
  }

  // -------------------------------------------------------- basic shape
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: "Cart is empty." }, 400);
  }
  if (orderType !== "delivery" && orderType !== "pickup") {
    return jsonResponse({ error: "Invalid order type." }, 400);
  }
  if (paymentMethod !== "easypaisa" && paymentMethod !== "cash") {
    return jsonResponse({ error: "Invalid payment method." }, 400);
  }
  if (paymentMethod === "easypaisa" && !String(paymentReference || "").trim()) {
    return jsonResponse(
      { error: "An Easypaisa transaction/reference number is required." },
      400
    );
  }
  if (!customer || !String(customer.name || "").trim() || !String(customer.phone || "").trim()) {
    return jsonResponse({ error: "Customer name and phone are required." }, 400);
  }
  if (orderType === "delivery" && !String(customer.address || "").trim()) {
    return jsonResponse({ error: "Delivery address is required." }, 400);
  }

  // -------------------------------------------------------- Turnstile
  // The backend independently re-verifies the token with Cloudflare.
  // A frontend "verified" flag, or the mere presence of a token, proves
  // nothing on its own — only Cloudflare's own siteverify response does.
  const turnstile = await verifyTurnstile(env, turnstileToken, ip);
  if (turnstile.reason === "not_configured_fail_open") {
    logSecurityEvent(requestId, "turnstile_not_configured", { ip });
  }
  if (!turnstile.success) {
    logSecurityEvent(requestId, "turnstile_failed", { ip, reason: turnstile.reason });
    return jsonResponse({ error: "Verification failed. Please reload the page and try again." }, 403);
  }

  // -------------------------------------------------------- idempotency
  // A client-generated key lets a double-click, browser retry, or dropped
  // connection safely resubmit the exact same order attempt without ever
  // creating a second order. Enforced with a real database unique
  // constraint (see migration), not just this check — the check here is
  // for a fast, friendly response; the constraint is the actual guarantee.
  if (idempotencyKey) {
    const existing = await dbSelect(
      env,
      "orders",
      `idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=order_number,total,payment_status,order_status,guest_token,customer_id`
    );
    if (existing.length > 0) {
      logSecurityEvent(requestId, "idempotent_replay", { ip, idempotencyKey });
      const prior = existing[0];
      const response = {
        orderNumber: prior.order_number,
        total: prior.total,
        paymentStatus: prior.payment_status,
        orderStatus: prior.order_status,
      };
      if (!prior.customer_id) response.guestToken = prior.guest_token;
      return jsonResponse(response, 200);
    }
  }

  // ---------------------------------------------- who is placing the order
  // NEVER trust a customer_id sent from the browser. Either derive it from
  // a verified access token, or leave it null (guest order).
  let customerId = null;
  if (accessToken) {
    const user = await getAuthUser(env, accessToken);
    if (!user || !user.id) {
      return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);
    }
    customerId = user.id;
  }

  // ------------------------------------------- authoritative menu lookup
  const menuRes = await fetch(new URL("/menu.json", request.url));
  if (!menuRes.ok) {
    return jsonResponse({ error: "Menu is temporarily unavailable." }, 503);
  }
  const menu = await menuRes.json();
  const itemsById = new Map();
  for (const cat of menu.categories) {
    for (const it of cat.items) itemsById.set(it.id, it);
  }

  // ------------------------------------------------- re-price every line
  // Everything money-related below is computed here, from the
  // authoritative menu.json, never from anything the browser sent. If the
  // request body includes price/subtotal/total fields, they are read
  // nowhere in this function — only item_id, variantId, and quantity ever
  // feed into pricing.
  const lineItems = [];
  let subtotal = 0;

  for (const line of items) {
    const menuItem = itemsById.get(line?.id);
    if (!menuItem) {
      return jsonResponse({ error: `Unknown menu item: ${line?.id}` }, 400);
    }
    if (menuItem.available === false) {
      return jsonResponse({ error: `${menuItem.name} is currently unavailable.` }, 400);
    }
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return jsonResponse({ error: `Invalid quantity for ${menuItem.name}.` }, 400);
    }

    let unitPrice, variantId = null, variantName = null;
    if (Array.isArray(menuItem.variants) && menuItem.variants.length > 0) {
      const variant = menuItem.variants.find((v) => v.id === line.variantId);
      if (!variant) {
        return jsonResponse(
          { error: `Please choose a valid option for ${menuItem.name}.` },
          400
        );
      }
      unitPrice = variant.price;
      variantId = variant.id;
      variantName = variant.name;
    } else {
      unitPrice = menuItem.price;
    }

    const itemTotal = Math.round(unitPrice * quantity * 100) / 100;
    subtotal += itemTotal;

    lineItems.push({
      item_id: menuItem.id,
      item_name: menuItem.name,
      variant_id: variantId,
      variant_name: variantName,
      unit_price: unitPrice,
      quantity,
      item_total: itemTotal,
    });
  }
  subtotal = Math.round(subtotal * 100) / 100;

  const settings = await getSettings(env);
  const deliveryCharge = orderType === "delivery" ? (subtotal > settings.freeDeliveryThreshold ? 0 : settings.deliveryFee) : 0;
  const tax = Math.round(subtotal * settings.taxRate * 100) / 100;
  const total = Math.round((subtotal + deliveryCharge + tax) * 100) / 100;

  // ------------------------------------------------------- create order
  let order;
  try {
    order = await dbInsert(
      env,
      "orders",
      [
        {
          customer_id: customerId,
          customer_name: String(customer.name).trim(),
          customer_phone: String(customer.phone).trim(),
          customer_email: customer.email ? String(customer.email).trim() : null,
          customer_address: customer.address ? String(customer.address).trim() : null,
          delivery_lat: orderType === "delivery" ? deliveryLat : null,
          delivery_lng: orderType === "delivery" ? deliveryLng : null,
          order_type: orderType,
          payment_method: paymentMethod,
          payment_reference: paymentMethod === "easypaisa" ? String(paymentReference).trim() : null,
          customer_notes: customer.notes ? String(customer.notes).trim() : null,
          subtotal,
          tax,
          delivery_charge: deliveryCharge,
          total,
          idempotency_key: idempotencyKey || null,
        },
      ],
      { single: true }
    );
  } catch (err) {
    // A unique-constraint violation on idempotency_key means a concurrent
    // request with the same key won the race and already created the
    // order — treat it as a successful idempotent replay, not an error.
    if (idempotencyKey && String(err.message || "").includes("idempotency_key")) {
      const existing = await dbSelect(
        env,
        "orders",
        `idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=order_number,total,payment_status,order_status,guest_token,customer_id`
      );
      if (existing.length > 0) {
        logSecurityEvent(requestId, "idempotent_replay_race", { ip, idempotencyKey });
        const prior = existing[0];
        const response = {
          orderNumber: prior.order_number,
          total: prior.total,
          paymentStatus: prior.payment_status,
          orderStatus: prior.order_status,
        };
        if (!prior.customer_id) response.guestToken = prior.guest_token;
        return jsonResponse(response, 200);
      }
    }
    console.error("Order insert failed [requestId=" + requestId + "]:", err);
    return jsonResponse({ error: "Could not create order. Please try again." }, 500);
  }

  try {
    await dbInsert(
      env,
      "order_items",
      lineItems.map((li) => ({ ...li, order_id: order.id }))
    );
    await dbInsert(env, "order_status_history", [
      { order_id: order.id, status_type: "order", status_value: "received", changed_by: "system" },
      { order_id: order.id, status_type: "payment", status_value: "pending", changed_by: "system" },
    ]);
  } catch (err) {
    console.error("Order items insert failed [requestId=" + requestId + "]:", err);
    // Order row exists but line items failed — surface this distinctly so
    // it can be manually reconciled rather than silently losing items.
    return jsonResponse(
      { error: "Order was created but items failed to save. Please contact the restaurant with order number " + order.order_number },
      500
    );
  }

  const response = {
    orderNumber: order.order_number,
    total: order.total,
    paymentStatus: order.payment_status,
    orderStatus: order.order_status,
  };
  // A guest needs this token to retrieve their own confirmation later;
  // a logged-in customer can just look the order up under "My Orders".
  if (!customerId) response.guestToken = order.guest_token;

  return jsonResponse(response, 201);
}

// Reward points are intentionally NOT awarded here. They're awarded only
// once an admin moves the order into a genuinely confirmed state (see
// functions/api/admin/orders.js) — never at the moment of "Place Order".
