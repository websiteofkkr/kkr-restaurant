import { dbSelect, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

const VALID_PRIZE_TYPES = ["cash", "dining_credit", "free_meal", "discount", "gift", "other"];

/** GET /api/admin/contest-months?month=YYYY-MM — fetch (or lazily create
 *  with sensible defaults) the prize config for a month. This is the
 *  single source of truth every other part of the system reads from. */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  if (!month) return jsonResponse({ error: "month is required." }, 400);

  const rows = await dbSelect(env, "contest_months", `month=eq.${encodeURIComponent(month)}&select=*`);
  if (rows[0]) return jsonResponse({ contestMonth: rows[0] });

  // No row yet for this month — create one with the default prize so the
  // rest of the system always has something sane to read, without the
  // admin needing to remember to "set up" every new month manually.
  const created = await fetch(`${env.SUPABASE_URL}/rest/v1/contest_months`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify([{ month }]),
  });
  const createdRows = await created.json().catch(() => []);
  return jsonResponse({ contestMonth: createdRows[0] || { month, prize_description: "PKR 5,000 KKR Dining Credit" } });
});

/** PATCH /api/admin/contest-months — { month, prizeType, prizeAmount,
 *  prizeCurrency, prizeDescription } — updates a month's prize config.
 *  Also accepts { month, markRevealed: true } to record that the
 *  ceremonial reveal happened (display-only, never affects who won). */
export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const month = String(body?.month || "").trim();
  if (!month) return jsonResponse({ error: "month is required." }, 400);

  const patch = {};
  if (body.markRevealed === true) {
    patch.winner_revealed_at = new Date().toISOString();
  } else {
    if (body.prizeType != null) {
      if (body.prizeType && !VALID_PRIZE_TYPES.includes(body.prizeType)) {
        return jsonResponse({ error: "Invalid prize type." }, 400);
      }
      patch.prize_type = body.prizeType || null;
    }
    if (body.prizeAmount != null) patch.prize_amount = body.prizeAmount === "" ? null : Number(body.prizeAmount);
    if (body.prizeCurrency != null) patch.prize_currency = String(body.prizeCurrency).slice(0, 10) || "PKR";
    if (body.prizeDescription != null) {
      const desc = String(body.prizeDescription).trim();
      if (!desc) return jsonResponse({ error: "Prize description can't be empty." }, 400);
      patch.prize_description = desc.slice(0, 200);
    }
  }

  // Upsert — the row may not exist yet if this is the first time this
  // month's prize is being configured.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/contest_months`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: JSON.stringify([{ month, ...patch }]),
  });
  if (!res.ok) {
    console.error("contest_months upsert failed:", res.status, await res.text().catch(() => ""));
    return jsonResponse({ error: "Could not save prize settings." }, 500);
  }
  const rows = await res.json();
  return jsonResponse({ contestMonth: rows[0] });
});
