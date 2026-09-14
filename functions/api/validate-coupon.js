import { jsonResponse, withErrorHandling } from "../_shared/supabase.js";

/** POST /api/validate-coupon — { code, subtotal }
 *  Returns the discount a coupon would apply, without consuming it. The
 *  actual order endpoint re-validates and consumes it for real at
 *  checkout — this is purely a preview so the customer sees the discount
 *  before placing the order. */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const code = String(body?.code || "").trim().toUpperCase();
  const subtotal = Number(body?.subtotal);
  if (!code) return jsonResponse({ error: "Enter a coupon code." }, 400);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return jsonResponse({ error: "Invalid order amount." }, 400);
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/coupons?code=eq.${encodeURIComponent(code)}&select=*`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  });
  const rows = await res.json();
  const coupon = rows[0];

  if (!coupon || !coupon.active) {
    return jsonResponse({ error: "That coupon code isn't valid." }, 404);
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return jsonResponse({ error: "That coupon has expired." }, 400);
  }
  if (coupon.usage_limit != null && coupon.times_used >= coupon.usage_limit) {
    return jsonResponse({ error: "That coupon has already been fully redeemed." }, 400);
  }
  if (subtotal < Number(coupon.min_order_amount || 0)) {
    return jsonResponse(
      { error: `This coupon needs a minimum order of Rs. ${Number(coupon.min_order_amount).toLocaleString()}.` },
      400
    );
  }

  let discount;
  if (coupon.discount_type === "percent") {
    discount = subtotal * (Number(coupon.discount_value) / 100);
    if (coupon.max_discount_amount != null) {
      discount = Math.min(discount, Number(coupon.max_discount_amount));
    }
  } else {
    discount = Number(coupon.discount_value);
  }
  discount = Math.min(Math.round(discount * 100) / 100, subtotal);

  return jsonResponse({
    valid: true,
    code,
    discountType: coupon.discount_type,
    discountValue: Number(coupon.discount_value),
    discount,
  });
});
