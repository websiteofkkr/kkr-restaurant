import { dbInsert, dbSelect, jsonResponse, withErrorHandling } from "../_shared/supabase.js";
import { checkRateLimit, rateLimitConfig, clientIp } from "../_shared/rate-limit.js";
import { newRequestId, logSecurityEvent } from "../_shared/log.js";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB — generous for a phone photo, not a video host
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_PLATFORMS = ["instagram", "tiktok", "facebook", "snapchat", "x", "youtube", "other"];

const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const urlOk = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const currentContestMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Scans the first portion of an image file for common EXIF metadata
 *  markers, across the three formats this endpoint accepts:
 *  - JPEG: an APP1 segment (bytes 0xFFE1) containing the ASCII "Exif"
 *  - WEBP: an "EXIF" RIFF chunk fourCC
 *  - PNG:  an "eXIf" chunk (case-sensitive, per the PNG spec)
 *  This is a lightweight signature scan, not a full parser — sufficient
 *  to tell "some EXIF block is present" from "none at all" without
 *  pulling in an image-parsing library. */
function bufferHasExifMarker(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 131072)); // first 128KB is plenty; EXIF sits near the start
  const needles = ["Exif", "EXIF", "eXIf"].map((s) => Array.from(s, (c) => c.charCodeAt(0)));
  for (let i = 0; i < bytes.length - 4; i++) {
    for (const needle of needles) {
      let match = true;
      for (let j = 0; j < needle.length; j++) {
        if (bytes[i + j] !== needle[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }
  return false;
}

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const requestId = newRequestId();

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  if (String(form.get("company") || "").trim()) {
    logSecurityEvent(requestId, "contest_honeypot_triggered", { ip: clientIp(request) });
    return jsonResponse({ success: true });
  }

  const { limit, windowSeconds } = rateLimitConfig(env, "CONTEST_ENTRY", 3, 3600);
  const allowed = await checkRateLimit(env, `contest-entry:${clientIp(request)}`, limit, windowSeconds);
  if (!allowed) {
    logSecurityEvent(requestId, "contest_entry_rate_limited", { ip: clientIp(request) });
    return jsonResponse({ error: "Too many submissions. Please try again later." }, 429);
  }

  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const socialUsername = String(form.get("socialUsername") || "").trim();
  const socialPlatform = String(form.get("socialPlatform") || "").trim().toLowerCase();
  const postUrl = String(form.get("postUrl") || "").trim();
  const caption = String(form.get("caption") || "").trim();
  const consent = form.get("consent") === "true" || form.get("consent") === "on";
  const photo = form.get("photo");

  if (!name || !email || !socialUsername || !socialPlatform) {
    return jsonResponse({ error: "Please fill in every required field." }, 400);
  }
  if (!emailOk(email)) return jsonResponse({ error: "Please enter a valid email address." }, 400);
  if (!ALLOWED_PLATFORMS.includes(socialPlatform)) {
    return jsonResponse({ error: "Please choose a valid social platform." }, 400);
  }
  if (postUrl && !urlOk(postUrl)) {
    return jsonResponse({ error: "That doesn't look like a valid post link." }, 400);
  }
  if (!consent) {
    return jsonResponse({ error: "Please confirm you're okay with KKR reposting your photo with credit." }, 400);
  }
  if (!photo || typeof photo === "string") {
    return jsonResponse({ error: "Please attach a photo." }, 400);
  }
  if (!ALLOWED_IMAGE_TYPES.includes(photo.type)) {
    return jsonResponse({ error: "Photo must be JPEG, PNG, or WEBP." }, 400);
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return jsonResponse({ error: "Photo must be under 8MB." }, 400);
  }

  const contestMonth = currentContestMonth();

  const existing = await dbSelect(
    env,
    "contest_entries",
    `email=eq.${encodeURIComponent(email)}&contest_month=eq.${contestMonth}&select=id&limit=1`
  );
  if (existing.length > 0) {
    return jsonResponse({ error: "You've already entered this month's contest with this email." }, 409);
  }

  const ext = photo.type.split("/")[1];
  const storagePath = `contest/${contestMonth}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const photoBuffer = await photo.arrayBuffer();

  // Advisory-only authenticity signal: real camera/phone photos almost
  // always embed EXIF metadata (camera make/model, timestamp, etc.);
  // screenshots and most AI-generated images don't. This never blocks a
  // submission — messaging apps sometimes strip EXIF from genuine
  // photos too — it just flags lower-confidence entries for admin to
  // weigh when reviewing, alongside the AI content evaluation.
  const hasCameraMetadata = bufferHasExifMarker(photoBuffer);

  const upload = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public-uploads/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": photo.type,
    },
    body: photoBuffer,
  });
  if (!upload.ok) {
    console.error("Contest photo upload failed:", upload.status, await upload.text().catch(() => ""));
    return jsonResponse({ error: "Could not upload photo. Please try again." }, 500);
  }
  const photoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/public-uploads/${storagePath}`;

  const row = await dbInsert(env, "contest_entries", [
    {
      contestant_name: name.slice(0, 100),
      email,
      social_username: socialUsername.replace(/^@/, "").slice(0, 60),
      social_platform: socialPlatform,
      post_url: postUrl || null,
      photo_url: photoUrl,
      storage_path: storagePath,
      caption: caption ? caption.slice(0, 500) : null,
      consent_to_repost: true,
      contest_month: contestMonth,
      status: "VALID",
      has_camera_metadata: hasCameraMetadata,
    },
  ]);

  return jsonResponse({ success: true, id: row[0]?.id });
});
