window.KKRCarousel = (() => {
  "use strict";

  /**
   * Creates a self-contained "always shows exactly N items per page"
   * carousel: auto-advances forward only (seamless loop via a cloned
   * first page, never snaps backward), centers a final page that has
   * fewer than a full page of items, sizes its viewport exactly to fit
   * N items with no partial next item peeking through, and rebuilds
   * itself automatically if the underlying item list changes (so adding
   * a 5th, 9th, 13th... item later just works, no code changes needed).
   *
   * config:
   *   root            - the outer carousel element
   *   viewport        - the overflow:hidden viewport element inside root
   *   track           - the flex row inside viewport that slides
   *   dotsWrap        - element to render pagination dots into (optional)
   *   itemSelector    - CSS selector matching one real item (e.g. ".moment")
   *   spacerClass     - class name to mark generated invisible spacer slots
   *   getItemsPerPage - () => number, how many items to show per page at
   *                     the current viewport width
   *   autoAdvanceMs   - milliseconds between automatic page turns
   */
  function create(config) {
    const { root, viewport, track, dotsWrap, itemSelector, spacerClass, getItemsPerPage, autoAdvanceMs = 5000 } = config;
    if (!root || !viewport || !track) return null;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let realItemsHTML = Array.from(track.querySelectorAll(itemSelector)).map((el) => el.outerHTML);
    let itemsPerPage = 1;
    let currentPage = 0;
    let totalPages = 1;
    let autoTimer = null;
    let resumeTimer = null;
    let wrapTimer = null;

    const applyTransform = (animate = true) => {
      const items = Array.from(track.children);
      if (items.length === 0) return;
      const firstBox = items[0].getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const step = (firstBox.width + gap) * itemsPerPage;
      track.style.transition = animate ? "" : "none";
      track.style.transform = `translateX(-${currentPage * step}px)`;
      if (!animate) void track.offsetWidth;
    };

    const updateDots = () => {
      if (!dotsWrap) return;
      const activeIndex = currentPage % totalPages;
      Array.from(dotsWrap.children).forEach((dot, i) => dot.classList.toggle("is-active", i === activeIndex));
    };

    const buildDots = () => {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = "";
      if (totalPages <= 1) return;
      for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "kkr-carousel__dot";
        dot.setAttribute("aria-label", `Go to group ${i + 1} of ${totalPages}`);
        if (i === currentPage) dot.classList.add("is-active");
        dot.addEventListener("click", () => {
          currentPage = i;
          applyTransform();
          updateDots();
          restartAfterInteraction();
        });
        dotsWrap.appendChild(dot);
      }
    };

    // Always advances forward (left), including the wrap from the last
    // page back to the first — see the Moments carousel for the full
    // rationale. In short: slide one page further into a cloned copy of
    // page 0 appended at the end, then instantly re-point to the real
    // page 0 once that slide finishes, which sits in the same visual
    // spot, so the loop point is invisible and motion never reverses.
    const next = () => {
      clearTimeout(wrapTimer);
      if (currentPage < totalPages - 1) {
        currentPage += 1;
        applyTransform();
        updateDots();
        return;
      }
      currentPage = totalPages;
      applyTransform();
      updateDots();
      wrapTimer = setTimeout(() => {
        currentPage = 0;
        applyTransform(false);
      }, 550);
    };

    const stopAuto = () => {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = null;
    };
    const startAuto = () => {
      stopAuto();
      if (reduceMotion || totalPages <= 1) return;
      autoTimer = setInterval(next, autoAdvanceMs);
    };
    const restartAfterInteraction = () => {
      stopAuto();
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, autoAdvanceMs);
    };

    const recalc = () => {
      const realCount = realItemsHTML.length;
      if (realCount === 0) return;
      itemsPerPage = Math.max(1, getItemsPerPage());
      totalPages = Math.max(1, Math.ceil(realCount / itemsPerPage));
      if (currentPage >= totalPages) currentPage = totalPages - 1;
      clearTimeout(wrapTimer);

      const remainder = realCount % itemsPerPage;
      let html = realItemsHTML.join("");
      if (remainder !== 0) {
        const padCount = itemsPerPage - remainder;
        const before = Math.floor(padCount / 2);
        const after = Math.ceil(padCount / 2);
        const spacer = `<div class="${spacerClass}" aria-hidden="true"></div>`;
        const items = realItemsHTML.slice();
        const lastGroup = items.splice(items.length - remainder, remainder);
        html = items.join("") + spacer.repeat(before) + lastGroup.join("") + spacer.repeat(after);
      }
      const page0Clone = realItemsHTML.slice(0, itemsPerPage).join("");
      track.innerHTML = html + page0Clone;

      const firstReal = track.querySelector(itemSelector);
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const cardWidth = firstReal ? firstReal.getBoundingClientRect().width : 0;
      const exactWidth = cardWidth * itemsPerPage + gap * (itemsPerPage - 1);
      if (exactWidth > 0) viewport.style.maxWidth = `${exactWidth}px`;

      buildDots();
      applyTransform();
    };

    root.addEventListener("mouseenter", stopAuto);
    root.addEventListener("mouseleave", startAuto);
    root.addEventListener("focusin", stopAuto);
    root.addEventListener("focusout", startAuto);

    let touchStartX = 0;
    let touchDeltaX = 0;
    viewport.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; touchDeltaX = 0; stopAuto(); }, { passive: true });
    viewport.addEventListener("touchmove", (e) => { touchDeltaX = e.touches[0].clientX - touchStartX; }, { passive: true });
    viewport.addEventListener("touchend", () => {
      if (Math.abs(touchDeltaX) > 40) next();
      restartAfterInteraction();
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(recalc, 150);
    });

    recalc();
    startAuto();

    // Images/fonts can still be settling at DOMContentLoaded time, which
    // is when this first runs — re-measure once everything has actually
    // finished loading, in case that shifted the real card width even
    // slightly (enough to misalign the viewport's exact-fit sizing).
    if (document.readyState === "complete") {
      recalc();
    } else {
      window.addEventListener("load", recalc, { once: true });
    }

    return {
      setItems(itemsHTML) {
        realItemsHTML = itemsHTML;
        currentPage = 0;
        recalc();
      },
    };
  }

  return { create };
})();
