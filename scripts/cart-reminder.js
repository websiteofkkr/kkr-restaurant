(() => {
  "use strict";

  // Not useful on the checkout page itself (they're already there) or on
  // the read-only digital menu (no cart at all there).
  if (document.body.classList.contains("page-checkout") || !document.querySelector("[data-cart-toggle]")) return;

  const SEEN_KEY = "kkr-cart-reminder-seen";

  window.addEventListener("DOMContentLoaded", () => {
    if (!window.KKRCart) return;

    // Once per page load only — reappearing on every click within the
    // same page would be irritating, not helpful.
    if (sessionStorage.getItem(SEEN_KEY) === "1") return;

    setTimeout(() => {
      const items = window.KKRCart.getItems();
      if (!items.length) return;

      const count = items.reduce((sum, it) => sum + (it.quantity || 1), 0);
      sessionStorage.setItem(SEEN_KEY, "1");

      const toast = document.createElement("div");
      toast.className = "cart-reminder";
      toast.innerHTML = `
        <span class="cart-reminder__text">${count === 1 ? "1 item is" : count + " items are"} still waiting in your cart.</span>
        <button type="button" class="cart-reminder__view">View cart</button>
        <button type="button" class="cart-reminder__close" aria-label="Dismiss">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      `;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("is-shown"));

      const remove = () => {
        toast.classList.remove("is-shown");
        setTimeout(() => toast.remove(), 300);
      };
      toast.querySelector(".cart-reminder__close").addEventListener("click", remove);
      toast.querySelector(".cart-reminder__view").addEventListener("click", () => {
        remove();
        document.querySelector("[data-cart-toggle]")?.click();
      });

      // Doesn't linger forever if ignored.
      setTimeout(remove, 12000);
    }, 4000);
  });
})();
