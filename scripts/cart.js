/**
 * KKR cart — Stage 1 of the ordering system (see build notes).
 *
 * A single cart, shared by every "Add to cart" control on the site — the
 * homepage tabs and the full menu page both write to the same store, keyed
 * by the same stable item ID, so adding "Chicken Karahi" from either place
 * adds to the same line.
 *
 * Deliberately dumb about money: this file only ever deals with the price
 * the page told it about when the button was clicked. It is NOT the source
 * of truth for checkout — Section 31 of the ordering spec is explicit that
 * the server must re-price and re-validate everything at checkout, since a
 * browser can always be tampered with. This is a shopping-list, not a bill.
 *
 * Storage: sessionStorage under "kkr-cart-v1" (clears when the browser or tab closes, by design). Plain JSON, an array of
 * { id, name, image, alt, price, qty }. No cross-tab sync beyond what the
 * "storage" event gives for free (see below).
 */

(() => {
  "use strict";

  /** Resolve a stored root-absolute path against the page's base, if set. */
  const BASE = (document.documentElement.getAttribute("data-base") || "").replace(/\/$/, "");

  /**
   * Absolute paths like "/assets/img/menu/x.webp" only resolve correctly
   * when the site is served from its own root by a real web server. Opened
   * directly as a file (file://), a leading "/" instead points at the
   * filesystem root and the image 404s. To make images work either way,
   * compute the site's actual root from wherever this very script
   * (scripts/cart.js) was loaded from, then resolve absolute-looking paths
   * against that instead of trusting the leading "/" literally. On a real
   * server this resolves to exactly the same URL as before — this only
   * changes behaviour for the file:// case, which previously just broke.
   */
  const SITE_ROOT = (() => {
    try {
      const scriptEl =
        document.currentScript ||
        Array.from(document.scripts).find((s) => /\/scripts\/cart\.js(\?|$)/.test(s.src));
      if (!scriptEl) return null;
      // scriptEl.src resolves to ".../scripts/cart.js" — one directory up
      // from "scripts/" is the site root.
      return new URL("../", scriptEl.src).href;
    } catch {
      return null;
    }
  })();

  const srcOf = (p) => {
    if (typeof p !== "string" || !p.startsWith("/")) return p;
    if (BASE) return BASE + p;
    if (SITE_ROOT) return new URL(p.slice(1), SITE_ROOT).href;
    return p;
  };

  const STORAGE_KEY = "kkr-cart-v1";

  /* Free delivery past Rs. 1,000, a flat Rs. 200 under that — kept as
     named constants in one place since checkout will need the exact same
     numbers later (though, per Section 31, the server recalculates this
     for real rather than trusting whatever the browser sends). */
  const FREE_DELIVERY_THRESHOLD = 1000;
  const STANDARD_DELIVERY = 200;
  // No tax requirement/rate has been provided yet — the server (see
  // functions/api/order.js) uses 0 until KKR gives a real figure, and this
  // client-side estimate mirrors that so the number shown while shopping
  // never disagrees with what's actually charged.
  const SALES_TAX_RATE = 0;

  const $ = (sel, root = document) => (root || document).querySelector(sel);
  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));

  /* ---------------------------------------------------------------- store */

  const load = () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(parsed) ? parsed : [];
      /* Carts saved before a page-relative image path bug was fixed can
         still have "../assets/..." or "../../assets/..." stuck in
         sessionStorage from earlier in this browser session — that's what a broken image
         in an otherwise-working cart usually is. Repairing it back to a
         root-relative path here means an old cart heals itself the next
         time the page loads, instead of needing the customer to clear
         their cart manually. */
      let migrated = false;
      arr.forEach((it) => {
        // Was /^\.\.\/+/ — only stripped one "../" segment, so an item
        // added from a page nested two levels deep (like /menu/, whose
        // paths look like "../../assets/...") only got half-fixed to
        // "../assets/...", still broken. (\.\.\/)+  matches the whole
        // repeated run regardless of how many levels deep it was added
        // from.
        if (typeof it.image === "string" && /^(\.\.\/)+/.test(it.image)) {
          it.image = it.image.replace(/^(\.\.\/)+/, "/");
          migrated = true;
        }
      });
      if (migrated) {
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        } catch {
          /* Non-fatal — the in-memory copy is already fixed for this
             session even if it couldn't be persisted. */
        }
      }
      return arr;
    } catch {
      return [];
    }
  };

  let items = load();
  let currentView = "cart"; // "cart" | "checkout" | "sent" — see showView below
  const listeners = new Set();

  const persist = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* Storage can fail (private browsing, quota) — the cart still works
         for the rest of this page load, it just won't survive a reload. */
    }
    listeners.forEach((fn) => fn(items));
  };

  const find = (id) => items.find((it) => it.id === id);

  const add = (id, meta, qty = 1) => {
    const existing = find(id);
    if (existing) {
      existing.qty += qty;
      // A later add can carry a different tier/price (the customer changed
      // the size dropdown) — the newest choice wins for that line.
      if (meta.price) existing.price = meta.price;
    } else {
      items.push({ id, qty, ...meta });
    }
    persist();
  };

  const setQty = (id, qty) => {
    const it = find(id);
    if (!it) return;
    if (qty <= 0) {
      items = items.filter((x) => x.id !== id);
    } else {
      it.qty = qty;
    }
    persist();
  };

  const remove = (id) => {
    items = items.filter((x) => x.id !== id);
    persist();
  };

  const clear = () => {
    items = [];
    persist();
  };

  const count = () => items.reduce((n, it) => n + it.qty, 0);
  const subtotal = () => items.reduce((n, it) => n + it.qty * it.price, 0);

  /* React to the cart changing in another tab (e.g. checkout completed
     there) without needing a full reload here. */
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    items = load();
    listeners.forEach((fn) => fn(items));
  });

  /** Public API — kept on window so a later checkout page (Stage 4+) can
      read the cart without re-implementing any of this. */
  window.KKRCart = {
    getItems: () => items.map((it) => ({ ...it })),
    getCount: count,
    getSubtotal: subtotal,
    add,
    setQty,
    remove,
    clear,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  /* ------------------------------------------------------------- number
     formatting. The site already writes prices as plain digit strings
     ("1,800"), so this matches that instead of introducing a currency
     symbol nothing else on the page uses. */
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  /* --------------------------------------------------------- UI strings
     Pulled from the page itself rather than duplicated in this file, so a
     translation only ever has to be edited once (in ui.json). */
  const dict = () => {
    const el = document.getElementById("cart-strings");
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || "{}");
    } catch {
      return {};
    }
  };

  /* ------------------------------------------------------------ toast
     A brief, unobtrusive confirmation — the spec asks for this rather than
     forcing the customer off the page they were browsing. */
  let toastTimer = null;
  const toast = (message) => {
    let el = $(".cart-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "cart-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
  };

  /* ------------------------------------------------------------- render */

  const renderBadge = () => {
    $$("[data-cart-count]").forEach((el) => {
      const n = count();
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  };

  const renderDrawer = () => {
    const body = $("[data-cart-body]");
    if (!body) return; // drawer markup not on every page variant
    const list = $("[data-cart-items]", body);
    const subtotalEl = $("[data-cart-subtotal]");
    const t = dict();

    list.innerHTML = items
      .map(
        (it) => `<li class="cart-line" data-cart-line="${esc(it.id)}">
      ${it.image ? `<img class="cart-line__img" src="${esc(srcOf(it.image))}" alt="${esc(it.alt || it.name)}" width="64" height="64" loading="lazy" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'cart-line__img cart-line__img--fallback'}))">` : `<div class="cart-line__img cart-line__img--fallback"></div>`}
      <div class="cart-line__body">
        <p class="cart-line__name">${esc(it.name)}</p>
        <p class="cart-line__price">${fmt(it.price)} <span class="cart-line__each">${esc(t.each || "")}</span></p>
        <div class="cart-line__qty" role="group" aria-label="${esc(t.quantity || "Quantity")}">
          <button type="button" class="cart-line__step" data-cart-dec aria-label="-">−</button>
          <span class="cart-line__qty-value">${it.qty}</span>
          <button type="button" class="cart-line__step" data-cart-inc aria-label="+">+</button>
        </div>
      </div>
      <button type="button" class="cart-line__remove" data-cart-remove aria-label="${esc(t.remove || "Remove")}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12a2 2 0 0 1-2 1.8H9.8a2 2 0 0 1-2-1.8L7 7"/></svg>
      </button>
    </li>`
      )
      .join("");

    if (subtotalEl) subtotalEl.textContent = fmt(subtotal());

    /* A preview only — Section 31 of the ordering spec is explicit that
       the real total must always be computed server-side at checkout,
       never trusted from the browser. This just shows the customer what
       to expect while they're still browsing the cart. Free delivery
       past Rs. 1,000, a flat Rs. 200 under that, plus a 5% sales tax on
       the food subtotal (not on delivery). */
    const sub = subtotal();
    const tax = Math.round(sub * SALES_TAX_RATE);
    const delivery = sub > FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY;
    const taxEl = $("[data-cart-tax]");
    const deliveryEl = $("[data-cart-delivery]");
    const totalEl = $("[data-cart-total]");
    if (taxEl) taxEl.textContent = fmt(tax);
    if (deliveryEl) deliveryEl.textContent = delivery === 0 ? t.free || "Free" : fmt(delivery);
    if (totalEl) totalEl.textContent = fmt(sub + tax + delivery);

    // Visibility (empty state vs. list, which foot buttons show) is all
    // driven from one place — see showView below — so a cart update while
    // the customer is mid-checkout doesn't yank them back to the plain
    // cart view just because a quantity changed underneath them.
    showView(currentView);
  };

  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const renderAll = () => {
    renderBadge();
    renderDrawer();
  };

  window.KKRCart.onChange(renderAll);

  /* --------------------------------------------------------- drawer open/close */

  const openDrawer = () => {
    const drawer = $("[data-cart-drawer]");
    if (!drawer) return;
    showView("cart");
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    document.body.classList.add("cart-drawer-open");
  };
  const closeDrawer = () => {
    const drawer = $("[data-cart-drawer]");
    if (!drawer) return;
    drawer.classList.remove("is-open");
    document.body.classList.remove("cart-drawer-open");
    setTimeout(() => {
      if (!drawer.classList.contains("is-open")) drawer.hidden = true;
    }, 320);
  };

  /* -------------------------------------------------------- fly to cart
     A small clone of the dish photo arcs from wherever it was clicked to
     the cart icon and shrinks away — the "yes, it actually moved into the
     cart" feeling the toast and button label alone didn't give. Purely
     decorative: it never blocks clicks (pointer-events: none) and cleans
     itself up even if the transition event is missed for some reason. */
  const flyToCart = (imgSrc, fromRect) => {
    const target = $("[data-cart-toggle]");
    if (!target) return;
    const toRect = target.getBoundingClientRect();
    if (!toRect.width) return;

    const flyer = document.createElement(imgSrc ? "img" : "div");
    flyer.className = "cart-flyer";
    if (imgSrc) {
      flyer.src = imgSrc;
      flyer.alt = "";
    }
    flyer.style.left = `${fromRect.left}px`;
    flyer.style.top = `${fromRect.top}px`;
    flyer.style.width = `${fromRect.width}px`;
    flyer.style.height = `${fromRect.height}px`;
    document.body.appendChild(flyer);

    const cleanup = () => flyer.remove();
    flyer.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 1000); // fallback in case the transition never fires

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const size = 22;
        flyer.style.left = `${toRect.left + toRect.width / 2 - size / 2}px`;
        flyer.style.top = `${toRect.top + toRect.height / 2 - size / 2}px`;
        flyer.style.width = `${size}px`;
        flyer.style.height = `${size}px`;
        flyer.style.opacity = "0.2";
        flyer.classList.add("is-flying");
      });
    });

    setTimeout(() => {
      target.classList.add("cart-toggle--bump");
      setTimeout(() => target.classList.remove("cart-toggle--bump"), 400);
    }, 550);
  };

  /* ------------------------------------------------------------ checkout
     The full checkout experience (login/guest, order type, customer
     details, payment, and order submission) now lives on its own page —
     /en/checkout/ — where there's room to lay it out properly instead of
     squeezing it into this narrow drawer. This drawer just shows what's in
     the cart and hands off to that page. See scripts/checkout.js. */
  const showView = (view) => {
    currentView = view;
    const body = $("[data-cart-body]");
    if (!body) return;
    const empty = $("[data-cart-empty]", body);
    const itemsList = $("[data-cart-items]", body);
    const hasItems = window.KKRCart.getCount() > 0;
    const foot = $("[data-cart-foot]");

    if (empty) empty.hidden = hasItems;
    if (itemsList) itemsList.hidden = !hasItems;
    if (foot) foot.hidden = !hasItems;
  };

  const drawer = () => $("[data-cart-drawer]");

  /** A short "logged in as…" line in the drawer footer, so the customer
      can see their own login state without having to open checkout first.
      Actually logging in happens either from the header account modal
      (scripts/account-modal.js) or on the checkout page itself. */
  const renderSessionLine = () => {
    const el = $("[data-cart-session-line]", drawer());
    if (!el || !window.KKRAuth) return;
    const session = window.KKRAuth.getSession();
    if (session) {
      el.hidden = false;
      el.textContent = `Logged in as ${session.profile?.full_name || session.user?.email || "you"}`;
    } else {
      el.hidden = true;
    }
  };

  if (window.KKRAuth) window.KKRAuth.onChange(renderSessionLine);

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-cart-toggle]")) {
      openDrawer();
      renderSessionLine();
      return;
    }
    if (e.target.closest("[data-cart-close]")) {
      closeDrawer();
      return;
    }


    const line = e.target.closest("[data-cart-line]");
    if (line) {
      const id = line.dataset.cartLine;
      if (e.target.closest("[data-cart-inc]")) {
        const it = window.KKRCart.getItems().find((x) => x.id === id);
        if (it) window.KKRCart.setQty(id, it.qty + 1);
      } else if (e.target.closest("[data-cart-dec]")) {
        const it = window.KKRCart.getItems().find((x) => x.id === id);
        if (it) window.KKRCart.setQty(id, it.qty - 1);
      } else if (e.target.closest("[data-cart-remove]")) {
        window.KKRCart.remove(id);
      }
      return;
    }

    /* Add to cart, from any card on any page. Wrapped defensively: if
       something genuinely unexpected throws here, it's logged instead of
       just silently doing nothing, since "click did nothing" is otherwise
       impossible to tell apart from "click was never wired up". */
    try {
      const addBtn = e.target.closest(".cart-add__btn");
      if (addBtn && !addBtn.disabled) {
        const wrap = addBtn.closest(".cart-add");
        if (!wrap) return;
        const tierField = $(".cart-add__tier", wrap);
        const price = Number(tierField?.value || 0);
        if (!price) {
          console.warn("KKRCart: add-to-cart button had no readable price", wrap.dataset);
          return;
        }
        const { itemId, itemName, itemImage, itemAlt } = wrap.dataset;
        if (!itemId) {
          console.warn("KKRCart: add-to-cart button had no item id", wrap.dataset);
          return;
        }

        // A <select> tier means this item has size/variant options (e.g.
        // Single / Family soup). The variant's own id — slugified from its
        // label, matching how menu.json was built — has to travel with the
        // cart line, since the server validates against that id, not just
        // a price. Each variant also needs to be its own line: adding
        // "Family" after "Single" must not silently merge into one line at
        // whichever price was picked last.
        let variantId = null, variantName = null, lineName = itemName;
        if (tierField && tierField.tagName === "SELECT") {
          const opt = tierField.options[tierField.selectedIndex];
          const label = (opt?.textContent || "").split(/\s*—/)[0].trim();
          variantName = label || null;
          variantId = label
            ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
            : null;
          if (variantName) lineName = `${itemName} — ${variantName}`;
        }
        const lineId = variantId ? `${itemId}--${variantId}` : itemId;

        window.KKRCart.add(
          lineId,
          {
            name: lineName,
            image: itemImage || "",
            alt: itemAlt || itemName,
            price,
            menuItemId: itemId,
            variantId,
            variantName,
          },
          1
        );

        const t = dict();
        toast((t.itemAdded || "{name} added to cart").replace("{name}", itemName));

        const img = wrap.closest("li, article")?.querySelector("img");
        flyToCart(itemImage || img?.src || "", (img || addBtn).getBoundingClientRect());

        addBtn.classList.add("is-added");
        /* The label swap is the unmistakable part — a border/background
           tint alone is easy to miss, especially since the button often
           already looks similar mid-hover. Swapping the text to a checkmark
           message makes "yes, that worked" obvious even at a glance, then
           the original label returns once the confirmation has had time to
           register. */
        const label = $(".cart-add__label", addBtn);
        const originalLabel = label ? label.textContent : null;
        if (label) label.textContent = t.added ? `✓ ${t.added}` : "✓ Added";
        setTimeout(() => {
          addBtn.classList.remove("is-added");
          if (label && originalLabel !== null) label.textContent = originalLabel;
        }, 1400);

        /* The click leaves the button holding keyboard focus, and the pop
           effect on the card around it also triggers on :focus-within (for
           keyboard users tabbing to the button) — so without this, the card
           stayed enlarged after the click even once the mouse moved away,
           because focus doesn't clear itself. Blurring right after the click
           is handled lets the pop revert exactly like a normal mouse-leave,
           while tabbing to the button with a keyboard still shows it fine
           (this only fires after a real click, never on focus itself). */
        addBtn.blur();
      }
    } catch (err) {
      console.error("KKRCart: add-to-cart click failed", err);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  // Session state (login/profile) is now owned entirely by scripts/auth.js
  // — this file just reflects it via renderSessionLine() above.
  renderSessionLine();

  renderAll();
})();
