(() => {
  "use strict";

  const DISMISS_KEY = "kkr-promo-banner-dismissed";

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;
      const res = await fetch(
        `${url}/rest/v1/settings?select=key,value&key=in.(promo_banner_enabled,promo_banner_text,promo_banner_link,promo_banner_image)`,
        { headers: { apikey: anonKey } }
      );
      const rows = await res.json();
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const enabled = map.promo_banner_enabled === true || map.promo_banner_enabled === "true";
      const text = (map.promo_banner_text || "").trim();
      const image = (map.promo_banner_image || "").trim();
      if (!enabled || (!text && !image)) return;

      // Dismissing is remembered per-message/image: a new/changed banner
      // shows again even if an earlier one was closed.
      const dismissKey = image || text;
      const dismissedKey = sessionStorage.getItem(DISMISS_KEY);
      if (dismissedKey === dismissKey) return;

      const link = (map.promo_banner_link || "").trim();
      const bar = document.createElement(link ? "a" : "div");
      bar.className = "promo-topbar";
      if (link) bar.href = link;

      if (image) {
        bar.classList.add("promo-topbar--image");
        const img = document.createElement("img");
        img.src = image;
        img.alt = text || "";
        bar.appendChild(img);
      } else {
        const span = document.createElement("span");
        span.className = "promo-topbar__text";
        span.textContent = text;
        bar.appendChild(span);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "promo-topbar__close";
      closeBtn.setAttribute("aria-label", "Dismiss");
      closeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        bar.remove();
        document.documentElement.style.setProperty("--promo-banner-h", "0px");
        try {
          sessionStorage.setItem(DISMISS_KEY, dismissKey);
        } catch {
          /* non-fatal */
        }
      });
      bar.appendChild(closeBtn);

      document.body.insertBefore(bar, document.body.firstChild);
      // Measured after insertion so this works for any text length/wrap —
      // pushes the fixed header (and page content) down to make room,
      // since the banner is also fixed and would otherwise sit underneath it.
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--promo-banner-h", bar.offsetHeight + "px");
      });
    } catch {
      // A failed fetch just means no banner shows — nothing else breaks.
    }
  });
})();
