(() => {
  "use strict";

  const DISMISS_KEY = "kkr-promo-banner-dismissed";
  const DISMISS_HOURS = 6;

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

      // Dismissing only lasts a few hours (not "forever in this tab") —
      // both so a real visitor isn't shown the exact same promo every
      // single page load, and so it re-appears the next time you check
      // rather than looking "stuck off" after one earlier test dismissal.
      const dismissKey = image || text;
      let dismissed = null;
      try {
        dismissed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "null");
      } catch {
        /* ignore */
      }
      const stillDismissed =
        dismissed && dismissed.key === dismissKey && Date.now() - dismissed.at < DISMISS_HOURS * 60 * 60 * 1000;
      if (stillDismissed) return;

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
      const dismiss = () => {
        bar.remove();
        try {
          localStorage.setItem(DISMISS_KEY, JSON.stringify({ key: dismissKey, at: Date.now() }));
        } catch {
          /* non-fatal */
        }
      };
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      });
      bar.appendChild(closeBtn);

      const wrap = document.createElement("div");
      wrap.className = "promo-card__wrap";
      wrap.appendChild(bar);

      const header = document.querySelector(".masthead");
      if (header && header.nextSibling) {
        header.parentNode.insertBefore(wrap, header.nextSibling);
      } else {
        document.body.insertBefore(wrap, document.body.firstChild);
      }
    } catch {
      // A failed fetch just means no banner shows — nothing else breaks.
    }
  });
})();

