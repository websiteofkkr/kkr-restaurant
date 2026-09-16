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

  // ---------------------------------------------------- public reveal
  const spawnPublicConfetti = () => {
    const container = $("[data-public-reveal-confetti]");
    if (!container) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const colors = ["#C9A35B", "#E7C982", "#ffffff", "#c0392b", "#2f9e44"];
    for (let i = 0; i < 90; i++) {
      const piece = document.createElement("span");
      piece.className = "reveal-confetti__piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      container.appendChild(piece);
    }
  };

  const runPublicCeremony = (winner) => {
    const overlay = $("[data-public-reveal-overlay]");
    if (!overlay) return;
    $("[data-public-reveal-confetti]").innerHTML = "";
    $("[data-public-reveal-month]").textContent = monthLabel(winner.contestMonth).toUpperCase();
    $("[data-public-reveal-photo]").src = winner.photoUrl;
    $("[data-public-reveal-photo]").alt = `Winning photo by @${winner.username}`;
    $("[data-public-reveal-username]").textContent = `@${winner.username}`;
    $("[data-public-reveal-prize]").textContent = winner.prizeDescription;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    spawnPublicConfetti();
  };

  const closePublicCeremony = () => {
    const overlay = $("[data-public-reveal-overlay]");
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = "";
  };
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-public-reveal-close]")) closePublicCeremony();
  });

  // ---------------------------------------------------- countdown
  let countdownInterval = null;
  let pollInterval = null;

  const renderCountdown = (targetIso, badgeEl) => {
    const update = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) {
        clearInterval(countdownInterval);
        badgeEl.innerHTML = `<span class="contest-announcing-soon">ANNOUNCING VERY SOON</span>`;
        startPollingForWinner();
        return;
      }
      const totalMinutes = Math.floor(diff / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      badgeEl.innerHTML = `
        <p class="contest-countdown__label">Winner announced in</p>
        <div class="contest-countdown__clock">
          <div class="contest-countdown__unit"><strong>${hours}</strong><span>Hours</span></div>
          <strong>:</strong>
          <div class="contest-countdown__unit"><strong>${String(minutes).padStart(2, "0")}</strong><span>Minutes</span></div>
        </div>`;
    };
    update();
    countdownInterval = setInterval(update, 30000);
  };

  const startPollingForWinner = () => {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/contest-winners");
        const data = await res.json();
        const thisMonth = currentMonthValue();
        const winner = (data.winners || []).find((w) => w.contestMonth === thisMonth);
        if (winner) {
          clearInterval(pollInterval);
          pollInterval = null;
          sessionStorage.setItem(`kkr-contest-ceremony-seen-${thisMonth}`, "1");
          runPublicCeremony(winner);
          // Refresh the section behind the overlay so it shows the real
          // winner once the ceremony is closed.
          setTimeout(() => location.reload(), 50);
        }
      } catch {
        /* try again next interval */
      }
    }, 20000);
  };

  window.addEventListener("DOMContentLoaded", async () => {
    const section = $("[data-contest-winner-section]");
    if (!section) return;
    try {
      const [winnersRes, statusRes] = await Promise.all([fetch("/api/contest-winners"), fetch("/api/contest-status")]);
      const data = await winnersRes.json();
      const status = await statusRes.json().catch(() => ({}));
      const winners = data.winners || [];
      const thisMonth = currentMonthValue();
      const currentWinner = winners.find((w) => w.contestMonth === thisMonth);

      if (currentWinner) {
        $("[data-contest-winner-photo]", section).src = currentWinner.photoUrl;
        $("[data-contest-winner-photo]", section).alt = `Winning photo by @${currentWinner.username}`;
        $("[data-contest-winner-username]", section).textContent = `@${currentWinner.username}`;
        $("[data-contest-winner-month]", section).textContent = `${monthLabel(currentWinner.contestMonth)} Winner`;
        $("[data-contest-winner-amount]", section).textContent = currentWinner.prizeDescription;

        // First time this browser sees this month's result (e.g. loaded
        // the page shortly after the admin published), play the
        // ceremony once rather than every visit.
        const seenKey = `kkr-contest-ceremony-seen-${thisMonth}`;
        if (!sessionStorage.getItem(seenKey) && status.revealAt) {
          sessionStorage.setItem(seenKey, "1");
          setTimeout(() => runPublicCeremony(currentWinner), 600);
        }
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
            <p class="contest-coming-soon__badge" data-contest-badge>WINNER ANNOUNCED SOON</p>
          </div>`;
        }
        const badgeEl = $("[data-contest-badge]", section);
        if (status.revealAt && badgeEl) {
          const targetTime = new Date(status.revealAt).getTime();
          if (targetTime > Date.now()) {
            renderCountdown(status.revealAt, badgeEl);
          } else {
            badgeEl.innerHTML = `<span class="contest-announcing-soon">ANNOUNCING VERY SOON</span>`;
            startPollingForWinner();
          }
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
                <figcaption>@${w.username}<br><span>${monthLabel(w.contestMonth)}</span><br><span class="contest-previous-winners__prize">${w.prizeDescription}</span></figcaption>
              </figure>`
            )
            .join("") +
          `</div>`;
      }

      // Always visible — either a real winner or the "coming soon" state,
      // both are worth showing (Part 3/9: the section is permanent).
      section.hidden = false;

      // Fade/slide the section in the first time it scrolls into view,
      // rather than animating immediately on page load off-screen.
      const inner = $(".contest-winner-section__inner", section);
      if (inner && "IntersectionObserver" in window) {
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                inner.classList.add("is-visible");
                io.disconnect();
              }
            });
          },
          { threshold: 0.2 }
        );
        io.observe(inner);
      } else if (inner) {
        inner.classList.add("is-visible");
      }
    } catch {
      // No section shows if this fails — the rest of the page is unaffected.
    }
  });
})();
