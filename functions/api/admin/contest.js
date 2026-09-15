import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

const VALID_STATUSES = ["SUBMITTED", "VALIDATING", "VALID", "SHORTLISTED", "FINALIST", "WINNER", "NOT_SELECTED", "REJECTED"];
const VALID_REWARD_STATUSES = ["PENDING", "ISSUED", "REDEEMED", "EXPIRED"];

const genRewardCode = (contestMonth) => {
  // KKR-SEP26-XXXXX — month/year plus a hard-to-guess random suffix, not
  // sequential or otherwise predictable (Part 12).
  const [year, month] = contestMonth.split("-");
  const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleString("en", { month: "short" }).toUpperCase();
  const yy = year.slice(-2);
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const suffix = Array.from(bytes, (b) => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[b % 32]).join("");
  return `KKR-${monthName}${yy}-${suffix}`;
};

/** GET /api/admin/contest?month=&status=&platform=&minScore() — list with
 *  optional filters (Part 8). Every field including email/staff notes is
 *  visible here since this is the admin-only view. Also returns a
 *  computed status for "the permanent Photo of the Month section" (Part
 *  1) and the list of months that have any activity (Part 11: History) —
 *  derived entirely from contest_entries, no separate month-tracking
 *  table needed, so there's nothing that can drift out of sync. */
export const onRequestGet = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");
  const minScore = url.searchParams.get("minScore");

  const filters = [];
  if (month) filters.push(`contest_month=eq.${encodeURIComponent(month)}`);
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
  if (platform) filters.push(`social_platform=eq.${encodeURIComponent(platform)}`);
  if (minScore) filters.push(`ai_score=gte.${encodeURIComponent(minScore)}`);
  filters.push("select=*", "order=submitted_at.desc");

  const rows = await dbSelect(env, "contest_entries", filters.join("&"));

  const scoped = month ? rows.filter((r) => r.contest_month === month) : rows;
  const winnerRow = scoped.find((r) => r.status === "WINNER");

  let monthStatus = "COMING_SOON";
  if (winnerRow?.published_at) monthStatus = "PUBLISHED";
  else if (winnerRow) monthStatus = "WINNER_SELECTED";
  else if (scoped.some((r) => r.status === "FINALIST" || r.status === "SHORTLISTED")) monthStatus = "JUDGING";
  else if (scoped.length > 0) monthStatus = "ACCEPTING_ENTRIES";

  const summary = {
    totalEntries: scoped.length,
    validEntries: scoped.filter((r) => ["VALID", "SHORTLISTED", "FINALIST", "WINNER", "NOT_SELECTED"].includes(r.status)).length,
    aiEvaluated: scoped.filter((r) => r.ai_evaluated_at).length,
    shortlisted: scoped.filter((r) => r.status === "SHORTLISTED").length,
    finalists: scoped.filter((r) => r.status === "FINALIST").length,
    winner: winnerRow?.contestant_name || null,
    winnerUsername: winnerRow?.social_username || null,
    rewardStatus: winnerRow?.reward_status || null,
    monthStatus,
    published: !!winnerRow?.published_at,
  };

  // All-time distinct months (for the History picker) — a cheap extra
  // query, only the one column.
  const allMonthRows = await dbSelect(env, "contest_entries", "select=contest_month&order=contest_month.desc");
  const availableMonths = [...new Set(allMonthRows.map((r) => r.contest_month))];

  // The month's prize is the single source of truth (Part 4) — read here
  // so the admin dashboard always shows what the public site will show.
  let prizeDescription = "PKR 5,000 KKR Dining Credit";
  let revealedAt = null;
  if (month) {
    const monthRows = await dbSelect(env, "contest_months", `month=eq.${encodeURIComponent(month)}&select=prize_description,winner_revealed_at`);
    if (monthRows[0]) {
      prizeDescription = monthRows[0].prize_description;
      revealedAt = monthRows[0].winner_revealed_at;
    }
  }
  summary.prizeDescription = prizeDescription;
  summary.winnerRevealedAt = revealedAt;

  return jsonResponse({ entries: rows, summary, availableMonths });
});

/** PATCH /api/admin/contest — a handful of distinct admin actions on one
 *  entry, selected by which fields are present in the body:
 *  - { id, status } — plain status change (e.g. REJECTED, VALIDATING)
 *  - { id, staffNotes } — save staff notes
 *  - { id, selectWinner: true } — Part 11: confirm this entry as winner,
 *    demote other FINALIST entries in the same month to NOT_SELECTED
 *  - { id, rewardStatus } — Part 12: PENDING -> ISSUED -> REDEEMED
 */
export const onRequestPatch = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const id = String(body?.id || "").trim();
  if (!id) return jsonResponse({ error: "id is required." }, 400);

  if (body.selectWinner === true) {
    const rows = await dbSelect(env, "contest_entries", `id=eq.${encodeURIComponent(id)}&select=contest_month`);
    const entry = rows[0];
    if (!entry) return jsonResponse({ error: "Entry not found." }, 404);

    const rewardCode = genRewardCode(entry.contest_month);
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, {
      status: "WINNER",
      is_winner: true,
      winner_selected_at: new Date().toISOString(),
      reward_code: rewardCode,
      reward_status: "PENDING",
    });

    // Every other FINALIST in the same month becomes NOT_SELECTED — never
    // silently deleted or altered beyond that one field (spec: "Do not
    // delete or modify lower-ranked entries" applies here too).
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/contest_entries?contest_month=eq.${encodeURIComponent(entry.contest_month)}&status=eq.FINALIST&id=neq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "NOT_SELECTED" }),
      }
    );

    return jsonResponse({ entry: updated[0] });
  }

  if (body.publish === true) {
    const rows = await dbSelect(env, "contest_entries", `id=eq.${encodeURIComponent(id)}&select=status`);
    if (!rows[0]) return jsonResponse({ error: "Entry not found." }, 404);
    if (rows[0].status !== "WINNER") {
      return jsonResponse({ error: "Only a confirmed winner can be published." }, 400);
    }
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, {
      published_at: new Date().toISOString(),
      announcement_caption: body.caption ? String(body.caption).slice(0, 2000) : null,
    });
    return jsonResponse({ entry: updated[0] });
  }

  // Takes a published winner back off the public site immediately, but
  // keeps them recorded as the internal WINNER (use undoWinner below for
  // a full reversal, e.g. after testing with a placeholder entry).
  if (body.unpublish === true) {
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, {
      published_at: null,
    });
    return jsonResponse({ entry: updated[0] });
  }

  // Fully reverses a winner selection — unpublishes, clears the reward
  // code/status, and reverts status back to FINALIST so a different
  // entry can be selected instead. Meant for correcting a mistaken or
  // test selection, not for changing a real published winner's mind.
  if (body.undoWinner === true) {
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, {
      status: "FINALIST",
      is_winner: false,
      published_at: null,
      announcement_caption: null,
      reward_code: null,
      reward_status: null,
      winner_selected_at: null,
    });
    return jsonResponse({ entry: updated[0] });
  }

  if (body.rewardStatus != null) {
    if (!VALID_REWARD_STATUSES.includes(body.rewardStatus)) {
      return jsonResponse({ error: "Invalid reward status." }, 400);
    }
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, {
      reward_status: body.rewardStatus,
    });
    return jsonResponse({ entry: updated[0] });
  }

  if (body.staffNotes != null) {
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, {
      staff_notes: String(body.staffNotes).slice(0, 2000),
    });
    return jsonResponse({ entry: updated[0] });
  }

  if (body.status != null) {
    if (!VALID_STATUSES.includes(body.status)) {
      return jsonResponse({ error: "Invalid status." }, 400);
    }
    const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(id)}`, { status: body.status });
    return jsonResponse({ entry: updated[0] });
  }

  return jsonResponse({ error: "No recognized action in request body." }, 400);
});
