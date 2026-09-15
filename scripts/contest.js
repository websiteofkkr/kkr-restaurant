(() => {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const openModal = (attr) => {
    const m = $(`[data-${attr}-modal]`);
    if (!m) return;
    m.hidden = false;
    document.body.classList.add("cart-drawer-open");
    requestAnimationFrame(() => m.classList.add("is-open"));
  };
  const closeModal = (attr) => {
    const m = $(`[data-${attr}-modal]`);
    if (!m) return;
    m.classList.remove("is-open");
    document.body.classList.remove("cart-drawer-open");
    setTimeout(() => {
      m.hidden = true;
    }, 300);
  };

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-contest-open]")) {
      openModal("contest");
      return;
    }
    if (e.target.closest("[data-contest-close]")) {
      closeModal("contest");
      return;
    }
    if (e.target.closest("[data-contest-howitworks]")) {
      openModal("contest-howitworks");
      return;
    }
    if (e.target.closest("[data-contest-howitworks-close]")) {
      closeModal("contest-howitworks");
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeModal("contest");
    closeModal("contest-howitworks");
  });

  // ------------------------------------------------------------- submit
  const form = $("[data-contest-form]");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = $("[data-contest-status]", form);
      const submitBtn = $('button[type="submit"]', form);

      const consent = $('input[name="consent"]', form)?.checked;
      if (!consent) {
        status.className = "form__status is-error";
        status.textContent = "Please confirm the photo permission checkbox.";
        return;
      }

      status.className = "form__status";
      status.textContent = "Submitting…";
      submitBtn.disabled = true;

      try {
        const formData = new FormData(form);
        // Checkboxes only appear in FormData when checked, but the
        // server checks for an explicit "true" — set it plainly.
        formData.set("consent", "true");
        const res = await fetch("/api/contest-entry", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not submit your entry.");

        status.className = "form__status is-ok";
        status.textContent = "Thank you! Your KKR moment has been entered into this month's Photo of the Month contest.";
        form.reset();
        setTimeout(() => closeModal("contest"), 2500);
      } catch (err) {
        status.className = "form__status is-error";
        status.textContent = err.message;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // --------------------------------------------------- public winner UI
  const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", snapchat: "Snapchat", x: "X", youtube: "YouTube", other: "" };
  const monthLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
  };
  const currentMonthValue = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };

  window.addEventListener("DOMContentLoaded", async () => {
    const section = $("[data-contest-winner-section]");
    if (!section) return;
    try {
      const res = await fetch("/api/contest-winners");
      const data = await res.json();
      const winners = data.winners || [];
      const thisMonth = currentMonthValue();
      const currentWinner = winners.find((w) => w.contestMonth === thisMonth);

      if (currentWinner) {
        $("[data-contest-winner-photo]", section).src = currentWinner.photoUrl;
        $("[data-contest-winner-photo]", section).alt = `Winning photo by @${currentWinner.username}`;
        $("[data-contest-winner-username]", section).textContent = `@${currentWinner.username}`;
        $("[data-contest-winner-month]", section).textContent = `${monthLabel(currentWinner.contestMonth)} Winner`;
        $("[data-contest-winner-amount]", section).textContent = "PKR 5,000 KKR Dining Credit";
      } else {
        // No published winner for the current month yet — show the
        // "coming soon" state rather than an empty/stale section, and
        // never a placeholder photo (spec: "Do not show a fake winner").
        const grid = $(".contest-winner-section__grid", section);
        if (grid) {
          grid.innerHTML = `<div class="contest-coming-soon">
            <p class="contest-coming-soon__month">${monthLabel(thisMonth)}</p>
            <p class="contest-coming-soon__lead">We're looking for our next KKR Photo of the Month.</p>
            <p>Share your KKR moment for a chance to win.</p>
            <p class="contest-coming-soon__badge">WINNER ANNOUNCED SOON</p>
          </div>`;
        }
      }

      const previous = winners.filter((w) => w.contestMonth !== thisMonth || !currentWinner);
      if (previous.length > 0) {
        const wrap = $("[data-contest-previous-winners]", section);
        wrap.innerHTML =
          `<h3>Previous Winners</h3><div class="contest-previous-winners__grid">` +
          previous
            .map(
              (w) => `<figure>
                <img src="${w.photoUrl}" alt="Winning photo by @${w.username}" loading="lazy">
                <figcaption>@${w.username}<br><span>${monthLabel(w.contestMonth)}</span></figcaption>
              </figure>`
            )
            .join("") +
          `</div>`;
      }

      // Always visible — either a real winner or the "coming soon" state,
      // both are worth showing (Part 3/9: the section is permanent).
      section.hidden = false;
    } catch {
      // No section shows if this fails — the rest of the page is unaffected.
    }
  });
})();
