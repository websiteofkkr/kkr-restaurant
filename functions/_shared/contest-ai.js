/**
 * AI photo evaluation for the Photo of the Month contest, using
 * Cloudflare Workers AI via the native `env.AI` binding — NOT an
 * external API. There is no API key anywhere in this file, and none is
 * needed: once the AI binding is added to this Pages project (Cloudflare
 * dashboard -> Pages project -> Settings -> Functions -> Bindings ->
 * "Add binding" -> type "AI", variable name "AI"), `env.AI` is
 * automatically available in every Function, with Cloudflare handling
 * auth entirely on their own infrastructure.
 *
 * Model: @cf/meta/llama-3.2-11b-vision-instruct — Meta's vision-capable
 * model, confirmed still current on Workers AI as of this writing (not
 * among the models scheduled for deprecation). It accepts an image
 * directly (as a byte array) plus a text prompt and returns a text
 * response, which we ask it to return as JSON and then parse.
 */

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const SCORING_PROMPT = `You are helping a restaurant (KKR, a Peshawari restaurant in Pakistan) judge entries in a monthly guest photo contest. Score the attached photo on these five criteria, each out of the stated maximum:

- Food appeal (max 25): does the food look appetizing and well-presented?
- Photo quality / composition (max 20): lighting, framing, focus, overall photographic quality.
- KKR atmosphere / brand connection (max 20): does it capture the restaurant's dining room, food, or hospitality in a way that reflects well on KKR?
- Creativity / originality (max 20): is this a distinctive or memorable shot, not just a generic snapshot?
- Authentic guest moment (max 15): does it feel like a genuine, unposed guest experience rather than a stock-style photo?

You must judge ONLY the photograph and these five criteria. Do NOT comment on, describe, or factor in the attractiveness, age, gender, race, religion, ethnicity, or any other personal characteristic of any person visible in the photo — if people appear, judge only the scene/composition/mood they're part of, never their appearance.

Respond with ONLY a JSON object, no other text, no markdown formatting, in exactly this shape:
{"food_score": 0, "composition_score": 0, "atmosphere_score": 0, "creativity_score": 0, "authenticity_score": 0, "reason": "2-3 sentence overall explanation", "strengths": "1-2 sentences", "weaknesses": "1-2 sentences", "recommendation": "SHORTLIST or MAYBE or NOT_RECOMMENDED"}`;

/** Fetches an image and returns it as a plain byte array, the input
 *  shape this model's `image` parameter expects. */
async function fetchImageAsBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  const buf = await res.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

/** Evaluates one photo. Returns the parsed scoring object, or throws with
 *  a message safe to show an admin. */
export async function evaluatePhoto(env, photoUrl) {
  if (!env.AI) {
    throw new Error(
      "AI evaluation isn't configured yet — add a Workers AI binding named \"AI\" to this Pages project in Cloudflare (Settings -> Functions -> Bindings)."
    );
  }

  const image = await fetchImageAsBytes(photoUrl);

  let response;
  try {
    response = await env.AI.run(VISION_MODEL, {
      image,
      prompt: SCORING_PROMPT,
      max_tokens: 600,
    });
  } catch (err) {
    console.error("Workers AI call failed:", err);
    throw new Error("AI evaluation request failed.");
  }

  const text = typeof response === "string" ? response : response?.response || "";
  let parsed;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
  } catch {
    throw new Error("AI returned an unexpected response format.");
  }

  const food = Math.max(0, Math.min(25, Number(parsed.food_score) || 0));
  const composition = Math.max(0, Math.min(20, Number(parsed.composition_score) || 0));
  const atmosphere = Math.max(0, Math.min(20, Number(parsed.atmosphere_score) || 0));
  const creativity = Math.max(0, Math.min(20, Number(parsed.creativity_score) || 0));
  const authenticity = Math.max(0, Math.min(15, Number(parsed.authenticity_score) || 0));

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
