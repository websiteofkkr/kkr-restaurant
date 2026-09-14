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
      if (name === "discounts") renderDiscountList();
      if (name === "coupons") renderCouponList();
    });
  });

  /* ------------------------------------------------------------ orders */
  let ordersCache = [];

  const DELIVERY_STEPS = ["received", "confirmed", "preparing", "ready", "out_for_delivery", "delivered"];
  const PICKUP_STEPS = ["received", "confirmed", "preparing", "ready", "picked_up"];
  const STATUS_LABELS = {
    received: "Received", confirmed: "Confirmed", preparing: "Preparing",
    ready: "Ready", out_for_delivery: "Out for delivery", delivered: "Delivered",
    picked_up: "Picked up", cancelled: "Cancelled",
    pending: "Pending", verified: "Verified", rejected: "Rejected",
  };
  const label = (s) => STATUS_LABELS[s] || s;

  const renderPipeline = (order) => {
    if (order.order_status === "cancelled") {
      return `<div class="oa-pipeline"><span class="oa-pipeline__cancelled">Cancelled</span></div>`;
    }
    const steps = order.order_type === "delivery" ? DELIVERY_STEPS : PICKUP_STEPS;
    const currentIdx = steps.indexOf(order.order_status);
    return `<div class="oa-pipeline">${steps
      .map(
        (s, i) =>
          `<span class="oa-pipeline__step ${i <= currentIdx ? "is-done" : ""} ${i === currentIdx ? "is-current" : ""}">${label(s)}</span>`
      )
      .join('<span class="oa-pipeline__arrow">&rarr;</span>')}</div>`;
  };

  const statusButtons = (order) => {
    const paymentOptions = PAYMENT_TRANSITIONS[order.payment_status] || [];
    const orderMap = order.order_type === "delivery" ? DELIVERY_TRANSITIONS : PICKUP_TRANSITIONS;
    const orderOptions = orderMap[order.order_status] || [];

    const paymentBtns = paymentOptions
      .map((s) => `<button type="button" class="oa-status-btn" data-oa-set-payment="${s}">Mark payment ${label(s)}</button>`)
      .join("");
    const orderBtns = orderOptions
      .map((s) => `<button type="button" class="oa-status-btn oa-status-btn--primary" data-oa-set-order="${s}">${s === "cancelled" ? "Cancel order" : "Move to: " + label(s)}</button>`)
      .join("");
    return `${renderPipeline(order)}<div class="oa-status-actions">${paymentBtns}${orderBtns}</div>`;
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
          <td>${esc(o.payment_method)}<br><span class="oa-badge oa-badge--${o.payment_status}">${label(o.payment_status)}</span></td>
          <td><span class="oa-badge oa-badge--${o.order_status}">${label(o.order_status)}</span></td>
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
        const numericInput = $(`[data-oa-setting="${s.key}"]`);
        if (numericInput) {
          if (s.key === "tax_rate") numericInput.value = Number(s.value) * 100;
          else if (s.key === "reward_rate") numericInput.value = Number(s.value) * 100;
          else numericInput.value = s.value;
          return;
        }
        const toggleInput = $(`[data-oa-feature="${s.key}"]`);
        if (toggleInput) {
          toggleInput.checked = s.value === true || s.value === "true";
          return;
        }
        const textInput = $(`[data-oa-setting-text="${s.key}"]`);
        if (textInput) {
          textInput.value = s.value ?? "";
          return;
        }
        if (s.key === "promo_banner_image" && s.value) renderPromoImagePreview(s.value);
      });
    } catch (err) {
      console.error(err);
    }
  };

  document.addEventListener("change", async (e) => {
    const toggle = e.target.closest("[data-oa-feature]");
    if (!toggle) return;
    const errEl = $("[data-oa-features-error]");
    const okEl = $("[data-oa-features-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const key = toggle.dataset.oaFeature;
    const value = toggle.checked;
    try {
      await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key, value }) });
      okEl.hidden = false;
      okEl.textContent = "Saved — takes effect immediately for customers.";
    } catch (err) {
      toggle.checked = !value; // revert the visual toggle if the save failed
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  $("[data-oa-settings-save]").addEventListener("click", async () => {
    const errEl = $("[data-oa-settings-error]");
    const okEl = $("[data-oa-settings-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const keys = ["tax_rate", "delivery_fee", "free_delivery_threshold", "reward_rate"];
    const textKeys = ["easypaisa_number"];
    try {
      for (const key of keys) {
        const input = $(`[data-oa-setting="${key}"]`);
        const raw = Number(input.value);
        const value = key === "tax_rate" || key === "reward_rate" ? raw / 100 : raw;
        await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key, value }) });
      }
      for (const key of textKeys) {
        const input = $(`[data-oa-setting-text="${key}"]`);
        if (!input) continue;
        await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key, value: input.value.trim() }) });
      }
      okEl.hidden = false;
      okEl.textContent = "Settings saved.";
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  const renderPromoImagePreview = (url) => {
    const el = $("[data-oa-promo-image-preview]");
    if (!el) return;
    if (!url) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<img src="${esc(url)}" alt="" style="max-width:240px;max-height:120px;border-radius:8px;display:block;margin-block-end:.5rem;">
      <button type="button" class="cart-drawer__back" data-oa-promo-image-remove>Remove image</button>`;
  };

  $("[data-oa-promo-image-file]")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const errEl = $("[data-oa-promo-image-error]");
    errEl.hidden = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const session = window.KKRAuth?.getSession();
      const res = await fetch("/api/admin/upload-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key: "promo_banner_image", value: data.url }) });
      renderPromoImagePreview(data.url);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-oa-promo-image-remove]")) {
      try {
        await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key: "promo_banner_image", value: "" }) });
        renderPromoImagePreview("");
      } catch (err) {
        console.error(err);
      }
    }
  });

  $("[data-oa-promo-save]")?.addEventListener("click", async () => {
    const errEl = $("[data-oa-features-error]");
    const okEl = $("[data-oa-features-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    try {
      for (const key of ["promo_banner_text", "promo_banner_link", "promo_banner_start", "promo_banner_end"]) {
        const input = $(`[data-oa-setting-text="${key}"]`);
        if (!input) continue;
        await authedFetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key, value: input.value.trim() }) });
      }
      okEl.hidden = false;
      okEl.textContent = "Banner text saved.";
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  /* --------------------------------------------------------- discounts */
  let MENU_ITEMS_FLAT = [];
  let selectedDiscountItemId = null;
  let selectedDiscountOriginalPrice = null;

  const loadMenuItemsFlat = async () => {
    if (MENU_ITEMS_FLAT.length) return MENU_ITEMS_FLAT;
    try {
      const res = await fetch("/menu.json");
      const menu = await res.json();
      MENU_ITEMS_FLAT = (menu.categories || []).flatMap((cat) =>
        (cat.items || [])
          .filter((it) => !Array.isArray(it.variants) || it.variants.length === 0)
          .map((it) => ({ id: it.id, name: it.name, price: it.price, category: cat.name }))
      );
    } catch (err) {
      console.error(err);
    }
    return MENU_ITEMS_FLAT;
  };

  const renderDiscountSearchResults = async (query) => {
    const resultsEl = $("[data-oa-discount-results]");
    if (!query.trim()) {
      resultsEl.innerHTML = "";
      return;
    }
    const items = await loadMenuItemsFlat();
    const q = query.trim().toLowerCase();
    const matches = items.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 8);
    resultsEl.innerHTML = matches
      .map(
        (it) =>
          `<div class="oa-customer-result" data-oa-discount-pick="${esc(it.id)}" style="cursor:pointer;padding:.6rem .8rem;border:1px solid rgba(128,97,38,.18);border-radius:8px;margin-block-end:.4rem;">
            <strong>${esc(it.name)}</strong> — Rs. ${it.price} <span class="oa-muted">(${esc(it.category)})</span>
          </div>`
      )
      .join("");
  };

  const selectDiscountItem = async (itemId) => {
    const items = await loadMenuItemsFlat();
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    selectedDiscountItemId = itemId;
    selectedDiscountOriginalPrice = item.price;
    $("[data-oa-discount-form]").hidden = false;
    $("[data-oa-discount-item-name]").textContent = item.name;
    $("[data-oa-discount-item-original]").textContent = `(current price: Rs. ${item.price})`;
    $("[data-oa-discount-percent]").value = "";
    $("[data-oa-discount-price]").value = "";
    $("[data-oa-discount-badge]").value = "";
    $("[data-oa-discount-remove]").hidden = true;
    $("[data-oa-discount-error]").hidden = true;
    $("[data-oa-discount-success]").hidden = true;

    try {
      const data = await authedFetch("/api/admin/menu-discounts");
      const existing = (data.discounts || []).find((d) => d.item_id === itemId);
      if (existing) {
        $("[data-oa-discount-price]").value = existing.discounted_price;
        $("[data-oa-discount-badge]").value = existing.badge_label || "";
        $("[data-oa-discount-remove]").hidden = false;
      }
    } catch (err) {
      console.error(err);
    }
  };

  const renderDiscountList = async () => {
    const listEl = $("[data-oa-discount-list]");
    try {
      const data = await authedFetch("/api/admin/menu-discounts");
      const active = (data.discounts || []).filter((d) => d.active);
      if (active.length === 0) {
        listEl.innerHTML = `<p class="oa-muted">No active discounts.</p>`;
        return;
      }
      const items = await loadMenuItemsFlat();
      listEl.innerHTML = active
        .map((d) => {
          const item = items.find((it) => it.id === d.item_id);
          return `<div class="oa-toggle-row">
            <span>
              <strong>${esc(item?.name || d.item_id)}</strong>
              <small>Rs. ${item?.price ?? "?"} &rarr; Rs. ${d.discounted_price}${d.badge_label ? " · " + esc(d.badge_label) : ""}</small>
            </span>
            <button type="button" class="cart-drawer__back" data-oa-discount-quick-remove="${esc(d.item_id)}">Remove</button>
          </div>`;
        })
        .join("");
    } catch (err) {
      listEl.innerHTML = `<p class="oa-muted">Could not load discounts.</p>`;
    }
  };

  $("[data-oa-discount-percent]")?.addEventListener("input", (e) => {
    const percent = Number(e.target.value);
    if (!selectedDiscountOriginalPrice || !Number.isFinite(percent) || percent <= 0 || percent >= 100) return;
    const newPrice = Math.round(selectedDiscountOriginalPrice * (1 - percent / 100));
    $("[data-oa-discount-price]").value = newPrice;
    const badgeInput = $("[data-oa-discount-badge]");
    if (!badgeInput.value.trim() || /^\d+% off$/i.test(badgeInput.value.trim())) {
      badgeInput.value = `${percent}% off`;
    }
  });

  $("[data-oa-discount-search]")?.addEventListener("input", (e) => renderDiscountSearchResults(e.target.value));

  document.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-oa-discount-pick]");
    if (pick) {
      selectDiscountItem(pick.dataset.oaDiscountPick);
      $("[data-oa-discount-results]").innerHTML = "";
      $("[data-oa-discount-search]").value = "";
      return;
    }
    const quickRemove = e.target.closest("[data-oa-discount-quick-remove]");
    if (quickRemove) {
      const itemId = quickRemove.dataset.oaDiscountQuickRemove;
      try {
        await authedFetch(`/api/admin/menu-discounts?itemId=${encodeURIComponent(itemId)}`, { method: "DELETE" });
        renderDiscountList();
      } catch (err) {
        console.error(err);
      }
      return;
    }
  });

  $("[data-oa-discount-save]")?.addEventListener("click", async () => {
    const errEl = $("[data-oa-discount-error]");
    const okEl = $("[data-oa-discount-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const price = Number($("[data-oa-discount-price]").value);
    const badge = $("[data-oa-discount-badge]").value.trim();
    if (!price || price <= 0) {
      errEl.hidden = false;
      errEl.textContent = "Enter a valid discounted price.";
      return;
    }
    try {
      await authedFetch("/api/admin/menu-discounts", {
        method: "POST",
        body: JSON.stringify({ itemId: selectedDiscountItemId, discountedPrice: price, badgeLabel: badge || null, active: true }),
      });
      okEl.hidden = false;
      okEl.textContent = "Discount applied — live immediately.";
      $("[data-oa-discount-remove]").hidden = false;
      renderDiscountList();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  $("[data-oa-discount-remove]")?.addEventListener("click", async () => {
    if (!selectedDiscountItemId) return;
    try {
      await authedFetch(`/api/admin/menu-discounts?itemId=${encodeURIComponent(selectedDiscountItemId)}`, { method: "DELETE" });
      $("[data-oa-discount-form]").hidden = true;
      renderDiscountList();
    } catch (err) {
      console.error(err);
    }
  });

  /* ------------------------------------------------------------ coupons */
  $("[data-oa-coupon-type]")?.addEventListener("change", (e) => {
    const label = $("[data-oa-coupon-value-label]");
    label.textContent = e.target.value === "flat" ? "Amount off (Rs.)" : "Percent off (1–100)";
  });

  const renderCouponList = async () => {
    const listEl = $("[data-oa-coupon-list]");
    try {
      const data = await authedFetch("/api/admin/coupons");
      const coupons = data.coupons || [];
      if (coupons.length === 0) {
        listEl.innerHTML = `<p class="oa-muted">No coupons created yet.</p>`;
        return;
      }
      listEl.innerHTML = coupons
        .map((c) => {
          const valueText = c.discount_type === "percent" ? `${c.discount_value}% off` : `Rs. ${c.discount_value} off`;
          const usageText = c.usage_limit != null ? `${c.times_used}/${c.usage_limit} used` : `${c.times_used} used`;
          const expiryText = c.expires_at ? `expires ${new Date(c.expires_at).toLocaleDateString()}` : "no expiry";
          return `<div class="oa-toggle-row">
            <span>
              <strong>${esc(c.code)}</strong>
              <small>${esc(valueText)} · ${esc(usageText)} · ${esc(expiryText)}${!c.active ? " · OFF" : ""}</small>
            </span>
            <span style="display:flex; gap:.5rem; align-items:center;">
              <span class="oa-toggle"><input type="checkbox" ${c.active ? "checked" : ""} data-oa-coupon-toggle="${esc(c.code)}"><span class="oa-toggle__track"></span></span>
              <button type="button" class="cart-drawer__back" data-oa-coupon-delete="${esc(c.code)}">Delete</button>
            </span>
          </div>`;
        })
        .join("");
    } catch (err) {
      listEl.innerHTML = `<p class="oa-muted">Could not load coupons.</p>`;
    }
  };

  $("[data-oa-coupon-create]")?.addEventListener("click", async () => {
    const errEl = $("[data-oa-coupon-error]");
    const okEl = $("[data-oa-coupon-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const code = $("[data-oa-coupon-code]").value.trim();
    const discountType = $("[data-oa-coupon-type]").value;
    const discountValue = Number($("[data-oa-coupon-value]").value);
    const maxDiscountAmount = $("[data-oa-coupon-max]").value;
    const minOrderAmount = $("[data-oa-coupon-min]").value;
    const usageLimit = $("[data-oa-coupon-limit]").value;
    const expiresAt = $("[data-oa-coupon-expires]").value;
    try {
      await authedFetch("/api/admin/coupons", {
        method: "POST",
        body: JSON.stringify({
          code,
          discountType,
          discountValue,
          maxDiscountAmount: maxDiscountAmount || undefined,
          minOrderAmount: minOrderAmount || undefined,
          usageLimit: usageLimit || undefined,
          expiresAt: expiresAt || undefined,
        }),
      });
      okEl.hidden = false;
      okEl.textContent = `Coupon ${code.toUpperCase()} created.`;
      $("[data-oa-coupon-code]").value = "";
      $("[data-oa-coupon-value]").value = "";
      $("[data-oa-coupon-max]").value = "";
      $("[data-oa-coupon-min]").value = "";
      $("[data-oa-coupon-limit]").value = "";
      $("[data-oa-coupon-expires]").value = "";
      renderCouponList();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  document.addEventListener("change", async (e) => {
    const toggle = e.target.closest("[data-oa-coupon-toggle]");
    if (!toggle) return;
    try {
      await authedFetch("/api/admin/coupons", {
        method: "PATCH",
        body: JSON.stringify({ code: toggle.dataset.oaCouponToggle, active: toggle.checked }),
      });
      renderCouponList();
    } catch (err) {
      console.error(err);
    }
  });

  document.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-oa-coupon-delete]");
    if (!del) return;
    try {
      await authedFetch(`/api/admin/coupons?code=${encodeURIComponent(del.dataset.oaCouponDelete)}`, { method: "DELETE" });
      renderCouponList();
    } catch (err) {
      console.error(err);
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
