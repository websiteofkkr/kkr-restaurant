(() => {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);
  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Mirrors functions/_shared/admin.js — kept in sync manually since this
  // is just for building the UI buttons; the server re-validates every
  // transition regardless, so a mismatch here fails safely, not silently.
  const PAYMENT_TRANSITIONS = { pending: ["verified", "rejected", "confirmed"], verified: ["rejected"], rejected: ["pending"], confirmed: [] };
  const DELIVERY_TRANSITIONS = { received: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["out_for_delivery", "cancelled"], out_for_delivery: ["delivered"], delivered: [], cancelled: [] };
  const PICKUP_TRANSITIONS = { received: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["picked_up", "cancelled"], picked_up: [], cancelled: [] };

  const authedFetch = (path, opts = {}) => {
    const session = window.KKRAuth.getSession();
    return fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        ...(opts.headers || {}),
      },
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    });
  };

  /* ------------------------------------------------------------- gating */
  const showApp = (show) => {
    $("[data-oa-login]").hidden = show;
    $("[data-oa-app]").hidden = !show;
  };

  const checkAdminAccess = async () => {
    const session = window.KKRAuth.getSession();
    if (!session) {
      showApp(false);
      return;
    }
    await window.KKRAuth.refreshProfile();
    const profile = window.KKRAuth.getSession()?.profile;
    if (!profile?.is_admin) {
      showApp(false);
      $("[data-oa-login-error]").hidden = false;
      $("[data-oa-login-error]").textContent = "This account doesn't have admin access.";
      window.KKRAuth.logout();
      return;
    }
    $("[data-oa-whoami]").textContent = profile.full_name || session.user.email;
    showApp(true);
    loadOrders();
    loadSettings();
  };

  /* -------------------------------------------------------------- tabs */
  $$("[data-oa-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("[data-oa-tab]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const name = btn.dataset.oaTab;
      $$("[data-oa-panel]").forEach((p) => (p.hidden = p.dataset.oaPanel !== name));
    });
  });

  /* ------------------------------------------------------------ orders */
  let ordersCache = [];

  const statusButtons = (order) => {
    const paymentOptions = PAYMENT_TRANSITIONS[order.payment_status] || [];
    const orderMap = order.order_type === "delivery" ? DELIVERY_TRANSITIONS : PICKUP_TRANSITIONS;
    const orderOptions = orderMap[order.order_status] || [];

    const paymentBtns = paymentOptions
      .map((s) => `<button type="button" class="oa-status-btn" data-oa-set-payment="${s}">Mark payment: ${s}</button>`)
      .join("");
    const orderBtns = orderOptions
      .map((s) => `<button type="button" class="oa-status-btn" data-oa-set-order="${s}">Mark order: ${s}</button>`)
      .join("");
    return `<div class="oa-status-actions">${paymentBtns}${orderBtns}</div>`;
  };

  const renderOrders = () => {
    const body = $("[data-oa-orders-body]");
    $("[data-oa-orders-count]").textContent = `${ordersCache.length} order${ordersCache.length === 1 ? "" : "s"}`;
    body.innerHTML = ordersCache
      .map((o) => {
        const itemsList = (o.order_items || [])
          .map((it) => `<li>${it.quantity} × ${esc(it.item_name)}${it.variant_name ? ` (${esc(it.variant_name)})` : ""} — Rs. ${fmt(it.item_total)}</li>`)
          .join("");
        return `
        <tr class="oa-order-row" data-oa-order-id="${o.id}">
          <td><strong>${esc(o.order_number)}</strong></td>
          <td>${esc(o.customer_name)}<br><span class="oa-muted">${esc(o.customer_phone)}</span>
            <br><span class="oa-badge ${o.customer_id ? "oa-badge--registered" : "oa-badge--guest"}">${o.customer_id ? "Registered" : "Guest"}</span>
          </td>
          <td>${o.order_type}</td>
          <td>${esc(o.payment_method)}<br><span class="oa-badge oa-badge--${o.payment_status}">${o.payment_status}</span></td>
          <td><span class="oa-badge oa-badge--${o.order_status}">${o.order_status}</span></td>
          <td>Rs. ${fmt(o.total)}</td>
          <td>${new Date(o.created_at).toLocaleString()}</td>
        </tr>
        <tr class="oa-order-detail" data-oa-order-detail="${o.id}" hidden>
          <td colspan="7">
            <p><strong>Items</strong></p>
            <ul>${itemsList}</ul>
            ${o.customer_address ? `<p><strong>Address:</strong> ${esc(o.customer_address)}</p>` : ""}
            ${o.delivery_lat && o.delivery_lng ? `<p><a href="https://www.google.com/maps?q=${o.delivery_lat},${o.delivery_lng}" target="_blank" rel="noopener">📍 Open exact pinned location in Google Maps</a></p>` : ""}
            ${o.customer_notes ? `<p><strong>Notes:</strong> ${esc(o.customer_notes)}</p>` : ""}
            ${o.payment_reference ? `<p><strong>Payment reference:</strong> ${esc(o.payment_reference)}</p>` : ""}
            ${statusButtons(o)}
          </td>
        </tr>`;
      })
      .join("");
  };

  const loadOrders = async () => {
    try {
      const data = await authedFetch("/api/admin/orders");
      ordersCache = data.orders || [];
      renderOrders();
    } catch (err) {
      alert("Could not load orders: " + err.message);
    }
  };

  $("[data-oa-refresh-orders]").addEventListener("click", loadOrders);

  document.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-oa-order-id]");
    if (row && !e.target.closest("[data-oa-set-payment],[data-oa-set-order]")) {
      const detail = $(`[data-oa-order-detail="${row.dataset.oaOrderId}"]`);
      if (detail) detail.hidden = !detail.hidden;
      return;
    }
    const payBtn = e.target.closest("[data-oa-set-payment]");
    const orderBtn = e.target.closest("[data-oa-set-order]");
    if (payBtn || orderBtn) {
      const orderId = e.target.closest("[data-oa-order-detail]").dataset.oaOrderDetail;
      const body = payBtn ? { orderId, paymentStatus: payBtn.dataset.oaSetPayment } : { orderId, orderStatus: orderBtn.dataset.oaSetOrder };
      try {
        await authedFetch("/api/admin/orders", { method: "PATCH", body: JSON.stringify(body) });
        await loadOrders();
      } catch (err) {
        alert("Could not update order: " + err.message);
      }
    }
  });

  /* ----------------------------------------------------------- rewards */
  let selectedCustomer = null;

  const rewardSearch = $("[data-oa-reward-search]");
  let searchDebounce;
  rewardSearch.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = rewardSearch.value.trim();
    searchDebounce = setTimeout(async () => {
      if (!q) {
        $("[data-oa-reward-results]").innerHTML = "";
        return;
      }
      try {
        const data = await authedFetch(`/api/admin/reward?q=${encodeURIComponent(q)}`);
        $("[data-oa-reward-results]").innerHTML = (data.customers || [])
          .map(
            (c) =>
              `<li class="oa-reward-result" data-oa-customer='${esc(JSON.stringify(c))}'><span>${esc(c.full_name || "—")} · ${esc(c.phone || "")}</span><span>${c.reward_points} pts</span></li>`
          )
          .join("");
      } catch (err) {
        console.error(err);
      }
    }, 300);
  });

  document.addEventListener("click", (e) => {
    const result = e.target.closest("[data-oa-customer]");
    if (!result) return;
    selectedCustomer = JSON.parse(result.dataset.oaCustomer);
    $("[data-oa-reward-form]").hidden = false;
    $("[data-oa-reward-selected-name]").textContent = selectedCustomer.full_name || selectedCustomer.phone;
    $("[data-oa-reward-selected-points]").textContent = selectedCustomer.reward_points;
    $("[data-oa-reward-error]").hidden = true;
    $("[data-oa-reward-success]").hidden = true;
  });

  $("[data-oa-reward-submit]").addEventListener("click", async () => {
    const points = Number($("[data-oa-reward-points]").value);
    const reason = $("[data-oa-reward-reason]").value.trim();
    const errEl = $("[data-oa-reward-error]");
    const okEl = $("[data-oa-reward-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    if (!selectedCustomer) {
      errEl.hidden = false;
      errEl.textContent = "Search for and select a customer first.";
      return;
    }
    if (!Number.isInteger(points) || points === 0 || !reason) {
      errEl.hidden = false;
      errEl.textContent = "Enter a non-zero whole number of points and a reason.";
      return;
    }
    try {
      const data = await authedFetch("/api/admin/reward", {
        method: "POST",
        body: JSON.stringify({ customerId: selectedCustomer.id, points, reason }),
      });
      okEl.hidden = false;
      okEl.textContent = `Done — new balance: ${data.newBalance} points.`;
      $("[data-oa-reward-selected-points]").textContent = data.newBalance;
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  /* ---------------------------------------------------------- settings */
  const loadSettings = async () => {
    try {
      const data = await authedFetch("/api/admin/settings");
      (data.settings || []).forEach((s) => {
        const input = $(`[data-oa-setting="${s.key}"]`);
        if (!input) return;
        if (s.key === "tax_rate") input.value = Number(s.value) * 100;
        else if (s.key === "reward_rate") input.value = Number(s.value) * 100;
        else input.value = s.value;
      });
    } catch (err) {
      console.error(err);
    }
  };

  $("[data-oa-settings-save]").addEventListener("click", async () => {
    const errEl = $("[data-oa-settings-error]");
    const okEl = $("[data-oa-settings-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const keys = ["tax_rate", "delivery_fee", "free_delivery_threshold", "reward_rate"];
    try {
      for (const key of keys) {
        const input = $(`[data-oa-setting="${key}"]`);
        const raw = Number(input.value);
        const value = key === "tax_rate" || key === "reward_rate" ? raw / 100 : raw;
        await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key, value }) });
      }
      okEl.hidden = false;
      okEl.textContent = "Settings saved.";
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  /* --------------------------------------------------------------- auth */
  $("[data-oa-login-submit]").addEventListener("click", async () => {
    const email = $("[data-oa-email]").value.trim();
    const password = $("[data-oa-password]").value;
    const errEl = $("[data-oa-login-error]");
    errEl.hidden = true;
    if (!email || !password) {
      errEl.hidden = false;
      errEl.textContent = "Enter your email and password.";
      return;
    }
    try {
      await window.KKRAuth.login(email, password);
      await checkAdminAccess();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  $("[data-oa-logout]").addEventListener("click", () => {
    window.KKRAuth.logout();
    showApp(false);
  });

  window.addEventListener("DOMContentLoaded", checkAdminAccess);
})();
