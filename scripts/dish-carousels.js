(() => {
  "use strict";

  const AUTO_ADVANCE_MS = 5000;

  const getItemsPerPage = () => {
    const w = window.innerWidth;
    if (w <= 480) return 1;
    if (w <= 1024) return 2;
    return 4;
  };

  const initDishCarousel = (name) => {
    const root = document.querySelector(`[data-carousel="${name}"]`);
    if (!root) return;
    const viewport = root.querySelector("[data-carousel-viewport]");
    const track = root.querySelector("[data-carousel-track]");
    const dotsWrap = root.parentElement.querySelector("[data-carousel-dots]");
    if (!viewport || !track) return;

    window.KKRCarousel.create({
      root,
      viewport,
      track,
      dotsWrap,
      itemSelector: ".favcard:not(.favgrid-spacer)",
      spacerClass: "favcard favgrid-spacer",
      getItemsPerPage,
      autoAdvanceMs: AUTO_ADVANCE_MS,
    });
  };

  window.addEventListener("DOMContentLoaded", () => {
    initDishCarousel("platters");
    initDishCarousel("favourites");
  });
})();
