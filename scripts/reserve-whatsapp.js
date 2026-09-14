(() => {
  "use strict";

  const WHATSAPP_NUMBER = "923355850009";

  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.querySelector("[data-reserve-whatsapp]");
    const form = document.querySelector('[data-form="reservation"]');
    if (!btn || !form) return;

    btn.addEventListener("click", () => {
      // Reuses the form's own required-field rules (name, phone, date,
      // time, guests, occasion) and shows the browser's normal validation
      // UI if something's missing — same fields as the email reservation,
      // so nothing is quietly skipped just because WhatsApp was chosen
      // instead.
      if (!form.reportValidity()) return;

      const get = (name) => (form.querySelector(`[name="${name}"]`)?.value || "").trim();
      const name = get("name");
      const phone = get("phone");
      const email = get("email");
      const date = get("date");
      const time = get("time");
      const guests = get("guests");
      const type = get("type");
      const notes = get("notes");

      const lines = [
        "New table reservation request",
        "",
        `Name: ${name}`,
        `Phone: ${phone}`,
      ];
      if (email) lines.push(`Email: ${email}`);
      lines.push(`Date: ${date}`, `Time: ${time}`, `Guests: ${guests}`, `Occasion: ${type}`);
      if (notes) lines.push(`Notes: ${notes}`);

      const message = lines.join("\n");
      const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank", "noopener");
    });
  });
})();
