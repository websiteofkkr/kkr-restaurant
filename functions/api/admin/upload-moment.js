import { dbInsert, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

// Short clips only — this is a small marketing reel, not a video host.
// Kept deliberately tight since Supabase Storage's free tier is limited,
// and it's easy for a "short video" to balloon to 50-100MB if someone
// uploads an un-compressed phone recording.
const MAX_VIDEO_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_POSTER_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "Expected multipart/form-data." }, 400);
  }

  const title = String(form.get("title") || "").trim();
  const subtitle = String(form.get("subtitle") || "").trim();
  const durationLabel = String(form.get("durationLabel") || "").trim();
  const video = form.get("video");
  const poster = form.get("poster");

  if (!title) return jsonResponse({ error: "Title is required." }, 400);
  if (!video || typeof video === "string") return jsonResponse({ error: "A video file is required." }, 400);
  if (!ALLOWED_VIDEO_TYPES.includes(video.type)) {
    return jsonResponse({ error: "Video must be MP4, WebM, or MOV." }, 400);
  }
  if (video.size > MAX_VIDEO_BYTES) {
    return jsonResponse({ error: `Video must be under ${MAX_VIDEO_BYTES / 1024 / 1024}MB — please trim or compress it first.` }, 400);
  }
  if (poster && typeof poster !== "string") {
    if (!ALLOWED_IMAGE_TYPES.includes(poster.type)) {
      return jsonResponse({ error: "Poster image must be JPEG, PNG, or WEBP." }, 400);
    }
    if (poster.size > MAX_POSTER_BYTES) {
      return jsonResponse({ error: "Poster image must be under 2MB." }, 400);
    }
  }

  const stamp = Date.now();
  const uid = crypto.randomUUID();
  const videoExt = video.type.split("/")[1] === "quicktime" ? "mov" : video.type.split("/")[1];
  const videoPath = `moments/${stamp}-${uid}.${videoExt}`;

  const videoUpload = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public-uploads/${videoPath}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": video.type,
    },
    body: await video.arrayBuffer(),
  });
  if (!videoUpload.ok) {
    console.error("Moment video upload failed:", videoUpload.status, await videoUpload.text().catch(() => ""));
    return jsonResponse({ error: "Could not upload video." }, 500);
  }

  let posterUrl = null;
  if (poster && typeof poster !== "string") {
    const posterExt = poster.type.split("/")[1];
    const posterPath = `moments/${stamp}-${uid}-poster.${posterExt}`;
    const posterUpload = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public-uploads/${posterPath}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": poster.type,
      },
      body: await poster.arrayBuffer(),
    });
    if (posterUpload.ok) {
      posterUrl = `${env.SUPABASE_URL}/storage/v1/object/public/public-uploads/${posterPath}`;
    }
    // A failed poster upload isn't fatal — the video plays fine without
    // one, just falls back to the browser's own first-frame preview.
  }

  const videoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/public-uploads/${videoPath}`;

  const row = await dbInsert(env, "moments", [
    {
      title,
      subtitle: subtitle || null,
      video_url: videoUrl,
      poster_url: posterUrl,
      storage_path: videoPath,
      duration_label: durationLabel || null,
      sort_order: Date.now(),
      file_size_bytes: video.size,
    },
  ]);

  return jsonResponse({ moment: row[0] });
});
