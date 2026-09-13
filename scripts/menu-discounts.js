(() => {
  "use strict";

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      const res = await fetch(
        `${url}/rest/v1/menu_item_discounts?select=item_id,discounted_price,badge_label&variant_id=eq.&active=eq.true`,
        { headers: { apikey: anonKey } }
      );
      const discounts = await res.json();
      if (!Array.isArray(discounts) || discounts.length === 0) return;

      discounts.forEach((d) => {
        const wrap = document.querySelector(`.cart-add[data-item-id="${CSS.escape(d.item_id)}"]`);
        if (!wrap) return;
        // Only plain (non-variant) items are supported today — a variant
        // item has a <select>, a plain item has a single hidden input.
        const tierInput = wrap.querySelector('input.cart-add__tier[type="hidden"]');
        if (!tierInput) return;

        const originalPrice = Number(tierInput.value);
        const discountedPrice = Number(d.discounted_price);
        if (!(discountedPrice > 0) || !(discountedPrice < originalPrice)) return;

        tierInput.value = discountedPrice;

        const priceEl = wrap.closest(".mitem")?.querySelector(".mitem__price");
        if (priceEl) {
          priceEl.innerHTML =
            `<s>${originalPrice}</s> ${discountedPrice}` +
            (d.badge_label ? ` <span class="mitem__badge">${escapeHtml(d.badge_label)}</span>` : "");
        }
      });
    } catch {
      // If this fails, items just show their normal price — nothing breaks.
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
