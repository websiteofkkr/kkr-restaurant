(() => {
  "use strict";

  // ---- adjustable timing -----------------------------------------------
  // How long each group of videos stays on screen before auto-advancing,
  // in milliseconds. Change this one number to speed up or slow down the
  // rotation (5000 = 5 seconds).
  const AUTO_ADVANCE_MS = 5000;
  // -------------------------------------------------------------------

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

  const getItemsPerPage = () => {
    const w = window.innerWidth;
    if (w <= 480) return 1;
    if (w <= 1024) return 2;
    return 4;
  };

  let carouselInstance = null;

  const initCarousel = () => {
    const carousel = document.querySelector("[data-moments-carousel]");
    if (!carousel) return;
    const viewport = carousel.querySelector("[data-moments-viewport]");
    const track = carousel.querySelector("[data-moments-track]");
    const dotsWrap = document.querySelector("[data-moments-dots]");
    if (!viewport || !track) return;

    carouselInstance = window.KKRCarousel.create({
      root: carousel,
      viewport,
      track,
      dotsWrap,
      itemSelector: ".moment:not(.moment--spacer)",
      spacerClass: "moment moment--spacer",
      getItemsPerPage,
      autoAdvanceMs: AUTO_ADVANCE_MS,
    });
  };

  window.addEventListener("DOMContentLoaded", initCarousel);

  // ------------------------------------------------- optional live data
  // If real moments have been uploaded via the admin dashboard, swap them
  // in for the built-in default clips.
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;
      const res = await fetch(`${url}/rest/v1/moments?select=*&order=sort_order.asc`, { headers: { apikey: anonKey } });
      const moments = await res.json();
      if (!Array.isArray(moments) || moments.length === 0) return;

      carouselInstance?.setItems(moments.map(buildMoment));
    } catch {
      // A failed fetch just leaves the existing default clips in place.
    }
  });
})();
