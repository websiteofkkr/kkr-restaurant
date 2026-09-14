(() => {
  "use strict";

  const AUTO_HIDE_SECONDS = 12;

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;
      const res = await fetch(
        `${url}/rest/v1/settings?select=key,value&key=in.(promo_banner_enabled,promo_banner_text,promo_banner_link,promo_banner_image,promo_banner_start,promo_banner_end)`,
        { headers: { apikey: anonKey } }
      );
      const rows = await res.json();
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const enabled = map.promo_banner_enabled === true || map.promo_banner_enabled === "true";
      const text = (map.promo_banner_text || "").trim();
      const image = (map.promo_banner_image || "").trim();
      if (!enabled || (!text && !image)) return;

      // Optional scheduling window — if either bound is set and now falls
      // outside it, the banner simply doesn't show. Blank bounds are
      // treated as "no limit" on that side.
      const now = Date.now();
      const startAt = (map.promo_banner_start || "").trim();
      const endAt = (map.promo_banner_end || "").trim();
      if (startAt && now < new Date(startAt).getTime()) return;
      if (endAt && now > new Date(endAt).getTime()) return;

      // Dismissing only hides it for the current page view — reloading
      // or visiting another page shows it again. No persistence by
      // design: this is meant to run for as long as it's turned on, and
      // an old test-dismissal should never be the reason it looks "stuck
      // off" on a later visit.
      const link = (map.promo_banner_link || "").trim();

      const bar = document.createElement(link ? "a" : "div");
      bar.className = "promo-card";
      if (link) bar.href = link;

      if (image) {
        const img = document.createElement("img");
        img.src = image;
        img.alt = text || "";
        bar.appendChild(img);
      } else {
        const span = document.createElement("span");
        span.className = "promo-card__text";
        span.textContent = text;
        bar.appendChild(span);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "promo-card__close";
      closeBtn.setAttribute("aria-label", "Dismiss");
      closeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      const remove = () => {
        wrap.remove();
      };
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        remove();
      });
      bar.appendChild(closeBtn);

      const wrap = document.createElement("div");
      wrap.className = "promo-card__wrap";
      wrap.appendChild(bar);

      document.body.insertBefore(wrap, document.body.firstChild);

      // Auto-closes on its own after a while if nobody dismisses it —
      // stays up long enough to read/act on, then gets out of the way.
      setTimeout(remove, AUTO_HIDE_SECONDS * 1000);
    } catch {
      // A failed fetch just means no banner shows — nothing else breaks.
    }
  });
})();
