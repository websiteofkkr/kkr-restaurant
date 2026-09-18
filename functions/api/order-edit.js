import { dbSelect, dbUpdate, dbInsert, getAuthUser, jsonResponse, withErrorHandling } from "../_shared/supabase.js";
import { getSettings } from "./order.js";

/** POST /api/order-edit — { orderId, accessToken, items }
 *  Adds items to an existing order that's still in the "received" state
 *  (not yet confirmed by staff). This is the intended path for a customer
 *  who wants to add something within 24 hours of their last order,
 *  instead of placing a brand new one — see the 24-hour check in
 *  order.js for the other half of this rule. */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { orderId, accessToken, items } = body || {};
  if (!orderId) return jsonResponse({ error: "orderId is required." }, 400);
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: "Add at least one item." }, 400);
  }
  if (!accessToken) {
    return jsonResponse({ error: "Please log in to edit your order." }, 401);
  }
  const user = await getAuthUser(env, accessToken);
  if (!user || !user.id) {
    return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);
  }

  // The order must belong to this customer and still be editable — never
  // trust orderId alone, always re-check ownership and status server-side.
  const orders = await dbSelect(
    env,
    "orders",
    `id=eq.${encodeURIComponent(orderId)}&select=id,customer_id,order_status,order_type,subtotal,tax,delivery_charge,total,discount_amount,coupon_code&limit=1`
  );
  const order = orders[0];
  if (!order || order.customer_id !== user.id) {
    return jsonResponse({ error: "Order not found." }, 404);
  }
  if (order.order_status !== "received") {
    return jsonResponse(
      { error: "This order has already been confirmed and can no longer be edited." },
      409
    );
  }

  // ------------------------------------------------- re-price every line
  // Same rule as order creation: nothing money-related is trusted from
  // the browser, only item_id / variantId / quantity feed into pricing.
  const menuRes = await fetch(new URL("/menu.json", request.url));
  if (!menuRes.ok) return jsonResponse({ error: "Menu is temporarily unavailable." }, 503);
  const menu = await menuRes.json();
  const itemsById = new Map();
  for (const cat of menu.categories) {
    for (const it of cat.items) itemsById.set(it.id, it);
  }

  const discountRows = await dbSelect(
    env,
    "menu_item_discounts",
    "select=item_id,discounted_price&variant_id=eq.&active=eq.true"
  );
  const discountByItemId = new Map(discountRows.map((d) => [d.item_id, Number(d.discounted_price)]));

  const newLineItems = [];
  let addedSubtotal = 0;

  for (const line of items) {
    const menuItem = itemsById.get(line?.id);
    if (!menuItem) return jsonResponse({ error: `Unknown menu item: ${line?.id}` }, 400);
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
      if (!variant) return jsonResponse({ error: `Please choose a valid option for ${menuItem.name}.` }, 400);
      unitPrice = variant.price;
      variantId = variant.id;
      variantName = variant.name;
    } else {
      unitPrice = discountByItemId.has(menuItem.id) ? discountByItemId.get(menuItem.id) : menuItem.price;
    }

    const itemTotal = Math.round(unitPrice * quantity * 100) / 100;
    addedSubtotal += itemTotal;

    newLineItems.push({
      order_id: order.id,
      item_id: menuItem.id,
      item_name: menuItem.name,
      variant_id: variantId,
      variant_name: variantName,
      unit_price: unitPrice,
      quantity,
      item_total: itemTotal,
    });
  }

  // ------------------------------------------- recompute order totals
  // Re-derive tax/delivery from the *new* combined subtotal rather than
  // just adding the new items' tax on top — keeps rounding consistent
  // with how a single fresh order would have been priced.
  const settings = await getSettings(env);
  const newSubtotal = Math.round((Number(order.subtotal) + addedSubtotal) * 100) / 100;
  const discount = Number(order.discount_amount || 0);
  const discountedSubtotal = Math.max(0, Math.round((newSubtotal - discount) * 100) / 100);
  const deliveryCharge =
    order.order_type === "delivery" ? (discountedSubtotal > settings.freeDeliveryThreshold ? 0 : settings.deliveryFee) : 0;
  const tax = Math.round(discountedSubtotal * settings.taxRate * 100) / 100;
  const newTotal = Math.round((discountedSubtotal + deliveryCharge + tax) * 100) / 100;

  try {
    await dbInsert(env, "order_items", newLineItems);
    await dbUpdate(env, "orders", `id=eq.${encodeURIComponent(order.id)}`, {
      subtotal: newSubtotal,
      tax,
      delivery_charge: deliveryCharge,
      total: newTotal,
    });
  } catch (err) {
    console.error("Order edit failed:", err);
    return jsonResponse({ error: "Could not update your order. Please try again." }, 500);
  }

  return jsonResponse({ success: true, orderId: order.id, newTotal });
});
