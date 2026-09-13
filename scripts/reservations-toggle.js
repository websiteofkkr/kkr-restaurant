(() => {
  "use strict";

  window.addEventListener("DOMContentLoaded", async () => {
    const form = document.querySelector('[data-form="reservation"]');
    if (!form) return; // not a reservation page — nothing to do

    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      const res = await fetch(`${url}/rest/v1/settings?key=eq.reservations_enabled&select=value`, {
        headers: { apikey: anonKey },
      });
      const rows = await res.json();
      const enabled = rows[0]?.value !== false && rows[0]?.value !== "false";
      if (!enabled) {
        const banner = document.querySelector("[data-reservations-disabled]");
        if (banner) banner.hidden = false;
        form.hidden = true;
      }
    } catch {
      // If this check fails, leave the form visible — reservations
      // degrade to "on" rather than silently vanishing on a network hiccup.
    }
  });
})();
