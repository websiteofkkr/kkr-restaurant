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
    loadReservations();
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
      if (name === "featured") renderFeaturedList();
      if (name === "moments") renderMomentsList();
      if (name === "reservations") loadReservations();
      if (name === "contest") { loadPrizeConfig(); loadContestEntries(); }
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

  // Featured Items (unlike Menu Discounts) supports variant items like
  // Half/Full pricing, so its search includes them — shown with the
  // first variant's price as a representative figure.
  let MENU_ITEMS_ALL = [];
  const loadMenuItemsAll = async () => {
    if (MENU_ITEMS_ALL.length) return MENU_ITEMS_ALL;
    try {
      const res = await fetch("/menu.json");
      const menu = await res.json();
      MENU_ITEMS_ALL = (menu.categories || []).flatMap((cat) =>
        (cat.items || []).map((it) => ({
          id: it.id,
          name: it.name,
          price: it.price ?? it.variants?.[0]?.price ?? 0,
          category: cat.name,
        }))
      );
    } catch (err) {
      console.error(err);
    }
    return MENU_ITEMS_ALL;
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

  /* -------------------------------------------------------- featured items */
  let selectedFeaturedItemId = null;

  const renderFeaturedSearchResults = async (query) => {
    const resultsEl = $("[data-oa-featured-results]");
    if (!query.trim()) {
      resultsEl.innerHTML = "";
      return;
    }
    const items = await loadMenuItemsAll();
    const q = query.trim().toLowerCase();
    const matches = items.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 8);
    resultsEl.innerHTML = matches
      .map(
        (it) =>
          `<div data-oa-featured-pick="${esc(it.id)}" style="cursor:pointer;padding:.6rem .8rem;border:1px solid rgba(128,97,38,.18);border-radius:8px;margin-block-end:.4rem;">
            <strong>${esc(it.name)}</strong> — Rs. ${it.price} <span class="oa-muted">(${esc(it.category)})</span>
          </div>`
      )
      .join("");
  };

  const selectFeaturedItem = async (itemId) => {
    const items = await loadMenuItemsAll();
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    selectedFeaturedItemId = itemId;
    $("[data-oa-featured-form]").hidden = false;
    $("[data-oa-featured-item-name]").textContent = item.name;
    $("[data-oa-featured-blurb]").value = "";
    $("[data-oa-featured-error]").hidden = true;
    $("[data-oa-featured-success]").hidden = true;
  };

  const renderFeaturedList = async () => {
    const listEl = $("[data-oa-featured-list]");
    try {
      const data = await authedFetch("/api/admin/featured-items");
      const featured = data.items || [];
      if (featured.length === 0) {
        listEl.innerHTML = `<p class="oa-muted">No items featured yet.</p>`;
        return;
      }
      const items = await loadMenuItemsAll();
      const sectionLabel = { signature: "Our Special Platters", favourites: "Popular Picks" };
      listEl.innerHTML = featured
        .map((f) => {
          const item = items.find((it) => it.id === f.item_id);
          return `<div class="oa-toggle-row">
            <span>
              <strong>${esc(item?.name || f.item_id)}</strong>
              <small>${esc(sectionLabel[f.section] || f.section)}</small>
            </span>
            <button type="button" class="cart-drawer__back" data-oa-featured-remove="${esc(f.item_id)}" data-oa-featured-remove-section="${esc(f.section)}">Remove</button>
          </div>`;
        })
        .join("");
    } catch {
      listEl.innerHTML = `<p class="oa-muted">Could not load featured items.</p>`;
    }
  };

  $("[data-oa-featured-search]")?.addEventListener("input", (e) => renderFeaturedSearchResults(e.target.value));

  document.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-oa-featured-pick]");
    if (pick) {
      selectFeaturedItem(pick.dataset.oaFeaturedPick);
      $("[data-oa-featured-results]").innerHTML = "";
      $("[data-oa-featured-search]").value = "";
      return;
    }
    const remove = e.target.closest("[data-oa-featured-remove]");
    if (remove) {
      try {
        await authedFetch(
          `/api/admin/featured-items?itemId=${encodeURIComponent(remove.dataset.oaFeaturedRemove)}&section=${encodeURIComponent(remove.dataset.oaFeaturedRemoveSection)}`,
          { method: "DELETE" }
        );
        renderFeaturedList();
      } catch (err) {
        console.error(err);
      }
    }
  });

  $("[data-oa-featured-save]")?.addEventListener("click", async () => {
    const errEl = $("[data-oa-featured-error]");
    const okEl = $("[data-oa-featured-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const section = $("[data-oa-featured-section]").value;
    const blurb = $("[data-oa-featured-blurb]").value.trim();
    try {
      await authedFetch("/api/admin/featured-items", {
        method: "POST",
        body: JSON.stringify({ itemId: selectedFeaturedItemId, section, blurb: blurb || null }),
      });
      okEl.hidden = false;
      okEl.textContent = "Added — shows on the homepage immediately.";
      renderFeaturedList();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  /* -------------------------------------------------------------- contest */
  const currentMonthValue = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };
  const monthDisplayLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
  };

  let contestViewingMonth = currentMonthValue();
  let contestSummaryCache = null;
  let contestWinnerEntryCache = null;

  const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", snapchat: "Snapchat", x: "X", youtube: "YouTube", other: "Other" };
  const MONTH_STATUS_LABEL = {
    COMING_SOON: "Coming soon", ACCEPTING_ENTRIES: "Accepting entries",
    JUDGING: "Judging", WINNER_SELECTED: "Winner selected — not yet published", PUBLISHED: "Published",
  };

  const renderContestCard = (e) => {
    const badge = `<span class="oa-contest-card__badge oa-contest-card__badge--${e.status}">${e.status.replace("_", " ")}</span>`;
    const scoreLine = e.ai_score != null
      ? `<p class="oa-contest-card__score">AI score: <strong>${e.ai_score}</strong>/100 ${e.ai_recommendation ? `· ${esc(e.ai_recommendation)}` : ""}</p>`
      : `<p class="oa-contest-card__score oa-muted">Not yet AI-evaluated</p>`;
    const aiDetail = e.ai_reason
      ? `<p class="oa-contest-card__ai"><strong>Why:</strong> ${esc(e.ai_reason)}</p>`
      : "";
    const metadataFlag = e.has_camera_metadata === false
      ? `<p class="oa-contest-card__ai" style="color:#96430e;">⚠ No camera metadata found — worth a closer look before shortlisting.</p>`
      : "";

    const statusOptions = ["SUBMITTED","VALIDATING","VALID","SHORTLISTED","FINALIST","WINNER","NOT_SELECTED","REJECTED"]
      .map((s) => `<option value="${s}" ${e.status === s ? "selected" : ""}>${s.replace("_", " ")}</option>`)
      .join("");

    let rewardControls = "";
    if (e.status === "WINNER") {
      rewardControls = `<div class="oa-contest-card__actions">
        <span class="oa-muted">Reward: ${esc(e.reward_status || "PENDING")}</span>
        ${e.reward_status === "PENDING" ? `<button type="button" data-oa-contest-reward="${esc(e.id)}" data-value="ISSUED" class="cart-drawer__back">Issue Reward</button>` : ""}
        ${e.reward_status === "ISSUED" ? `<button type="button" data-oa-contest-reward="${esc(e.id)}" data-value="REDEEMED" class="cart-drawer__back">Mark Redeemed</button>` : ""}
      </div>`;
    }

    const winnerBtn = e.status === "FINALIST"
      ? `<button type="button" data-oa-contest-select-winner="${esc(e.id)}" class="btn btn--reserve" style="font-size:.72rem;padding:.35rem .6rem;">Select Winner</button>`
      : "";

    return `<div class="oa-contest-card" data-oa-contest-card="${esc(e.id)}">
      <img class="oa-contest-card__photo" src="${esc(e.photo_url)}" alt="Entry by @${esc(e.social_username)}" loading="lazy">
      <div class="oa-contest-card__body">
        ${badge}
        <strong>@${esc(e.social_username)}</strong>
        <span class="oa-muted">${esc(PLATFORM_LABEL[e.social_platform] || e.social_platform)} · ${new Date(e.submitted_at).toLocaleDateString()}</span>
        ${scoreLine}
        ${aiDetail}
        ${metadataFlag}
        <div class="oa-contest-card__actions">
          <select data-oa-contest-status="${esc(e.id)}">${statusOptions}</select>
          <button type="button" data-oa-contest-reevaluate="${esc(e.id)}" class="cart-drawer__back">${e.ai_evaluated_at ? "Re-evaluate" : "Evaluate"}</button>
          ${winnerBtn}
        </div>
        ${rewardControls}
      </div>
    </div>`;
  };

  let contestCurrentPrize = "PKR 5,000 KKR Dining Credit";

  // datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local
  // time — converting an ISO/UTC timestamp to that requires adjusting
  // for the timezone offset, not just slicing the string.
  const isoToLocalInputValue = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const offsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  };

  const loadPrizeConfig = async () => {
    try {
      const data = await authedFetch(`/api/admin/contest-months?month=${encodeURIComponent(contestViewingMonth)}`);
      const cm = data.contestMonth || {};
      contestCurrentPrize = cm.prize_description || "PKR 5,000 KKR Dining Credit";
      $("[data-oa-prize-type]").value = cm.prize_type || "";
      $("[data-oa-prize-amount]").value = cm.prize_amount ?? "";
      $("[data-oa-prize-currency]").value = cm.prize_currency || "PKR";
      $("[data-oa-prize-description]").value = contestCurrentPrize;
      $("[data-oa-reveal-at]").value = isoToLocalInputValue(cm.reveal_at);
    } catch (err) {
      console.error(err);
    }
  };

  $("[data-oa-reveal-at-save]")?.addEventListener("click", async () => {
    const note = $("[data-oa-reveal-at-note]");
    const value = $("[data-oa-reveal-at]").value;
    if (!value) {
      note.textContent = "Pick a date and time first.";
      return;
    }
    note.textContent = "Saving…";
    try {
      await authedFetch("/api/admin/contest-months", {
        method: "PATCH",
        body: JSON.stringify({ month: contestViewingMonth, revealAt: value }),
      });
      note.textContent = "Countdown set — it'll show on the homepage now.";
    } catch (err) {
      note.textContent = err.message;
    }
  });

  $("[data-oa-reveal-at-clear]")?.addEventListener("click", async () => {
    const note = $("[data-oa-reveal-at-note]");
    note.textContent = "Clearing…";
    try {
      await authedFetch("/api/admin/contest-months", {
        method: "PATCH",
        body: JSON.stringify({ month: contestViewingMonth, revealAt: "" }),
      });
      $("[data-oa-reveal-at]").value = "";
      note.textContent = "Countdown cleared.";
    } catch (err) {
      note.textContent = err.message;
    }
  });

  $("[data-oa-prize-save]")?.addEventListener("click", async () => {
    const note = $("[data-oa-prize-saved-note]");
    note.textContent = "Saving…";
    try {
      await authedFetch("/api/admin/contest-months", {
        method: "PATCH",
        body: JSON.stringify({
          month: contestViewingMonth,
          prizeType: $("[data-oa-prize-type]").value || null,
          prizeAmount: $("[data-oa-prize-amount]").value || null,
          prizeCurrency: $("[data-oa-prize-currency]").value || "PKR",
          prizeDescription: $("[data-oa-prize-description]").value,
        }),
      });
      note.textContent = "Saved — this is now the prize shown everywhere for this month.";
      loadContestEntries();
    } catch (err) {
      note.textContent = err.message;
    }
  });

  const renderWinnerPanel = (summary, entries) => {
    const panel = $("[data-oa-contest-winner-panel]");
    if (!summary.winner) {
      panel.hidden = true;
      contestWinnerEntryCache = null;
      return;
    }
    const winnerEntry = entries.find((e) => e.status === "WINNER");
    contestWinnerEntryCache = winnerEntry || null;
    panel.hidden = false;
    $("[data-oa-contest-winner-name]").textContent = summary.winner;
    if (winnerEntry) {
      $("[data-oa-contest-winner-photo]").src = winnerEntry.photo_url;
      $("[data-oa-contest-winner-photo]").alt = `Winning photo by @${winnerEntry.social_username}`;
      $("[data-oa-contest-winner-username]").textContent = winnerEntry.social_username;
      $("[data-oa-contest-winner-platform]").textContent = PLATFORM_LABEL[winnerEntry.social_platform] || winnerEntry.social_platform;
      $("[data-oa-contest-winner-score]").textContent = winnerEntry.ai_score ?? "—";
      $("[data-oa-contest-prize-amount]").textContent = contestCurrentPrize;
      $("[data-oa-contest-winner-selected-at]").textContent = winnerEntry.winner_selected_at
        ? new Date(winnerEntry.winner_selected_at).toLocaleString()
        : "";
    }
    const publishedNote = $("[data-oa-contest-published-note]");
    const publishBtn = $("[data-oa-contest-publish]");
    const unpublishBtn = $("[data-oa-contest-unpublish]");
    if (summary.published) {
      publishedNote.style.display = "block";
      publishBtn.disabled = true;
      publishBtn.textContent = "Published";
      unpublishBtn.hidden = false;
    } else {
      publishedNote.style.display = "none";
      publishBtn.disabled = false;
      publishBtn.textContent = "Publish Winner";
      unpublishBtn.hidden = true;
    }
  };

  const loadContestEntries = async () => {
    $("[data-oa-contest-month-label]").textContent = monthDisplayLabel(contestViewingMonth);
    $("[data-oa-contest-error]").hidden = true;

    const status = $("[data-oa-contest-status-filter]").value;
    const platform = $("[data-oa-contest-platform-filter]").value;
    const params = new URLSearchParams({ month: contestViewingMonth });
    if (status) params.set("status", status);
    if (platform) params.set("platform", platform);

    try {
      const data = await authedFetch(`/api/admin/contest?${params.toString()}`);
      const entries = (data.entries || []).filter((e) => e.contest_month === contestViewingMonth);
      const s = data.summary || {};
      contestSummaryCache = s;

      const badgeEl = $("[data-oa-contest-status-badge]");
      badgeEl.className = `oa-contest-status-badge oa-contest-status-badge--${s.monthStatus || "COMING_SOON"}`;
      badgeEl.textContent = MONTH_STATUS_LABEL[s.monthStatus] || s.monthStatus || "Coming soon";

      $("[data-oa-contest-summary]").innerHTML = `
        <div class="oa-contest-summary__item"><strong>${s.totalEntries ?? 0}</strong><span>Total entries</span></div>
        <div class="oa-contest-summary__item"><strong>${s.validEntries ?? 0}</strong><span>Valid</span></div>
        <div class="oa-contest-summary__item"><strong>${s.aiEvaluated ?? 0}</strong><span>AI evaluated</span></div>
        <div class="oa-contest-summary__item"><strong>${s.shortlisted ?? 0}</strong><span>Shortlisted</span></div>
        <div class="oa-contest-summary__item"><strong>${s.finalists ?? 0}</strong><span>Finalists</span></div>
        <div class="oa-contest-summary__item"><strong>${s.winner ? "✓" : "—"}</strong><span>${s.winner ? esc(s.winner) : "No winner yet"}</span></div>
      `;

      renderWinnerPanel(s, entries);

      const grid = $("[data-oa-contest-grid]");
      grid.innerHTML = entries.length
        ? entries.map(renderContestCard).join("")
        : `<p class="oa-muted">No entries match these filters.</p>`;

      // History dropdown, populated once we know what months exist.
      const historySelect = $("[data-oa-contest-history-select]");
      if (historySelect && data.availableMonths) {
        const months = [...new Set([currentMonthValue(), ...data.availableMonths])].sort().reverse();
        historySelect.innerHTML =
          `<option value="">Choose a month…</option>` +
          months.map((m) => `<option value="${m}" ${m === contestViewingMonth ? "selected" : ""}>${monthDisplayLabel(m)}${m === currentMonthValue() ? " (current)" : ""}</option>`).join("");
      }
    } catch (err) {
      $("[data-oa-contest-error]").hidden = false;
      $("[data-oa-contest-error]").textContent = err.message;
    }
  };

  $("[data-oa-contest-refresh]")?.addEventListener("click", () => { loadPrizeConfig(); loadContestEntries(); });
  $("[data-oa-contest-status-filter]")?.addEventListener("change", loadContestEntries);
  $("[data-oa-contest-platform-filter]")?.addEventListener("change", loadContestEntries);
  $("[data-oa-contest-history-select]")?.addEventListener("change", (e) => {
    if (!e.target.value) return;
    contestViewingMonth = e.target.value;
    loadPrizeConfig();
    loadContestEntries();
  });

  $("[data-oa-contest-shortlist]")?.addEventListener("click", async () => {
    const statusEl = $("[data-oa-contest-ai-status]");
    const errEl = $("[data-oa-contest-error]");
    errEl.hidden = true;
    statusEl.textContent = "Running AI shortlist — this can take a minute…";
    try {
      const data = await authedFetch("/api/admin/contest-ai-shortlist", { method: "POST", body: JSON.stringify({ month: contestViewingMonth }) });
      statusEl.textContent = `Evaluated ${data.evaluatedCount ?? 0}, shortlisted ${data.shortlistedCount ?? 0}.`;
      loadContestEntries();
    } catch (err) {
      statusEl.textContent = "";
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  $("[data-oa-contest-compare]")?.addEventListener("click", async () => {
    const statusEl = $("[data-oa-contest-ai-status]");
    const errEl = $("[data-oa-contest-error]");
    errEl.hidden = true;
    statusEl.textContent = "Comparing finalists…";
    try {
      const data = await authedFetch("/api/admin/contest-ai-compare", { method: "POST", body: JSON.stringify({ month: contestViewingMonth }) });
      statusEl.textContent = `Top 3 finalists selected. ${data.note || ""}`;
      loadContestEntries();
    } catch (err) {
      statusEl.textContent = "";
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });

  // ---- Winner announcement graphic (client-side canvas — no server-side
  // image manipulation infrastructure needed) ----
  const buildAnnouncementCanvas = (entry) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const W = 1080, H = 1350; // a standard social portrait canvas
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      // Photo fills the frame, cropped to cover.
      const scale = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

      // Dark gradient for text legibility, KKR black/gold identity.
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgba(11,9,7,.75)");
      grad.addColorStop(0.18, "rgba(11,9,7,.15)");
      grad.addColorStop(0.72, "rgba(11,9,7,.25)");
      grad.addColorStop(1, "rgba(11,9,7,.92)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = "center";
      ctx.fillStyle = "#C9A35B";
      ctx.font = "700 34px Georgia, serif";
      ctx.fillText("KKR PHOTO OF THE MONTH", W / 2, 90);

      ctx.fillStyle = "#fff";
      ctx.font = "400 46px Georgia, serif";
      ctx.fillText(`${monthDisplayLabel(entry.contest_month || contestViewingMonth).toUpperCase()} WINNER`, W / 2, 150);

      ctx.fillStyle = "#C9A35B";
      ctx.font = "700 40px Georgia, serif";
      ctx.fillText(`@${entry.social_username}`, W / 2, H - 220);

      ctx.fillStyle = "#fff";
      ctx.font = "700 44px Georgia, serif";
      ctx.fillText("CONGRATULATIONS!", W / 2, H - 160);

      ctx.fillStyle = "#C9A35B";
      ctx.font = "700 38px Georgia, serif";
      ctx.fillText(contestCurrentPrize.toUpperCase(), W / 2, H - 100);

      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.font = "400 24px Georgia, serif";
      ctx.fillText("#KKRPeshawar   #KKRPhotoOfTheMonth", W / 2, H - 50);

      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Could not load the winning photo to build the announcement."));
    img.src = entry.photo_url;
  });

  $("[data-oa-contest-generate-announcement]")?.addEventListener("click", async () => {
    if (!contestWinnerEntryCache) return;
    const preview = $("[data-oa-contest-announcement-preview]");
    preview.innerHTML = `<p class="oa-muted">Generating…</p>`;
    try {
      const canvas = await buildAnnouncementCanvas(contestWinnerEntryCache);
      const dataUrl = canvas.toDataURL("image/png");
      preview.innerHTML = `
        <img src="${dataUrl}" alt="Winner announcement graphic" style="max-width:16rem;border-radius:10px;display:block;margin-block-end:.5rem;">
        <a href="${dataUrl}" download="kkr-photo-of-the-month-${contestViewingMonth}.png" class="cart-drawer__back">Download announcement image</a>
      `;
    } catch (err) {
      preview.innerHTML = `<p class="cart-checkout__error">${esc(err.message)}</p>`;
    }
  });

  const buildCaption = (entry) => {
    const month = monthDisplayLabel(entry.contest_month || contestViewingMonth).split(" ")[0];
    return `Congratulations to our ${month} KKR Photo of the Month winner! 🎉

A special KKR moment captured by @${entry.social_username}.

You've won ${contestCurrentPrize}! 🏆

Thank you to everyone who shared their KKR moments with us.

Want to be our next winner?
Tag @KKRPeshawar and use #KKRPeshawar.

#KKRPeshawar #KKRPhotoOfTheMonth`;
  };

  $("[data-oa-contest-copy-caption]")?.addEventListener("click", async () => {
    if (!contestWinnerEntryCache) return;
    const caption = buildCaption(contestWinnerEntryCache);
    const preview = $("[data-oa-contest-caption-preview]");
    preview.innerHTML = `<p class="cart-checkout__note" style="white-space:pre-wrap;">${esc(caption)}</p>`;
    try {
      await navigator.clipboard.writeText(caption);
      preview.innerHTML += `<p class="oa-muted">Copied to clipboard.</p>`;
    } catch {
      preview.innerHTML += `<p class="oa-muted">Select the text above and copy manually.</p>`;
    }
  });

  $("[data-oa-contest-publish]")?.addEventListener("click", async () => {
    if (!contestWinnerEntryCache) return;
    const monthLabel = monthDisplayLabel(contestWinnerEntryCache.contest_month || contestViewingMonth);
    if (!confirm(`Publish ${monthLabel} winner?\n\n@${contestWinnerEntryCache.social_username} will appear as the Photo of the Month on the live website.`)) return;
    try {
      const caption = buildCaption(contestWinnerEntryCache);
      await authedFetch("/api/admin/contest", {
        method: "PATCH",
        body: JSON.stringify({ id: contestWinnerEntryCache.id, publish: true, caption }),
      });
      loadContestEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  $("[data-oa-contest-unpublish]")?.addEventListener("click", async () => {
    if (!contestWinnerEntryCache) return;
    if (!confirm(`Take @${contestWinnerEntryCache.social_username} off the live website?\n\nThey'll stay recorded as the winner internally — this just removes the public homepage display.`)) return;
    try {
      await authedFetch("/api/admin/contest", {
        method: "PATCH",
        body: JSON.stringify({ id: contestWinnerEntryCache.id, unpublish: true }),
      });
      loadContestEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  $("[data-oa-contest-undo-winner]")?.addEventListener("click", async () => {
    if (!contestWinnerEntryCache) return;
    if (!confirm(`Remove @${contestWinnerEntryCache.social_username} as the winner?\n\nThis unpublishes them (if published), clears the reward code, and moves them back to Finalist so you can select someone else instead. This can't be undone.`)) return;
    try {
      await authedFetch("/api/admin/contest", {
        method: "PATCH",
        body: JSON.stringify({ id: contestWinnerEntryCache.id, undoWinner: true }),
      });
      loadContestEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  document.addEventListener("change", async (e) => {
    const statusSelect = e.target.closest("[data-oa-contest-status]");
    if (statusSelect) {
      try {
        await authedFetch("/api/admin/contest", {
          method: "PATCH",
          body: JSON.stringify({ id: statusSelect.dataset.oaContestStatus, status: statusSelect.value }),
        });
        loadContestEntries();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  document.addEventListener("click", async (e) => {
    const reeval = e.target.closest("[data-oa-contest-reevaluate]");
    if (reeval) {
      reeval.disabled = true;
      reeval.textContent = "Evaluating…";
      try {
        await authedFetch("/api/admin/contest-ai-shortlist", {
          method: "POST",
          body: JSON.stringify({ entryId: reeval.dataset.oaContestReevaluate }),
        });
        loadContestEntries();
      } catch (err) {
        alert(err.message);
        reeval.disabled = false;
        reeval.textContent = "Evaluate";
      }
      return;
    }

    const selectWinner = e.target.closest("[data-oa-contest-select-winner]");
    if (selectWinner) {
      if (!confirm("Are you sure you want to select this entry as the Photo of the Month winner?")) return;
      try {
        await authedFetch("/api/admin/contest", {
          method: "PATCH",
          body: JSON.stringify({ id: selectWinner.dataset.oaContestSelectWinner, selectWinner: true }),
        });
        loadContestEntries();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const rewardBtn = e.target.closest("[data-oa-contest-reward]");
    if (rewardBtn) {
      try {
        await authedFetch("/api/admin/contest", {
          method: "PATCH",
          body: JSON.stringify({ id: rewardBtn.dataset.oaContestReward, rewardStatus: rewardBtn.dataset.value }),
        });
        loadContestEntries();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  /* ------------------------------------------------------ reveal ceremony */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const spawnConfetti = () => {
    const container = $("[data-oa-reveal-confetti]");
    if (!container || reduceMotion) return;
    const colors = ["#C9A35B", "#E7C982", "#ffffff", "#c0392b", "#2f9e44"];
    const pieceCount = 90;
    for (let i = 0; i < pieceCount; i++) {
      const piece = document.createElement("span");
      piece.className = "reveal-confetti__piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.borderRadius = Math.random() > .5 ? "50%" : "2px";
      container.appendChild(piece);
    }
    // Cleaned up automatically once this reveal closes / the next one
    // starts (container.innerHTML is reset there) — no lingering nodes.
  };

  const runReveal = (entry, { isPreview }) => new Promise((resolve) => {
    const overlay = $("[data-oa-reveal-overlay]");
    const countdownEl = $("[data-oa-reveal-countdown]");
    const numberEl = $("[data-oa-reveal-number]");
    const resultEl = $("[data-oa-reveal-result]");
    const closeBtn = $("[data-oa-reveal-close]");
    const confettiEl = $("[data-oa-reveal-confetti]");

    overlay.hidden = false;
    countdownEl.hidden = false;
    resultEl.hidden = true;
    if (confettiEl) confettiEl.innerHTML = "";
    closeBtn.hidden = true; // no escaping mid-countdown (spec: prevent accidental skips)
    document.body.style.overflow = "hidden";

    const finish = () => {
      overlay.hidden = true;
      document.body.style.overflow = "";
      resolve();
    };
    closeBtn.onclick = finish;

    const showResult = () => {
      countdownEl.hidden = true;
      resultEl.hidden = false;
      closeBtn.hidden = false;
      $("[data-oa-reveal-preview-flag]").hidden = !isPreview;
      $("[data-oa-reveal-month]").textContent = monthDisplayLabel(entry.contest_month || contestViewingMonth).toUpperCase();
      $("[data-oa-reveal-photo]").src = entry.photo_url;
      $("[data-oa-reveal-photo]").alt = `Winning photo by @${entry.social_username}`;
      $("[data-oa-reveal-username]").textContent = `@${entry.social_username}`;
      $("[data-oa-reveal-prize]").textContent = contestCurrentPrize;
    };

    if (reduceMotion) {
      // Skip the drawn-out countdown but keep the same information and
      // sequencing (spec Part 25: simpler transition, same functionality).
      showResult();
      return;
    }

    let n = 10;
    numberEl.textContent = String(n);
    const tick = () => {
      n -= 1;
      if (n >= 0) {
        numberEl.textContent = String(n);
        numberEl.classList.remove("is-flash");
        void numberEl.offsetWidth; // restart the pop animation each tick
        if (n === 0) numberEl.classList.add("is-flash");
        setTimeout(tick, 1000);
      } else {
        // At zero: confetti celebration plays first, over the countdown
        // screen, then the contestant's details fade in afterward —
        // celebrate, then reveal, rather than both at once.
        spawnConfetti();
        setTimeout(showResult, 1400);
      }
    };
    setTimeout(tick, 1000);
  });

  $("[data-oa-contest-reveal]")?.addEventListener("click", async () => {
    if (!contestWinnerEntryCache) return;
    await runReveal(contestWinnerEntryCache, { isPreview: false });
    // Recording that the ceremony happened is purely informational — it
    // never changes who won or any contest status (spec Part 14).
    try {
      await authedFetch("/api/admin/contest-months", {
        method: "PATCH",
        body: JSON.stringify({ month: contestWinnerEntryCache.contest_month || contestViewingMonth, markRevealed: true }),
      });
    } catch {
      /* non-fatal */
    }
  });

  $("[data-oa-contest-preview-reveal]")?.addEventListener("click", async () => {
    // Available even before a real winner exists — uses the winner if
    // already selected, otherwise the top-ranked finalist, purely to test
    // the animation. Never writes anything to the database.
    let subject = contestWinnerEntryCache;
    if (!subject) {
      try {
        const data = await authedFetch(`/api/admin/contest?month=${encodeURIComponent(contestViewingMonth)}&status=FINALIST`);
        subject = (data.entries || [])[0];
      } catch {
        /* fall through to the alert below */
      }
    }
    if (!subject) {
      alert("Nothing to preview yet — select at least one finalist first.");
      return;
    }
    runReveal(subject, { isPreview: true });
  });

  /* ------------------------------------------------------- reservations */
  const RESERVATION_STATUS_LABELS = { new: "New", confirmed: "Confirmed", declined: "Declined", completed: "Completed" };

  const loadReservations = async () => {
    try {
      const data = await authedFetch("/api/admin/reservations");
      const reservations = data.reservations || [];
      const newCount = reservations.filter((r) => r.status === "new").length;
      const badge = $("[data-oa-reservations-badge]");
      if (badge) {
        badge.hidden = newCount === 0;
        badge.textContent = String(newCount);
      }

      const countEl = $("[data-oa-reservations-count]");
      if (countEl) countEl.textContent = `${reservations.length} request${reservations.length === 1 ? "" : "s"}`;

      const body = $("[data-oa-reservations-body]");
      if (!body) return;
      if (reservations.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="oa-muted">No reservation requests yet.</td></tr>`;
        return;
      }
      body.innerHTML = reservations
        .map((r) => {
          const when = new Date(r.created_at).toLocaleString();
          const guestLine = `${esc(r.name)}<br><span class="oa-muted">${esc(r.phone)}${r.email ? " · " + esc(r.email) : ""}</span>`;
          const statusOptions = Object.entries(RESERVATION_STATUS_LABELS)
            .map(([val, label]) => `<option value="${val}" ${r.status === val ? "selected" : ""}>${label}</option>`)
            .join("");
          return `<tr ${r.status === "new" ? 'style="background:rgba(192,57,43,.06);"' : ""}>
            <td>${esc(when)}</td>
            <td>${guestLine}</td>
            <td>${esc(r.reservation_date)}<br>${esc(r.reservation_time)}</td>
            <td>${esc(r.guests)}</td>
            <td>${esc(r.occasion || "—")}</td>
            <td>${esc(r.notes || "—")}</td>
            <td><select class="cart-input" data-oa-reservation-status="${esc(r.id)}" style="font-size:.8rem;padding:.35rem .5rem;">${statusOptions}</select></td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
    }
  };

  $("[data-oa-refresh-reservations]")?.addEventListener("click", loadReservations);

  document.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-oa-reservation-status]");
    if (!select) return;
    try {
      await authedFetch("/api/admin/reservations", {
        method: "PATCH",
        body: JSON.stringify({ id: select.dataset.oaReservationStatus, status: select.value }),
      });
      loadReservations();
    } catch (err) {
      console.error(err);
    }
  });

  /* ------------------------------------------------------------ moments */
  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const renderMomentsList = async () => {
    const listEl = $("[data-oa-moment-list]");
    const storageEl = $("[data-oa-moment-storage]");
    try {
      const data = await authedFetch("/api/admin/moments");
      const moments = data.moments || [];
      const totalBytes = moments.reduce((sum, m) => sum + (m.file_size_bytes || 0), 0);
      storageEl.textContent = `${moments.length} moment${moments.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)} used`;
      if (moments.length === 0) {
        listEl.innerHTML = `<p class="oa-muted">No moments uploaded yet — the homepage shows its built-in default clips until you add some here.</p>`;
        return;
      }
      listEl.innerHTML = moments
        .map(
          (m) => `<div class="oa-toggle-row">
            <span>
              <strong>${esc(m.title)}</strong>
              <small>${esc(m.subtitle || "")}${m.subtitle ? " · " : ""}${formatBytes(m.file_size_bytes || 0)}</small>
            </span>
            <button type="button" class="cart-drawer__back" data-oa-moment-remove="${esc(m.id)}">Delete</button>
          </div>`
        )
        .join("");
    } catch {
      listEl.innerHTML = `<p class="oa-muted">Could not load moments.</p>`;
    }
  };

  $("[data-oa-moment-upload]")?.addEventListener("click", async () => {
    const errEl = $("[data-oa-moment-error]");
    const okEl = $("[data-oa-moment-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    const title = $("[data-oa-moment-title]").value.trim();
    const subtitle = $("[data-oa-moment-subtitle]").value.trim();
    const duration = $("[data-oa-moment-duration]").value.trim();
    const videoFile = $("[data-oa-moment-video]").files?.[0];
    const posterFile = $("[data-oa-moment-poster]").files?.[0];
    if (!title || !videoFile) {
      errEl.hidden = false;
      errEl.textContent = "Title and a video file are required.";
      return;
    }
    const uploadBtn = $("[data-oa-moment-upload]");
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading…";
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("subtitle", subtitle);
      form.append("durationLabel", duration);
      form.append("video", videoFile);
      if (posterFile) form.append("poster", posterFile);
      const session = window.KKRAuth?.getSession();
      const res = await fetch("/api/admin/upload-moment", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      okEl.hidden = false;
      okEl.textContent = "Moment added — live on the homepage immediately.";
      $("[data-oa-moment-title]").value = "";
      $("[data-oa-moment-subtitle]").value = "";
      $("[data-oa-moment-duration]").value = "";
      $("[data-oa-moment-video]").value = "";
      $("[data-oa-moment-poster]").value = "";
      renderMomentsList();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload moment";
    }
  });

  document.addEventListener("click", async (e) => {
    const remove = e.target.closest("[data-oa-moment-remove]");
    if (!remove) return;
    try {
      await authedFetch(`/api/admin/moments?id=${encodeURIComponent(remove.dataset.oaMomentRemove)}`, { method: "DELETE" });
      renderMomentsList();
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
