(() => {
  "use strict";

  const AUTO_ADVANCE_MS = 5000;

  const getItemsPerPage = () => {
    const w = window.innerWidth;
    if (w <= 480) return 1;
    if (w <= 1024) return 2;
    return 4;
  };

  // Keyed by section name ("platters" / "favourites") so admin-driven
  // updates (see featured-items.js) can push new cards into the correct
  // running carousel instead of writing to the DOM behind its back —
  // the carousel captures its own snapshot of "real items" on init, so a
  // later innerHTML overwrite elsewhere would get silently reverted the
  // next time anything (e.g. a window resize) triggers a recalc.
  window.KKRDishCarousels = window.KKRDishCarousels || {};

  const initDishCarousel = (name) => {
    const root = document.querySelector(`[data-carousel="${name}"]`);
    if (!root) return;
    const viewport = root.querySelector("[data-carousel-viewport]");
    const track = root.querySelector("[data-carousel-track]");
    const dotsWrap = root.parentElement.querySelector("[data-carousel-dots]");
    if (!viewport || !track) return;

    const instance = window.KKRCarousel.create({
      root,
      viewport,
      track,
      dotsWrap,
      itemSelector: ".favcard:not(.favgrid-spacer)",
      spacerClass: "favcard favgrid-spacer",
      getItemsPerPage,
      autoAdvanceMs: AUTO_ADVANCE_MS,
    });
    window.KKRDishCarousels[name] = instance;
  };

  window.addEventListener("DOMContentLoaded", () => {
    initDishCarousel("platters");
    initDishCarousel("favourites");
  });
})();
