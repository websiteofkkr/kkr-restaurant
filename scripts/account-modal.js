/**
 * Header "Account" modal — lets a customer log in, register, or see their
 * reward points at any time, completely independent of the cart or
 * checkout. Uses the shared session from scripts/auth.js (window.KKRAuth),
 * so logging in here means checkout already recognizes them afterwards,
 * and vice versa.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);
  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));

  const modal = () => $("[data-account-modal]");

  const openModal = () => {
    const m = modal();
    if (!m) return;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add("is-open"));
    document.body.classList.add("cart-drawer-open");
    render();
  };
  const closeModal = () => {
    const m = modal();
    if (!m) return;
    m.classList.remove("is-open");
    document.body.classList.remove("cart-drawer-open");
    setTimeout(() => {
      m.hidden = true;
    }, 250);
  };

  const showPanel = (name) => {
    $$("[data-account-panel]", modal()).forEach((el) => {
      el.hidden = el.dataset.accountPanel !== name;
    });
    $$("[data-acc-login-error],[data-acc-register-error]", modal()).forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
  };

  const setError = (sel, message) => {
    const el = $(sel, modal());
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  };

  const render = () => {
    if (!window.KKRAuth) return;
    const session = window.KKRAuth.getSession();
    if (session) {
      const nameEl = $("[data-acc-name]", modal());
      const pointsEl = $("[data-acc-points]", modal());
      if (nameEl) nameEl.textContent = session.profile?.full_name || session.user?.email || "you";
      if (pointsEl) pointsEl.textContent = String(session.profile?.reward_points ?? 0);
      showPanel("session");
    } else {
      showPanel("login");
    }
  };

  if (window.KKRAuth) window.KKRAuth.onChange(render);

  /* ----------------------------------------------- order-update indicator
     Lightweight, no extra backend: reuses the same "last seen status per
     order" map the My Orders page writes to. This just compares against
     it without updating it, so the dot stays on until the customer
     actually opens My Orders and sees the change for themselves. */
  const SEEN_KEY = "kkr-order-status-seen-v1";
  const checkForUpdates = async () => {
    const session = window.KKRAuth?.getSession();
    if (!session) return;
    try {
      const res = await fetch("/api/my-orders", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      let seen = {};
      try {
        seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
      } catch {
        /* ignore */
      }
      const hasUpdate = (data.orders || []).some((o) => {
        const fp = `${o.payment_status}:${o.order_status}`;
        const prev = seen[o.order_number];
        return prev !== undefined && prev !== fp;
      });
      document.querySelectorAll("[data-account-toggle]").forEach((btn) => {
        btn.classList.toggle("has-update", hasUpdate);
      });
    } catch {
      /* silently skip — this is a nice-to-have, not critical */
    }
  };

  window.addEventListener("DOMContentLoaded", checkForUpdates);
  if (window.KKRAuth) window.KKRAuth.onChange(checkForUpdates);

  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-account-toggle]")) {
      openModal();
      return;
    }
    if (e.target.closest("[data-account-close]")) {
      closeModal();
      return;
    }
    const showBtn = e.target.closest("[data-account-show]");
    if (showBtn) {
      showPanel(showBtn.dataset.accountShow);
      return;
    }
    if (e.target.closest("[data-acc-logout]")) {
      window.KKRAuth.logout();
      showPanel("login");
      return;
    }
    if (e.target.closest("[data-acc-login-submit]")) {
      const email = $("[data-acc-login-email]", modal())?.value.trim();
      const password = $("[data-acc-login-password]", modal())?.value;
      if (!email || !password) {
        setError("[data-acc-login-error]", "Please enter your email and password.");
        return;
      }
      try {
        await window.KKRAuth.login(email, password);
        render();
      } catch (err) {
        setError("[data-acc-login-error]", err.message);
      }
      return;
    }
    if (e.target.closest("[data-acc-register-submit]")) {
      const name = $("[data-acc-register-name]", modal())?.value.trim();
      const phone = $("[data-acc-register-phone]", modal())?.value.trim();
      const email = $("[data-acc-register-email]", modal())?.value.trim();
      const password = $("[data-acc-register-password]", modal())?.value;
      const address = $("[data-acc-register-address]", modal())?.value.trim();
      if (!name || !phone || !email || !password || !address) {
        setError("[data-acc-register-error]", "Please fill in every field, including your address.");
        return;
      }
      if (password.length < 6) {
        setError("[data-acc-register-error]", "Password must be at least 6 characters.");
        return;
      }
      try {
        await window.KKRAuth.register(name, phone, email, password);
        await window.KKRAuth.login(email, password);
        // Registration itself only captures name/phone (via Supabase auth
        // metadata) — the address goes into the profile as a normal
        // update, the same path My Account uses to change it later.
        const session = window.KKRAuth.getSession();
        if (session) {
          try {
            const { url, anonKey } = window.KKR_SUPABASE || {};
            const res = await fetch(`${url}/rest/v1/profiles?id=eq.${session.user.id}`, {
              method: "PATCH",
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({ default_address: address }),
            });
            const rows = await res.json();
            if (res.ok && rows[0]) {
              session.profile = rows[0];
              localStorage.setItem("kkr-session-v1", JSON.stringify(session));
            }
          } catch {
            // Non-fatal — the account exists either way; the address can
            // still be added later from My Account.
          }
        }
        render();
      } catch (err) {
        setError("[data-acc-register-error]", err.message);
      }
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
})();
