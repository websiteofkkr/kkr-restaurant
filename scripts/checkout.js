/**
 * Logic for the dedicated checkout page (en/checkout/). Reads the shared
 * cart (window.KKRCart, from cart.js) and the shared session
 * (window.KKRAuth, from auth.js) — this file just lays them out and
 * submits the order.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);
  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  // Mutable defaults, overwritten by fetchSettings() below as soon as it
  // resolves — these three values are admin-configurable (see
  // functions/api/admin/settings.js) so they can't be hardcoded constants.
  let FREE_DELIVERY_THRESHOLD = 1000;
  let STANDARD_DELIVERY = 200;
  let SALES_TAX_RATE = 0.05;
  let appliedCoupon = null; // { code, discount } once successfully applied
  let REWARD_RATE = 0.01;
  let FEATURES = {
    ordering_enabled: true,
    delivery_enabled: true,
    pickup_enabled: true,
    cash_enabled: true,
    easypaisa_enabled: true,
  };

  const fetchSettings = async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      const res = await fetch(`${url}/rest/v1/settings?select=key,value`, {
        headers: { apikey: anonKey },
      });
      const rows = await res.json();
      const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (raw.tax_rate != null) SALES_TAX_RATE = Number(raw.tax_rate);
      if (raw.delivery_fee != null) STANDARD_DELIVERY = Number(raw.delivery_fee);
      if (raw.free_delivery_threshold != null) FREE_DELIVERY_THRESHOLD = Number(raw.free_delivery_threshold);
      if (raw.reward_rate != null) REWARD_RATE = Number(raw.reward_rate);
      if (raw.easypaisa_number) setText("[data-easypaisa-number]", raw.easypaisa_number);
      for (const key of Object.keys(FEATURES)) {
        if (raw[key] != null) FEATURES[key] = raw[key] === true || raw[key] === "true";
      }
      applyFeatureToggles();
      renderSummary();
    } catch {
      // Settings fetch failing just means the estimate shown here uses the
      // defaults above until reload — the server (functions/api/order.js)
      // is the actual source of truth regardless, so nothing is at risk.
    }
  };

  /** Hides/disables order-type and payment options the restaurant has
   *  turned off, and blocks checkout entirely if ordering itself is off —
   *  see orders-admin's "Site features" tab. functions/api/order.js
   *  enforces the same rules server-side, so this is UX, not the only
   *  guard. */
  const applyFeatureToggles = () => {
    const disabledBanner = $("[data-ordering-disabled]");
    const layout = $("[data-checkout-layout]");
    if (!FEATURES.ordering_enabled) {
      if (disabledBanner) disabledBanner.hidden = false;
      if (layout) layout.hidden = true;
      return;
    }
    if (disabledBanner) disabledBanner.hidden = true;

    const deliveryOption = document.querySelector('input[name="kkr-order-type"][value="delivery"]');
    const pickupOption = document.querySelector('input[name="kkr-order-type"][value="pickup"]');
    if (deliveryOption) {
      deliveryOption.closest(".cart-checkout__method").hidden = !FEATURES.delivery_enabled;
      if (!FEATURES.delivery_enabled && deliveryOption.checked && pickupOption) pickupOption.checked = true;
    }
    if (pickupOption) {
      pickupOption.closest(".cart-checkout__method").hidden = !FEATURES.pickup_enabled;
      if (!FEATURES.pickup_enabled && pickupOption.checked && deliveryOption) deliveryOption.checked = true;
    }

    const cashOption = document.querySelector('input[name="kkr-payment"][value="cash"]');
    const easypaisaOption = document.querySelector('input[name="kkr-payment"][value="easypaisa"]');
    if (cashOption) {
      cashOption.closest(".cart-checkout__method").hidden = !FEATURES.cash_enabled;
      if (!FEATURES.cash_enabled && cashOption.checked && easypaisaOption) easypaisaOption.checked = true;
    }
    if (easypaisaOption) {
      easypaisaOption.closest(".cart-checkout__method").hidden = !FEATURES.easypaisa_enabled;
      if (!FEATURES.easypaisa_enabled && easypaisaOption.checked && cashOption) cashOption.checked = true;
    }
    renderOrderTypePanel();
    renderPaymentPanel();
  };

  const applyCoupon = async () => {
    const input = $("[data-coupon-input]");
    const errEl = $("[data-coupon-error]");
    const code = input?.value.trim();
    errEl.hidden = true;
    if (!code) {
      errEl.hidden = false;
      errEl.textContent = "Enter a coupon code.";
      return;
    }
    const applyBtn = $("[data-coupon-apply]");
    applyBtn.disabled = true;
    applyBtn.textContent = "Checking…";
    try {
      const sub = window.KKRCart.getSubtotal();
      const res = await fetch("/api/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal: sub }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That coupon code isn't valid.");
      appliedCoupon = { code: data.code, discount: data.discount };
      $("[data-coupon-applied-code]").textContent = data.code;
      $("[data-coupon-applied]").hidden = false;
      input.value = "";
      renderSummary();
    } catch (err) {
      appliedCoupon = null;
      errEl.hidden = false;
      errEl.textContent = err.message;
      renderSummary();
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = "Apply";
    }
  };

  const computeTotals = () => {
    const sub = window.KKRCart.getSubtotal();
    const discount = appliedCoupon ? Math.min(appliedCoupon.discount, sub) : 0;
    const discountedSub = Math.round((sub - discount) * 100) / 100;
    const orderType = document.querySelector('input[name="kkr-order-type"]:checked')?.value || "delivery";
    const delivery = orderType === "pickup" ? 0 : discountedSub > FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY;
    const tax = Math.round(discountedSub * SALES_TAX_RATE);
    return { sub, discount, discountedSub, delivery, tax, total: discountedSub + delivery + tax };
  };

  const renderSummary = () => {
    const items = window.KKRCart.getItems();
    const list = $("[data-summary-items]");
    if (list) {
      list.innerHTML = items
        .map(
          (it) =>
            `<li class="checkout__summary-item"><span>${it.qty} × ${esc(it.name)}</span><span>${fmt(it.price * it.qty)}</span></li>`
        )
        .join("");
    }
    const { sub, discount, delivery, tax, total } = computeTotals();
    setText("[data-cart-subtotal]", fmt(sub));
    const discountRow = $("[data-discount-row]");
    if (discountRow) discountRow.hidden = discount <= 0;
    setText("[data-cart-discount]", `\u2212${fmt(discount)}`);
    setText("[data-cart-tax]", fmt(tax));
    setText("[data-tax-label]", SALES_TAX_RATE > 0 ? `Tax (${Math.round(SALES_TAX_RATE * 1000) / 10}%)` : "Tax");
    setText("[data-cart-delivery]", delivery === 0 ? "Free" : fmt(delivery));
    setText(
      "[data-delivery-note]",
      `Free delivery on orders over Rs. ${fmt(FREE_DELIVERY_THRESHOLD)} — otherwise a flat Rs. ${fmt(STANDARD_DELIVERY)}.`
    );
    renderRewardEstimate();
    setText("[data-cart-total]", fmt(total));

    const amountEl = $("[data-easypaisa-amount]");
    if (amountEl) amountEl.textContent = `Rs. ${fmt(total)}`;

    const empty = $("[data-checkout-empty]");
    const layout = $("[data-checkout-layout]");
    const hasItems = window.KKRCart.getCount() > 0;
    const sent = $("[data-checkout-sent]");
    const orderPlaced = sent && !sent.hidden;
    if (empty) empty.hidden = hasItems || orderPlaced || !FEATURES.ordering_enabled;
    if (layout) layout.hidden = orderPlaced || !hasItems || !FEATURES.ordering_enabled;
  };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const setText = (sel, text) => {
    const el = $(sel);
    if (el) el.textContent = text;
  };

  const setError = (sel, message) => {
    const el = $(sel);
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  };

  /* ---------------------------------------------------- panel switching */
  const showAuthPanel = (name) => {
    $$("[data-auth-panel]").forEach((el) => {
      el.hidden = el.dataset.authPanel !== name;
    });
    $$("[data-login-error],[data-register-error]").forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
    const customerPanel = $("[data-customer-panel]");
    if (customerPanel) customerPanel.hidden = name !== "session";
  };

  const prefill = (profile) => {
    const set = (sel, val) => {
      const el = $(sel);
      if (el && val) el.value = val;
    };
    if (profile) {
      set("[data-cf-name]", profile.full_name);
      set("[data-cf-phone]", profile.phone);
      set("[data-cf-email]", profile.email);
      set("[data-cf-address]", profile.default_address);
    }
  };

  const renderAuthState = () => {
    const session = window.KKRAuth?.getSession();
    if (session) {
      setText("[data-session-name]", session.profile?.full_name || session.user?.email || "you");
      setText("[data-session-points]", String(session.profile?.reward_points ?? 0));
      showAuthPanel("session");
      prefill(session.profile);
      renderRewardEstimate();
    } else {
      showAuthPanel("login");
    }
  };

  const renderRewardEstimate = () => {
    const el = $("[data-reward-estimate]");
    if (!el || !window.KKRAuth?.getSession()) return;
    const sub = window.KKRCart.getSubtotal();
    const points = Math.floor(sub * REWARD_RATE);
    el.hidden = points <= 0;
    el.textContent = `You'll earn ~${points} reward point${points === 1 ? "" : "s"} once this order is confirmed.`;
  };

  const renderPaymentPanel = () => {
    const method = document.querySelector('input[name="kkr-payment"]:checked')?.value || "cash";
    const cashNote = $("[data-cash-note]");
    const epPanel = $("[data-easypaisa-panel]");
    if (cashNote) cashNote.hidden = method !== "cash";
    if (epPanel) epPanel.hidden = method !== "easypaisa";
  };

  const renderOrderTypePanel = () => {
    const orderType = document.querySelector('input[name="kkr-order-type"]:checked')?.value || "delivery";
    const addressField = $("[data-address-field]");
    if (addressField) addressField.hidden = orderType !== "delivery";
  };

  /* -------------------------------------------------------- place order */
  // One key per page load, reused across retries of the SAME attempt —
  // this is what lets the backend recognize a double-click or a retried
  // request as the same order instead of creating a duplicate. A fresh
  // key is only generated on a full page reload (a genuinely new attempt).
  const idempotencyKey = crypto.randomUUID();

  /* ------------------------------------------------------- Turnstile
     The widget itself is just a UX gate — the backend independently
     re-verifies whatever token it produces before creating any order. A
     customer who disables JavaScript or fakes a token client-side gains
     nothing, since functions/api/order.js checks with Cloudflare directly. */
  let turnstileWidgetId = null;

  const renderTurnstile = async () => {
    const container = $("[data-turnstile-widget]");
    if (!container) return;
    try {
      const res = await fetch("/api/public-config");
      const config = await res.json();
      if (!config.turnstileSiteKey) {
        // No site key configured yet — hide the widget rather than show a
        // broken box. Orders will still be rejected server-side once
        // Turnstile is actually configured; until then this degrades to
        // "not yet protected" rather than "broken for every customer".
        container.hidden = true;
        return;
      }
      const waitForTurnstile = () =>
        new Promise((resolve) => {
          if (window.turnstile) return resolve();
          const check = setInterval(() => {
            if (window.turnstile) {
              clearInterval(check);
              resolve();
            }
          }, 100);
        });
      await waitForTurnstile();
      turnstileWidgetId = window.turnstile.render(container, { sitekey: config.turnstileSiteKey });
    } catch {
      // Same reasoning as above — fail toward "hidden", not "broken".
      container.hidden = true;
    }
  };

  const placeOrder = async () => {
    setError("[data-order-error]", "");

    const session = window.KKRAuth?.getSession();
    if (!session?.access_token) {
      setError("[data-order-error]", "Please log in or create an account to place an order.");
      showAuthPanel("login");
      return;
    }

    const orderType = document.querySelector('input[name="kkr-order-type"]:checked')?.value || "delivery";
    const paymentMethod = document.querySelector('input[name="kkr-payment"]:checked')?.value || "cash";
    const name = $("[data-cf-name]")?.value.trim();
    const phone = $("[data-cf-phone]")?.value.trim();
    const email = $("[data-cf-email]")?.value.trim();
    const address = $("[data-cf-address]")?.value.trim();
    const addressLat = $("[data-cf-address-lat]")?.value;
    const addressLng = $("[data-cf-address-lng]")?.value;
    const notes = $("[data-cf-notes]")?.value.trim();
    const paymentReference = $("[data-cf-payment-ref]")?.value.trim();
    const paymentConfirmed = $("[data-cf-payment-confirm]")?.checked;

    if (!name || !phone) {
      setError("[data-order-error]", "Please enter your name and phone number.");
      return;
    }
    if (orderType === "delivery" && !address) {
      setError("[data-order-error]", "Please enter a delivery address.");
      return;
    }
    if (paymentMethod === "easypaisa" && (!paymentReference || !paymentConfirmed)) {
      setError(
        "[data-order-error]",
        "Please enter your Easypaisa transaction number and confirm you've sent the payment."
      );
      return;
    }

    const items = window.KKRCart.getItems().map((it) => ({
      id: it.menuItemId || it.id,
      variantId: it.variantId || null,
      quantity: it.qty,
    }));

    const turnstileToken = turnstileWidgetId !== null ? window.turnstile?.getResponse(turnstileWidgetId) : undefined;

    const sendBtn = $("[data-cart-send]");
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = "Placing order…";
    }

    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          orderType,
          paymentMethod,
          paymentReference: paymentMethod === "easypaisa" ? paymentReference : undefined,
          customer: { name, phone, email, address, notes },
          deliveryLat: addressLat || undefined,
          deliveryLng: addressLng || undefined,
          accessToken: session?.access_token,
          turnstileToken,
          idempotencyKey,
          couponCode: appliedCoupon?.code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not place order.");

      setText("[data-sent-order-number]", data.orderNumber);
      setText("[data-sent-total]", `Rs. ${fmt(data.total)}`);
      window.KKRCart.clear();
      $("[data-checkout-layout]").hidden = true;
      $("[data-checkout-empty]").hidden = true;
      $("[data-checkout-sent]").hidden = false;
    } catch (err) {
      setError("[data-order-error]", err.message || "Could not place order. Please try again.");
      // Turnstile tokens are single-use — a failed attempt needs a fresh
      // one before the customer can successfully retry.
      if (turnstileWidgetId !== null) window.turnstile?.reset(turnstileWidgetId);
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = "Place order";
      }
    }
  };

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-cart-send]")) {
      placeOrder();
      return;
    }
    if (e.target.closest("[data-coupon-apply]")) {
      applyCoupon();
      return;
    }
    if (e.target.closest("[data-coupon-remove]")) {
      appliedCoupon = null;
      $("[data-coupon-input]").value = "";
      $("[data-coupon-applied]").hidden = true;
      $("[data-coupon-error]").hidden = true;
      renderSummary();
      return;
    }
    const authShowBtn = e.target.closest("[data-auth-show]");
    if (authShowBtn) {
      showAuthPanel(authShowBtn.dataset.authShow);
      return;
    }
    if (e.target.closest("[data-logout-inline]")) {
      window.KKRAuth?.logout();
      renderAuthState();
      return;
    }
    if (e.target.closest("[data-login-submit]")) {
      const email = $("[data-login-email]")?.value.trim();
      const password = $("[data-login-password]")?.value;
      if (!email || !password) {
        setError("[data-login-error]", "Please enter your email and password.");
        return;
      }
      window.KKRAuth.login(email, password)
        .then(renderAuthState)
        .catch((err) => setError("[data-login-error]", err.message));
      return;
    }
    if (e.target.closest("[data-register-submit]")) {
      const name = $("[data-register-name]")?.value.trim();
      const phone = $("[data-register-phone]")?.value.trim();
      const email = $("[data-register-email]")?.value.trim();
      const password = $("[data-register-password]")?.value;
      if (!name || !phone || !email || !password) {
        setError("[data-register-error]", "Please fill in every field.");
        return;
      }
      if (password.length < 6) {
        setError("[data-register-error]", "Password must be at least 6 characters.");
        return;
      }
      window.KKRAuth.register(name, phone, email, password)
        .then(() => window.KKRAuth.login(email, password))
        .then(renderAuthState)
        .catch((err) => setError("[data-register-error]", err.message));
      return;
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.matches('input[name="kkr-order-type"]')) {
      renderOrderTypePanel();
      renderSummary();
    }
    if (e.target.matches('input[name="kkr-payment"]')) renderPaymentPanel();
  });

  if (window.KKRAuth) window.KKRAuth.onChange(renderAuthState);
  if (window.KKRCart) window.KKRCart.onChange(renderSummary);

  window.addEventListener("DOMContentLoaded", () => {
    renderSummary();
    renderAuthState();
    renderPaymentPanel();
    renderOrderTypePanel();
    fetchSettings();
    renderTurnstile();
  });
})();
