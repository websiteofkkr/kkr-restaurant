(() => {
  "use strict";

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const buildMoment = (m) => `<article class="moment">
      <div class="moment__frame">
        <video class="moment__video" ${m.poster_url ? `poster="${escapeHtml(m.poster_url)}"` : ""} src="${escapeHtml(m.video_url)}"
          autoplay muted loop playsinline preload="metadata"
          aria-label="${escapeHtml(m.title)}"></video>
        ${m.duration_label ? `<span class="moment__time">${escapeHtml(m.duration_label)}</span>` : ""}
      </div>
      <h3>${escapeHtml(m.title)}</h3>
      ${m.subtitle ? `<p>${escapeHtml(m.subtitle)}</p>` : ""}
    </article>`;

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;
      const res = await fetch(`${url}/rest/v1/moments?select=*&order=sort_order.asc`, { headers: { apikey: anonKey } });
      const moments = await res.json();
      if (!Array.isArray(moments) || moments.length === 0) return; // no uploads yet — keep the built-in default clips

      const track = document.querySelector(".moments .marquee__track");
      if (!track) return;

      // Same seamless-loop technique already used here: duplicate the set
      // once so the marquee animation (which slides to exactly -50%) has
      // no visible seam when it wraps around.
      const html = moments.map(buildMoment).join("");
      track.innerHTML = html + html;
      track.style.setProperty("--count", String(moments.length * 2));
    } catch {
      // A failed fetch just leaves the existing default clips in place.
    }
  });
})();
