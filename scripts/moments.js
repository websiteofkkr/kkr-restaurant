(() => {
  "use strict";

  // ---- adjustable timing -----------------------------------------------
  // How long each group of videos stays on screen before auto-advancing,
  // in milliseconds. Change this one number to speed up or slow down the
  // rotation (5000 = 5 seconds, matching the requested "~5 seconds").
  const AUTO_ADVANCE_MS = 5000;
  // -------------------------------------------------------------------

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const buildMoment = (m) => `<article class="moment">
      <div class="moment__frame">
        <video class="moment__video" ${m.poster_url ? `poster="${escapeHtml(m.poster_url)}"` : ""} src="${escapeHtml(m.video_url)}"
          autoplay muted loop playsinline preload="metadata"
          aria-label="${escapeHtml(m.title)}"></video>
        ${m.duration_label ? `<span class="moment__time">${escapeHtml(m.duration_label)}</span>` : ""}
      </div>
      <h3>${escapeHtml(m.title)}</h3>
      ${m.subtitle ? `<p>${escapeHtml(m.subtitle)}</p>` : ""}
    </article>`;

  const initCarousel = () => {
    const carousel = document.querySelector("[data-moments-carousel]");
    if (!carousel) return;

    const viewport = carousel.querySelector("[data-moments-viewport]");
    const track = carousel.querySelector("[data-moments-track]");
    const prevBtn = carousel.querySelector("[data-moments-prev]");
    const nextBtn = carousel.querySelector("[data-moments-next]");
    const dotsWrap = document.querySelector("[data-moments-dots]");
    if (!viewport || !track || !dotsWrap) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The real clips, captured once (and re-captured if Supabase swaps in
    // live data) — kept separate from the track's actual DOM, since that
    // DOM gets rebuilt on every recalc to include spacer slots.
    let realItemsHTML = Array.from(track.children).map((el) => el.outerHTML);

    let itemsPerPage = 3;
    let currentPage = 0;
    let totalPages = 1;
    let autoTimer = null;
    let resumeTimer = null;

    // Matches the CSS breakpoints in .moments-carousel__track .moment —
    // keep these two in sync if the breakpoints change in the CSS.
    const getItemsPerPage = () => {
      const w = window.innerWidth;
      if (w <= 480) return 1;
      if (w <= 1024) return 2;
      return 4;
    };

    const applyTransform = () => {
      const items = Array.from(track.children);
      if (items.length === 0) return;
      const firstBox = items[0].getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const step = (firstBox.width + gap) * itemsPerPage;
      track.style.transform = `translateX(-${currentPage * step}px)`;
    };

    const updateDots = () => {
      Array.from(dotsWrap.children).forEach((dot, i) => dot.classList.toggle("is-active", i === currentPage));
    };

    const buildDots = () => {
      dotsWrap.innerHTML = "";
      if (totalPages <= 1) return; // nothing to paginate
      for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "moments-carousel__dot";
        dot.setAttribute("aria-label", `Go to moments group ${i + 1} of ${totalPages}`);
        if (i === currentPage) dot.classList.add("is-active");
        dot.addEventListener("click", () => {
          goToPage(i);
          restartAfterInteraction();
        });
        dotsWrap.appendChild(dot);
      }
    };

    const goToPage = (page) => {
      currentPage = ((page % totalPages) + totalPages) % totalPages;
      applyTransform();
      updateDots();
    };

    const next = () => goToPage(currentPage + 1);
    const prev = () => goToPage(currentPage - 1);

    const stopAuto = () => {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = null;
    };
    const startAuto = () => {
      stopAuto();
      if (reduceMotion || totalPages <= 1) return;
      autoTimer = setInterval(next, AUTO_ADVANCE_MS);
    };
    // Pausing then resuming after user interaction, rather than just
    // pausing forever, so the carousel keeps cycling on its own once
    // someone's done clicking around.
    const restartAfterInteraction = () => {
      stopAuto();
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, AUTO_ADVANCE_MS);
    };

    const recalc = () => {
      const realCount = realItemsHTML.length;
      if (realCount === 0) return;
      itemsPerPage = getItemsPerPage();
      totalPages = Math.max(1, Math.ceil(realCount / itemsPerPage));
      if (currentPage >= totalPages) currentPage = totalPages - 1;

      // Pad the final page out to a full page of slots with invisible
      // spacers, split evenly before/after the real remaining clips, so
      // they land centered in the viewport rather than stuck to one
      // side. Every earlier page is already full and needs no padding.
      const remainder = realCount % itemsPerPage;
      let html = realItemsHTML.join("");
      if (remainder !== 0) {
        const padCount = itemsPerPage - remainder;
        const before = Math.floor(padCount / 2);
        const after = Math.ceil(padCount / 2);
        const spacer = `<div class="moment moment--spacer" aria-hidden="true"></div>`;
        const items = realItemsHTML.slice();
        const lastGroup = items.splice(items.length - remainder, remainder);
        html = items.join("") + spacer.repeat(before) + lastGroup.join("") + spacer.repeat(after);
      }
      track.innerHTML = html;

      // Size the viewport to exactly fit itemsPerPage cards, no more, no
      // less — computed from the card's real current width rather than a
      // fixed guess, since the card's own CSS uses a viewport-relative
      // clamp() that changes continuously with screen width. A static
      // guess can never stay aligned with that at every size; this always
      // matches exactly, which is what stops a partial next card peeking
      // through the edge.
      const firstReal = track.querySelector(".moment:not(.moment--spacer)");
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const cardWidth = firstReal ? firstReal.getBoundingClientRect().width : 0;
      const exactWidth = cardWidth * itemsPerPage + gap * (itemsPerPage - 1);
      if (exactWidth > 0) viewport.style.maxWidth = `${exactWidth}px`;

      buildDots();
      applyTransform();
    };

    prevBtn?.addEventListener("click", () => {
      prev();
      restartAfterInteraction();
    });
    nextBtn?.addEventListener("click", () => {
      next();
      restartAfterInteraction();
    });

    // Pause on hover/focus (mouse users), resume on leave.
    carousel.addEventListener("mouseenter", stopAuto);
    carousel.addEventListener("mouseleave", startAuto);
    carousel.addEventListener("focusin", stopAuto);
    carousel.addEventListener("focusout", startAuto);

    // Touch swipe support.
    let touchStartX = 0;
    let touchDeltaX = 0;
    viewport.addEventListener(
      "touchstart",
      (e) => {
        touchStartX = e.touches[0].clientX;
        touchDeltaX = 0;
        stopAuto();
      },
      { passive: true }
    );
    viewport.addEventListener(
      "touchmove",
      (e) => {
        touchDeltaX = e.touches[0].clientX - touchStartX;
      },
      { passive: true }
    );
    viewport.addEventListener("touchend", () => {
      if (Math.abs(touchDeltaX) > 40) {
        if (touchDeltaX < 0) next();
        else prev();
      }
      restartAfterInteraction();
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(recalc, 150);
    });

    recalc();
    startAuto();

    // Exposed so the Supabase-refresh step below can swap in real
    // uploaded clips and re-run layout (recalc rebuilds the track's DOM
    // from realItemsHTML plus spacers, so this must go through here
    // rather than touching track.innerHTML directly).
    carousel.__momentsSetItems = (items) => {
      realItemsHTML = items;
      currentPage = 0;
      recalc();
    };
  };

  window.addEventListener("DOMContentLoaded", initCarousel);

  // ------------------------------------------------- optional live data
  // If real moments have been uploaded via the admin dashboard, swap them
  // in for the built-in default clips. No duplication needed here (that
  // was only ever for the old marquee's seamless-loop illusion) — the
  // carousel paginates whatever set of clips it's given.
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      if (!url) return;
      const res = await fetch(`${url}/rest/v1/moments?select=*&order=sort_order.asc`, { headers: { apikey: anonKey } });
      const moments = await res.json();
      if (!Array.isArray(moments) || moments.length === 0) return; // no uploads yet — keep the built-in default clips

      const carousel = document.querySelector("[data-moments-carousel]");
      if (!carousel) return;

      carousel.__momentsSetItems?.(moments.map(buildMoment));
    } catch {
      // A failed fetch just leaves the existing default clips in place.
    }
  });
})();
