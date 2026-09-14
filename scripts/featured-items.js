(() => {
  "use strict";

  const SECTION_SELECTORS = {
    signature: "#signature .favgrid",
    favourites: "#favourites .favgrid",
  };

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const buildCard = (item, blurb) => {
    const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
    const priceRow = hasVariants
      ? ""
      : `<p class="favcard__price">Rs ${Number(item.price).toLocaleString()}</p>`;
    const tierField = hasVariants
      ? `<select class="cart-add__tier" aria-label="Quantity">${item.variants
          .map((v) => `<option value="${v.price}">${escapeHtml(v.name)} — Rs ${Number(v.price).toLocaleString()}</option>`)
          .join("")}</select>`
      : `<input type="hidden" class="cart-add__tier" value="${item.price}">`;
    return `<article class="favcard">
      <div class="favcard__media">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.alt || item.name)}" width="640" height="480" loading="lazy" decoding="async">
      </div>
      <div class="favcard__body">
        <h3>${escapeHtml(item.name)}</h3>
        ${blurb ? `<p>${escapeHtml(blurb)}</p>` : ""}
        <div class="favcard__foot">
          ${priceRow}
          <div class="cart-add" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}" data-item-image="${escapeHtml(item.image)}" data-item-alt="${escapeHtml(item.alt || item.name)}">
            ${tierField}
            <button type="button" class="btn btn--ghost cart-add__btn">
              <span class="cart-add__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.3l2.2 11.4a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L20.5 7H6"/></svg></span>
              <span class="cart-add__label">Add to cart</span>
            </button>
          </div>
          <a class="favcard__viewmenu" href="../en/menu/index.html">View Menu <span aria-hidden="true">&rarr;</span></a>
        </div>
      </div>
    </article>`;
  };

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;

      const [featuredRes, menuRes] = await Promise.all([
        fetch(`${url}/rest/v1/featured_items?select=*&order=sort_order.asc`, { headers: { apikey: anonKey } }),
        fetch("/menu.json"),
      ]);
      const featured = await featuredRes.json();
      const menu = await menuRes.json();
      const itemsById = new Map();
      (menu.categories || []).forEach((cat) => (cat.items || []).forEach((it) => itemsById.set(it.id, it)));

      ["signature", "favourites"].forEach((section) => {
        const list = featured.filter((f) => f.section === section);
        if (list.length === 0) return; // no admin-featured items — leave the hardcoded fallback cards as-is
        const grid = document.querySelector(SECTION_SELECTORS[section]);
        if (!grid) return;
        const html = list
          .map((f) => {
            const item = itemsById.get(f.item_id);
            return item ? buildCard(item, f.blurb) : "";
          })
          .join("");
        if (html) grid.innerHTML = html;
      });
    } catch {
      // If this fails for any reason, the hardcoded fallback cards already
      // in the HTML just stay as they are — nothing else breaks.
    }
  });
})();
