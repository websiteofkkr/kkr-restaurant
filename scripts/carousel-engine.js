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
    // The last known-good measurement, validated in recalc() — see the
    // sanity check there. applyTransform() runs on every single page
    // turn (every auto-advance cycle, every dot click), and re-measuring
    // fresh each time was a second, unguarded path into the exact same
    // corrupted-layout race that recalc() now protects against: a bad
    // reading here doesn't just mis-size a spacer, it slides the whole
    // track to the wrong position outright, which is exactly what
    // "the gap comes back after the page has been cycling for a while"
    // looks like. Trusting the validated measurement here instead of
    // re-reading the DOM removes that second path entirely.
    let lastGoodCardWidth = 0;
    let lastGoodGap = 0;

    const applyTransform = (animate = true) => {
      const items = Array.from(track.children);
      if (items.length === 0) return;
      const step = (lastGoodCardWidth + lastGoodGap) * itemsPerPage;
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
      if (totalPages <= 1) return; // nothing to advance to — a stale timer from before an update should be a no-op, not slide into empty space
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

    const recalc = (isRetry) => {
      const realCount = realItemsHTML.length;
      if (realCount === 0) return;
      itemsPerPage = Math.max(1, getItemsPerPage());
      totalPages = Math.max(1, Math.ceil(realCount / itemsPerPage));
      if (currentPage >= totalPages) currentPage = totalPages - 1;
      clearTimeout(wrapTimer);

      // First pass: render without spacers, purely to measure the real
      // rendered card width (depends on the current viewport, font size,
      // etc. — not something to hardcode). Critically, this must happen
      // with no max-width constraint on the viewport first: the cards
      // use min-width:0 so they *can* shrink to fit a container, and a
      // leftover max-width from an earlier recalc (however it got set)
      // would squeeze them below their real CSS size right before
      // measuring — producing a too-small cardWidth that then gets baked
      // into a new, equally-wrong max-width, which the next recalc
      // measures against again. Clearing it first breaks that loop.
      viewport.style.maxWidth = "none";
      const page0Clone = realItemsHTML.slice(0, itemsPerPage).join("");
      track.innerHTML = realItemsHTML.join("") + page0Clone;
      const firstReal = track.querySelector(itemSelector);
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const cardWidth = firstReal ? firstReal.getBoundingClientRect().width : 0;

      // No real card on this site is ever anywhere close to this narrow —
      // a measurement this low (including exactly 0, e.g. the element
      // briefly not being found at all) means layout hadn't actually
      // settled yet (a concurrent reflow from something else touching
      // the page at the same moment, a style recalculation still in
      // flight, web fonts still swapping in, etc.). A single animation
      // frame has repeatedly not been enough time for that to resolve in
      // practice, so retry several times with a short real delay between
      // attempts (not just the next paint), giving genuinely more time
      // for whatever's competing for layout to finish — bounded, so a
      // page that's ever genuinely this narrow for an unrelated reason
      // doesn't retry forever.
      const retryCount = typeof isRetry === "number" ? isRetry : 0;
      if (cardWidth < 60 && retryCount < 6) {
        setTimeout(() => recalc(retryCount + 1), 120);
        return;
      }
      // Even after every retry, don't let a still-bad (or still-zero)
      // reading overwrite a previously-trusted value, or feed the
      // spacer/viewport math below — fall back to the last good
      // measurement for everything in this pass too, rather than only
      // protecting future calls. If there has never been a good
      // measurement at all yet, there's nothing to fall back to and
      // genuinely nothing renderable this pass — bail out entirely
      // rather than build a zero-width spacer/viewport, and try once
      // more shortly after in case the page is just still settling.
      if (cardWidth < 60 && lastGoodCardWidth === 0) {
        setTimeout(() => recalc(0), 500);
        return;
      }
      const effectiveCardWidth = cardWidth >= 60 ? cardWidth : lastGoodCardWidth;
      const effectiveGap = cardWidth >= 60 ? gap : lastGoodGap;
      lastGoodCardWidth = effectiveCardWidth;
      lastGoodGap = effectiveGap;

      if (totalPages <= 1) {
        // Everything fits on a single page — the common "fewer than a
        // full page of items" case. Rather than padding out to a full
        // itemsPerPage-wide frame with calculated spacers (more moving
        // parts, more chances for a pixel-math mistake), just size the
        // viewport to exactly the real items themselves and drop the
        // clone entirely — there's nothing to page through, so there's
        // nothing to loop. The outer .kkr-carousel's own
        // justify-content:center then centers this narrower viewport
        // directly, with no spacer arithmetic involved at all.
        track.innerHTML = realItemsHTML.join("");
        const exactWidth = effectiveCardWidth * realCount + effectiveGap * Math.max(0, realCount - 1);
        if (exactWidth > 0) viewport.style.maxWidth = `${exactWidth}px`;
        buildDots();
        applyTransform();
        startAuto();
        return;
      }

      const remainder = realCount % itemsPerPage;
      if (remainder !== 0 && effectiveCardWidth > 0) {
        // Center the leftover cards on the final page using exactly one
        // spacer on each side, each sized to precisely half the missing
        // width — rather than whole-card-width spacers split by
        // floor/ceil, which is only symmetric when the leftover count is
        // even. A single leftover item in a 4-up page, for example,
        // needs 1.5 card-widths of space on each side; two whole spacers
        // can never express that "half a card" — one correctly-sized
        // spacer on each side always can, for any remainder.
        //
        // The padded "page" is [spacer, real x remainder, spacer] — that's
        // (remainder + 2) elements and (remainder + 1) gaps between them.
        // Solving for the spacer width that makes this whole sequence
        // exactly as wide as a normal full page of itemsPerPage cards
        // (padCount = itemsPerPage - remainder missing cards' worth):
        //   2*spacerWidth = padCount*cardWidth + (padCount - 2)*gap
        const padCount = itemsPerPage - remainder;
        const halfPad = Math.max(0, (padCount * effectiveCardWidth + (padCount - 2) * effectiveGap) / 2);
        const spacer = (w) => `<div class="${spacerClass}" aria-hidden="true" style="flex:0 0 ${w}px !important;"></div>`;
        const items = realItemsHTML.slice();
        const lastGroup = items.splice(items.length - remainder, remainder);
        track.innerHTML = items.join("") + spacer(halfPad) + lastGroup.join("") + spacer(halfPad) + page0Clone;
      }

      const exactWidth = effectiveCardWidth * itemsPerPage + effectiveGap * (itemsPerPage - 1);
      if (exactWidth > 0) viewport.style.maxWidth = `${exactWidth}px`;

      buildDots();
      applyTransform();
      startAuto();
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
