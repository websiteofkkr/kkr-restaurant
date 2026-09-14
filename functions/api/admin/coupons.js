import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** GET /api/admin/coupons — list all coupons */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await dbSelect(env, "coupons", "select=*&order=created_at.desc");
  return jsonResponse({ coupons: rows });
});

/** POST /api/admin/coupons — create a new coupon */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const code = String(body?.code || "").trim().toUpperCase();
  const discountType = body?.discountType === "flat" ? "flat" : "percent";
  const discountValue = Number(body?.discountValue);
  const minOrderAmount = Number(body?.minOrderAmount || 0);
  const maxDiscountAmount = body?.maxDiscountAmount != null && body.maxDiscountAmount !== "" ? Number(body.maxDiscountAmount) : null;
  const usageLimit = body?.usageLimit != null && body.usageLimit !== "" ? Number(body.usageLimit) : null;
  const expiresAt = body?.expiresAt ? String(body.expiresAt) : null;

  if (!code || code.length < 3) {
    return jsonResponse({ error: "Coupon code must be at least 3 characters." }, 400);
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return jsonResponse({ error: "Enter a valid discount value." }, 400);
  }
  if (discountType === "percent" && discountValue > 100) {
    return jsonResponse({ error: "A percentage discount can't exceed 100." }, 400);
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/coupons`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      code,
      discount_type: discountType,
      discount_value: discountValue,
      min_order_amount: minOrderAmount,
      max_discount_amount: maxDiscountAmount,
      usage_limit: usageLimit,
      expires_at: expiresAt,
      active: true,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (detail.includes("duplicate key") || detail.includes("coupons_pkey")) {
      return jsonResponse({ error: `A coupon with the code "${code}" already exists.` }, 409);
    }
    console.error("Coupon create failed:", res.status, detail);
    return jsonResponse({ error: "Could not create coupon." }, 500);
  }
  const rows = await res.json();
  return jsonResponse({ coupon: rows[0] });
});

/** PATCH /api/admin/coupons — { code, active } — toggle on/off */
export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const code = String(body?.code || "").trim().toUpperCase();
  if (!code) return jsonResponse({ error: "code is required." }, 400);

  const updated = await dbUpdate(env, "coupons", `code=eq.${encodeURIComponent(code)}`, {
    active: body.active === true,
  });
  return jsonResponse({ coupon: updated[0] });
});

/** DELETE /api/admin/coupons?code=... */
export const onRequestDelete = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) return jsonResponse({ error: "code is required." }, 400);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/coupons?code=eq.${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return jsonResponse({ error: "Could not delete coupon." }, 500);
  return jsonResponse({ success: true });
});
