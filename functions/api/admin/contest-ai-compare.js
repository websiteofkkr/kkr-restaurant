import { dbSelect, dbUpdate, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

/** POST /api/admin/contest-ai-compare — { month }
 *  Part 10: takes the SHORTLISTED entries for the month and recommends
 *  the strongest 3 as finalists, ranked 1st/2nd/3rd. This reuses each
 *  entry's already-computed ai_score (from the shortlist step) rather
 *  than calling the AI again — comparing numbers already in hand is a
 *  ranking operation, not a new judgement call, so no extra AI cost here.
 *  The AI's role stops at recommending; a human still confirms the
 *  winner separately (Part 11). */
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
  if (!month) return jsonResponse({ error: "month is required." }, 400);

  const shortlisted = await dbSelect(
    env,
    "contest_entries",
    `contest_month=eq.${encodeURIComponent(month)}&status=eq.SHORTLISTED&select=*&order=ai_score.desc`
  );
  if (shortlisted.length === 0) {
    return jsonResponse({ error: "No shortlisted entries for that month yet — run the AI Shortlist first." }, 404);
  }

  const top3 = shortlisted.slice(0, 3);
  for (let i = 0; i < top3.length; i++) {
    await dbUpdate(env, "contest_entries", `id=eq.${encodeURIComponent(top3[i].id)}`, {
      status: "FINALIST",
      ai_rank: i + 1,
    });
  }

  return jsonResponse({
    finalists: top3.map((e, i) => ({
      place: i + 1,
      id: e.id,
      photoUrl: e.photo_url,
      socialUsername: e.social_username,
      aiScore: e.ai_score,
      aiStrengths: e.ai_strengths,
      aiWeaknesses: e.ai_weaknesses,
      aiReason: e.ai_reason,
    })),
    note: "AI Recommendation — KKR Staff Makes Final Decision",
  });
});
