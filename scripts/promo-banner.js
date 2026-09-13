(() => {
  "use strict";

  const DISMISS_KEY = "kkr-promo-banner-dismissed";

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;
      const res = await fetch(
        `${url}/rest/v1/settings?select=key,value&key=in.(promo_banner_enabled,promo_banner_text,promo_banner_link)`,
        { headers: { apikey: anonKey } }
      );
      const rows = await res.json();
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const enabled = map.promo_banner_enabled === true || map.promo_banner_enabled === "true";
      const text = (map.promo_banner_text || "").trim();
      if (!enabled || !text) return;

      // Dismissing is remembered per-message: a new/changed message shows
      // again even if an earlier one was closed.
      const dismissedText = sessionStorage.getItem(DISMISS_KEY);
      if (dismissedText === text) return;

      const link = (map.promo_banner_link || "").trim();
      const bar = document.createElement(link ? "a" : "div");
      bar.className = "promo-topbar";
      if (link) bar.href = link;

      const span = document.createElement("span");
      span.className = "promo-topbar__text";
      span.textContent = text;
      bar.appendChild(span);

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
        document.documentElement.classList.remove("has-promo-topbar");
        document.documentElement.style.setProperty("--promo-banner-h", "0px");
        try {
          sessionStorage.setItem(DISMISS_KEY, text);
        } catch {
          /* non-fatal */
        }
      });
      bar.appendChild(closeBtn);

      document.body.insertBefore(bar, document.body.firstChild);
      document.documentElement.classList.add("has-promo-topbar");
      // Measured after insertion so this works for any text length/wrap —
      // pushes the fixed header (and page content) down to make room.
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--promo-banner-h", bar.offsetHeight + "px");
      });
    } catch {
      // A failed fetch just means no banner shows — nothing else breaks.
    }
  });
})();
