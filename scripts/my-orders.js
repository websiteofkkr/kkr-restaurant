(() => {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);
  const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const DELIVERY_STEPS = ["received", "confirmed", "preparing", "ready", "out_for_delivery", "delivered"];
  const PICKUP_STEPS = ["received", "confirmed", "preparing", "ready", "picked_up"];

  const statusLabel = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const renderProgress = (order) => {
    if (order.order_status === "cancelled") {
      return `<div class="mo-progress"><div class="mo-progress__step is-cancelled"></div></div>`;
    }
    const steps = order.order_type === "delivery" ? DELIVERY_STEPS : PICKUP_STEPS;
    const currentIdx = steps.indexOf(order.order_status);
    return `<div class="mo-progress">${steps
      .map((_, i) => `<div class="mo-progress__step ${i <= currentIdx ? "is-done" : ""}"></div>`)
      .join("")}</div>`;
  };

  const renderOrder = (order) => {
    const itemsHtml = (order.order_items || [])
      .map(
        (it) =>
          `<li class="mo-card__item"><span>${it.quantity} × ${esc(it.item_name)}${it.variant_name ? ` (${esc(it.variant_name)})` : ""}</span><span>Rs. ${fmt(it.item_total)}</span></li>`
      )
      .join("");

    return `
      <article class="mo-card">
        <div class="mo-card__head">
          <div>
            <p class="mo-card__number">${esc(order.order_number)}</p>
            <p class="mo-card__date">${new Date(order.created_at).toLocaleString()}</p>
          </div>
          <div class="mo-card__badges">
            <span class="mo-badge mo-badge--${order.payment_status}">${statusLabel(order.payment_status)} payment</span>
            <span class="mo-badge mo-badge--${order.order_status}">${statusLabel(order.order_status)}</span>
          </div>
        </div>
        ${renderProgress(order)}
        <ul class="mo-card__items">${itemsHtml}</ul>
        <div class="mo-card__foot">
          <span>${order.order_type === "delivery" ? "Delivery" : "Pickup"} · ${esc(order.payment_method)}</span>
          <span class="mo-card__total">Rs. ${fmt(order.total)}</span>
        </div>
        ${order.customer_notes ? `<p class="mo-card__meta"><strong>Notes:</strong> ${esc(order.customer_notes)}</p>` : ""}
      </article>`;
  };

  const loadOrders = async () => {
    const session = window.KKRAuth?.getSession();
    const loggedOut = $("[data-mo-logged-out]");
    const empty = $("[data-mo-empty]");
    const list = $("[data-mo-list]");

    if (!session) {
      loggedOut.hidden = false;
      empty.hidden = true;
      list.hidden = true;
      return;
    }
    loggedOut.hidden = true;

    try {
      const res = await fetch("/api/my-orders", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load orders.");

      const orders = data.orders || [];
      if (orders.length === 0) {
        empty.hidden = false;
        list.hidden = true;
        return;
      }
      empty.hidden = true;
      list.hidden = false;
      list.innerHTML = orders.map(renderOrder).join("");
    } catch (err) {
      empty.hidden = false;
      empty.querySelector(".checkout__empty-title").textContent = "Could not load your orders.";
      empty.querySelector("p:nth-of-type(2)").textContent = err.message;
    }
  };

  if (window.KKRAuth) window.KKRAuth.onChange(loadOrders);
  window.addEventListener("DOMContentLoaded", loadOrders);
})();
