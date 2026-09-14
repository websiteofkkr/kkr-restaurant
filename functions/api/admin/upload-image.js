import { jsonResponse, withErrorHandling } from "../../_shared/supabase.js";
import { requireAdmin } from "../../_shared/admin.js";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** POST /api/admin/upload-image — multipart/form-data with a "file" field.
 *  Uploads to the public-uploads Supabase Storage bucket and returns the
 *  public URL. Used by the promo banner (and anything else that needs an
 *  admin-uploaded image) rather than routing through Decap CMS/GitHub. */
export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "Expected multipart/form-data with a file." }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return jsonResponse({ error: "No file provided." }, 400);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonResponse({ error: "Only JPEG, PNG, WEBP, or GIF images are allowed." }, 400);
  }
  if (file.size > MAX_BYTES) {
    return jsonResponse({ error: "Image must be under 5MB." }, 400);
  }

  const ext = file.type.split("/")[1];
  const path = `promo/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public-uploads/${path}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.type,
    },
    body: await file.arrayBuffer(),
  });

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => "");
    console.error("Storage upload failed:", uploadRes.status, detail);
    return jsonResponse({ error: "Could not upload image." }, 500);
  }

  const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/public-uploads/${path}`;
  return jsonResponse({ url: publicUrl });
});
