import { dbInsert, jsonResponse, withErrorHandling } from "../_shared/supabase.js";
import { checkRateLimit, rateLimitConfig, clientIp } from "../_shared/rate-limit.js";
import { newRequestId, logSecurityEvent } from "../_shared/log.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const requestId = newRequestId();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  // Honeypot — a real visitor never sees or fills this field (hidden via
  // CSS), so anything non-empty here is almost certainly a bot. Reply
  // with a normal-looking success so the bot doesn't learn to adapt.
  if (String(body?.company || "").trim()) {
    logSecurityEvent(requestId, "reservation_honeypot_triggered", { ip: clientIp(request) });
    return jsonResponse({ success: true });
  }

  const { limit, windowSeconds } = rateLimitConfig(env, "RESERVATION", 5, 600);
  const allowed = await checkRateLimit(env, `reservation:${clientIp(request)}`, limit, windowSeconds);
  if (!allowed) {
    logSecurityEvent(requestId, "reservation_rate_limited", { ip: clientIp(request) });
    return jsonResponse({ error: "Too many requests. Please try again in a few minutes." }, 429);
  }

  const name = String(body?.name || "").trim();
  const phone = String(body?.phone || "").trim();
  const email = String(body?.email || "").trim();
  const date = String(body?.date || "").trim();
  const time = String(body?.time || "").trim();
  const guests = Number(body?.guests);
  const occasion = String(body?.type || "").trim();
  const notes = String(body?.notes || "").trim();
  const lang = ["en", "ur", "ps"].includes(body?.lang) ? body.lang : "en";

  if (!name || !phone || !date || !time || !Number.isInteger(guests) || guests < 1) {
    return jsonResponse({ error: "Please fill in every required field." }, 400);
  }
  if (!/^\d{7,11}$/.test(phone)) {
    return jsonResponse({ error: "Please enter a valid phone number (digits only, up to 11 digits)." }, 400);
  }
  if (guests > 200) {
    return jsonResponse({ error: "For groups this size, please call us directly." }, 400);
  }

  const row = await dbInsert(env, "reservations", [
    {
      name: name.slice(0, 80),
      phone: phone.slice(0, 11),
      email: email ? email.slice(0, 120) : null,
      reservation_date: date,
      reservation_time: time,
      guests,
      occasion: occasion ? occasion.slice(0, 80) : null,
      notes: notes ? notes.slice(0, 800) : null,
      lang,
      status: "new",
    },
  ]);

  return jsonResponse({ success: true, id: row[0]?.id });
});
