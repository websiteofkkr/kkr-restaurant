import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";
import { evaluatePhoto } from "../../_shared/contest-ai.js";

/** POST /api/admin/contest-ai-shortlist — { month, evaluateOnly }
 *  Part 9: evaluates any un-evaluated VALID entries for the given month
 *  (each entry only once — Part 7 cost control), ranks everyone by
 *  ai_score, and marks the top N (contest_shortlist_size, default 10) as
 *  SHORTLISTED. Pass evaluateOnly:true to just score entries without
 *  changing any statuses (used by the "Re-evaluate" button on one entry
 *  via a month of exactly that one entry, or a dry run). */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const month = String(body?.month || "").trim();
  const singleEntryId = body?.entryId ? String(body.entryId).trim() : null;
  if (!month && !singleEntryId) return jsonResponse({ error: "month is required." }, 400);

  // Single-entry re-evaluation path (Part 7's [Re-evaluate] button).
  if (singleEntryId) {
    const rows = await dbSelect(env, "contest_entries", `id=eq.${encodeURIComponent(singleEntryId)}&select=photo_url`);
    if (!rows[0]) return jsonResponse({ error: "Entry not found." }, 404);
    try {
      const scores = await evaluatePhoto(env, rows[0].photo_url);
      const updated = await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(singleEntryId)}`, scores);
      return jsonResponse({ entry: updated[0] });
    } catch (err) {
      return jsonResponse({ error: err.message }, 502);
    }
  }

  // Month-wide shortlist run.
  const entries = await dbSelect(
    env,
    "contest_entries",
    `contest_month=eq.${encodeURIComponent(month)}&status=eq.VALID&select=id,photo_url,ai_evaluated_at`
  );
  if (entries.length === 0) {
    return jsonResponse({ error: "No VALID entries found for that month." }, 404);
  }

  const settingsRows = await dbSelect(env, "settings", "key=eq.contest_shortlist_size&select=value");
  const shortlistSize = Number(settingsRows[0]?.value) || 10;

  let evaluatedCount = 0;
  const failures = [];
  for (const entry of entries) {
    if (entry.ai_evaluated_at) continue; // Part 7: never re-evaluate automatically
    try {
      const scores = await evaluatePhoto(env, entry.photo_url);
      await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(entry.id)}`, scores);
      evaluatedCount++;
    } catch (err) {
      failures.push({ id: entry.id, error: err.message });
      // If the API key simply isn't configured, every subsequent call
      // will fail identically — stop early instead of retrying N times.
      if (err.message.includes("isn't configured")) break;
    }
  }

  if (evaluatedCount === 0 && failures.length > 0) {
    return jsonResponse({ error: failures[0].error, failures }, 502);
  }

  // Re-fetch with fresh scores, rank, and mark the top N.
  const scored = await dbSelect(
    env,
    "contest_entries",
    `contest_month=eq.${encodeURIComponent(month)}&status=eq.VALID&ai_score=not.is.null&select=id,ai_score&order=ai_score.desc`
  );
  const topIds = scored.slice(0, shortlistSize).map((e) => e.id);

  for (let i = 0; i < scored.length; i++) {
    await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(scored[i].id)}`, {
      ai_rank: i + 1,
      status: topIds.includes(scored[i].id) ? "SHORTLISTED" : "VALID",
    });
  }

  return jsonResponse({ evaluatedCount, shortlistedCount: topIds.length, failures });
});
