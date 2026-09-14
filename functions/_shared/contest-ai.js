/**
 * AI photo evaluation for the Photo of the Month contest.
 *
 * Requires an ANTHROPIC_API_KEY environment variable set in Cloudflare
 * Pages (Settings -> Environment variables, Production). This is NOT
 * currently configured anywhere in this project — until it's added, every
 * call here returns a clear "not configured" error rather than crashing,
 * so the rest of the admin dashboard (manual review, shortlisting,
 * winner selection) keeps working without it.
 *
 * The API key never reaches the browser: this file only runs inside a
 * Cloudflare Function, server-side.
 */

const SCORING_PROMPT = `You are helping a restaurant (KKR, a Peshawari restaurant in Pakistan) judge entries in a monthly guest photo contest. Score the attached photo on these five criteria, each out of the stated maximum:

- Food appeal (max 25): does the food look appetizing and well-presented?
- Photo quality / composition (max 20): lighting, framing, focus, overall photographic quality.
- KKR atmosphere / brand connection (max 20): does it capture the restaurant's dining room, food, or hospitality in a way that reflects well on KKR?
- Creativity / originality (max 20): is this a distinctive or memorable shot, not just a generic snapshot?
- Authentic guest moment (max 15): does it feel like a genuine, unposed guest experience rather than a stock-style photo?

You must judge ONLY the photograph and these five criteria. Do NOT comment on, describe, or factor in the attractiveness, age, gender, race, religion, ethnicity, or any other personal characteristic of any person visible in the photo — if people appear, judge only the scene/composition/mood they're part of, never their appearance.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{
  "food_score": <0-25>,
  "composition_score": <0-20>,
  "atmosphere_score": <0-20>,
  "creativity_score": <0-20>,
  "authenticity_score": <0-15>,
  "reason": "<2-3 sentence overall explanation>",
  "strengths": "<1-2 sentences>",
  "weaknesses": "<1-2 sentences>",
  "recommendation": "<SHORTLIST | MAYBE | NOT_RECOMMENDED>"
}`;

/** Fetches an image and returns { base64, mediaType }, needed since
 *  Claude's vision API takes inline base64 image data, not a URL. */
async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  const mediaType = res.headers.get("content-type") || "image/jpeg";
  const buf = await res.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mediaType };
}

/** Evaluates one photo. Returns the parsed scoring object, or throws with
 *  a message safe to show an admin (never leaks the API key). */
export async function evaluatePhoto(env, photoUrl) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "AI evaluation isn't configured yet — add an ANTHROPIC_API_KEY environment variable in Cloudflare Pages to enable it."
    );
  }

  const { base64, mediaType } = await fetchImageAsBase64(photoUrl);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: SCORING_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("AI evaluation call failed:", res.status, detail);
    throw new Error("AI evaluation request failed.");
  }

  const data = await res.json();
  const text = (data.content || []).find((b) => b.type === "text")?.text || "";
  let parsed;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("AI returned an unexpected response format.");
  }

  const food = Number(parsed.food_score) || 0;
  const composition = Number(parsed.composition_score) || 0;
  const atmosphere = Number(parsed.atmosphere_score) || 0;
  const creativity = Number(parsed.creativity_score) || 0;
  const authenticity = Number(parsed.authenticity_score) || 0;

  return {
    ai_food_score: food,
    ai_composition_score: composition,
    ai_atmosphere_score: atmosphere,
    ai_creativity_score: creativity,
    ai_authenticity_score: authenticity,
    ai_score: food + composition + atmosphere + creativity + authenticity,
    ai_reason: String(parsed.reason || "").slice(0, 1000),
    ai_strengths: String(parsed.strengths || "").slice(0, 500),
    ai_weaknesses: String(parsed.weaknesses || "").slice(0, 500),
    ai_recommendation: ["SHORTLIST", "MAYBE", "NOT_RECOMMENDED"].includes(parsed.recommendation)
      ? parsed.recommendation
      : "MAYBE",
    ai_evaluated_at: new Date().toISOString(),
  };
}
