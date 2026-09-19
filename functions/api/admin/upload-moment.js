import { dbInsert, jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

// Short clips only
const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30MB
const MAX_POSTER_BYTES = 2 * 1024 * 1024; // 2MB

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime"
];

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let form;

  try {
    form = await request.formData();
  } catch {
    return jsonResponse(
      { error: "Expected multipart/form-data." },
      400
    );
  }

  const title = String(form.get("title") || "").trim();
  const subtitle = String(form.get("subtitle") || "").trim();
  const durationLabel = String(form.get("durationLabel") || "").trim();

  const video = form.get("video");
  const poster = form.get("poster");

  // -----------------------------
  // Validate title
  // -----------------------------
  if (!title) {
    return jsonResponse(
      { error: "Title is required." },
      400
    );
  }

  // -----------------------------
  // Validate video
  // -----------------------------
  if (!video || typeof video === "string") {
    return jsonResponse(
      { error: "A video file is required." },
      400
    );
  }

  if (!ALLOWED_VIDEO_TYPES.includes(video.type)) {
    return jsonResponse(
      { error: "Video must be MP4, WebM, or MOV." },
      400
    );
  }

  if (video.size > MAX_VIDEO_BYTES) {
    return jsonResponse(
      {
        error: `Video must be under ${
          MAX_VIDEO_BYTES / 1024 / 1024
        }MB — please trim or compress it first.`
      },
      400
    );
  }

  // -----------------------------
  // Validate poster
  // -----------------------------
  if (poster && typeof poster !== "string") {
    if (!ALLOWED_IMAGE_TYPES.includes(poster.type)) {
      return jsonResponse(
        { error: "Poster image must be JPEG, PNG, or WEBP." },
        400
      );
    }

    if (poster.size > MAX_POSTER_BYTES) {
      return jsonResponse(
        { error: "Poster image must be under 2MB." },
        400
      );
    }
  }

  // -----------------------------
  // Create unique file names
  // -----------------------------
  const stamp = Date.now();
  const uid = crypto.randomUUID();

  const videoType = video.type.split("/")[1];
  const videoExt =
    videoType === "quicktime" ? "mov" : videoType;

  const videoPath =
    `moments/${stamp}-${uid}.${videoExt}`;

  try {
    // -----------------------------
    // Upload video
    // -----------------------------
    const videoUpload = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/public-uploads/${videoPath}`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": video.type,
        },
        body: video,
      }
    );

    if (!videoUpload.ok) {
      const detail = await videoUpload
        .text()
        .catch(() => "");

      console.error(
        "Moment video upload failed:",
        videoUpload.status,
        detail
      );

      return jsonResponse(
        {
          error: `Could not upload video (storage said: ${
            detail || videoUpload.status
          }).`
        },
        500
      );
    }

    // -----------------------------
    // Upload poster
    // -----------------------------
    let posterUrl = null;

    if (poster && typeof poster !== "string") {
      const posterExt = poster.type.split("/")[1];

      const posterPath =
        `moments/${stamp}-${uid}-poster.${posterExt}`;

      const posterUpload = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/public-uploads/${posterPath}`,
        {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": poster.type,
          },
          body: poster,
        }
      );

      if (posterUpload.ok) {
        posterUrl =
          `${env.SUPABASE_URL}/storage/v1/object/public/public-uploads/${posterPath}`;
      }

      // Poster failure is not fatal.
    }

    // -----------------------------
    // Video public URL
    // -----------------------------
    const videoUrl =
      `${env.SUPABASE_URL}/storage/v1/object/public/public-uploads/${videoPath}`;

    // -----------------------------
    // Insert into moments table
    // -----------------------------
    const row = await dbInsert(env, "moments", [
      {
        title,
        subtitle: subtitle || null,
        video_url: videoUrl,
        poster_url: posterUrl,
        storage_path: videoPath,
        duration_label: durationLabel || null,

        // IMPORTANT:
        // sort_order is INTEGER in Supabase.
        // Do NOT use Date.now() here.
        sort_order: 0,

        file_size_bytes: video.size,
      },
    ]);

    return jsonResponse({
      moment: row[0]
    });

  } catch (err) {
    console.error(
      "Moment upload threw:",
      err
    );

    return jsonResponse(
      {
        error: `Upload failed: ${
          err?.message || String(err)
        }`
      },
      500
    );
  }
});
