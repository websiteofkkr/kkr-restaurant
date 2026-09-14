import { jsonResponse, withErrorHandling } from "../_shared/supabase.js";

/** GET /api/contest-winners — public list of past/current Photo of the
 *  Month winners. Deliberately hand-picks only the fields that are safe
 *  to show publicly (Part 13/16) rather than exposing the row directly —
 *  email, staff_notes, reward_code, ai_* fields never leave the server. */
export const onRequestGet = withErrorHandling(async ({ env }) => {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/contest_entries?status=eq.WINNER&select=photo_url,social_username,social_platform,contest_month,caption,winner_selected_at&order=contest_month.desc`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!res.ok) return jsonResponse({ winners: [] });
  const rows = await res.json();

  const winners = rows.map((r) => ({
    photoUrl: r.photo_url,
    username: r.social_username,
    platform: r.social_platform,
    contestMonth: r.contest_month,
    caption: r.caption,
  }));

  return jsonResponse({ winners });
});
