import { jsonResponse, withErrorHandling } from "../_shared/supabase.js";

const currentContestMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** GET /api/contest-status — public, tiny. Tells the homepage whether
 *  there's an announcement countdown running for the current month, and
 *  whether that month's winner has actually been published yet — so the
 *  countdown and the "reveal in progress" states know what to show
 *  without exposing anything about entries, scores, or unpublished
 *  winners. */
export const onRequestGet = withErrorHandling(async ({ env }) => {
  const month = currentContestMonth();

  const monthRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/contest_months?month=eq.${encodeURIComponent(month)}&select=reveal_at`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const monthRows = await monthRes.json().catch(() => []);
  const revealAt = monthRows[0]?.reveal_at || null;

  const winnerRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/contest_entries?contest_month=eq.${encodeURIComponent(month)}&published_at=not.is.null&select=id&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const winnerRows = await winnerRes.json().catch(() => []);
  const currentMonthPublished = winnerRows.length > 0;

  return jsonResponse({ month, revealAt, currentMonthPublished });
});
