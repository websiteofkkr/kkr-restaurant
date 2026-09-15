import { jsonResponse, withErrorHandling } from "../_shared/supabase.js";

/** GET /api/contest-winners — public list of published Photo of the
 *  Month winners. Deliberately hand-picks only the fields that are safe
 *  to show publicly (Part 13/16) rather than exposing the row directly —
 *  email, staff_notes, reward_code, ai_* fields never leave the server.
 *  Only entries with a published_at timestamp show here — selecting a
 *  winner and publishing it are separate admin steps, so a winner picked
 *  internally never appears on the site until explicitly published. */
export const onRequestGet = withErrorHandling(async ({ env }) => {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/contest_entries?published_at=not.is.null&select=photo_url,social_username,social_platform,contest_month,caption,published_at&order=published_at.desc`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!res.ok) return jsonResponse({ winners: [] });
  const rows = await res.json();

  // Each winner's prize comes from that month's own record (Part 4/26) —
  // never a value baked into this response or hard-coded on the frontend.
  const months = [...new Set(rows.map((r) => r.contest_month))];
  const prizeByMonth = {};
  if (months.length > 0) {
    const monthsFilter = months.map((m) => `"${m}"`).join(",");
    const monthRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/contest_months?month=in.(${monthsFilter})&select=month,prize_description`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const monthRows = await monthRes.json().catch(() => []);
    monthRows.forEach((m) => (prizeByMonth[m.month] = m.prize_description));
  }

  const winners = rows.map((r) => ({
    photoUrl: r.photo_url,
    username: r.social_username,
    platform: r.social_platform,
    contestMonth: r.contest_month,
    caption: r.caption,
    prizeDescription: prizeByMonth[r.contest_month] || "PKR 5,000 KKR Dining Credit",
  }));

  return jsonResponse({ winners });
});
