/**
 * Address picker: a pin fixed at the center of the map — the customer pans
 * the map underneath it, rather than dragging a marker (works better on
 * touch). "Use this location" reverse-geocodes the center point via
 * Nominatim (OpenStreetMap's free geocoder) and fills the address field.
 * The address field stays a normal, freely-editable text input — this is
 * an aid, not a replacement for typing.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);

  // University Road, Peshawar — the restaurant's own location, used as the
  // map's starting point so most customers barely need to pan at all.
  const DEFAULT_CENTER = [34.0128612, 71.540616];
  const DEFAULT_ZOOM = 14;

  let map = null;
  let currentLatLng = { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
  let reverseGeocodeTimer = null;

  const modal = () => $("[data-map-picker]");

  const openModal = () => {
    const m = modal();
    if (!m) return;
    m.hidden = false;
    document.body.classList.add("cart-drawer-open");
    // Leaflet needs a visible container to measure, so init/resize only
    // after the modal is actually shown.
    requestAnimationFrame(() => {
      if (!map) initMap();
      else map.invalidateSize();
    });
  };

  const closeModal = () => {
    const m = modal();
    if (!m) return;
    m.hidden = true;
    document.body.classList.remove("cart-drawer-open");
  };

  const initMap = () => {
    map = L.map("map-picker-map", { attributionControl: true, zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    map.on("move", () => {
      const c = map.getCenter();
      currentLatLng = { lat: c.lat, lng: c.lng };
      scheduleReverseGeocode();
    });

    scheduleReverseGeocode();
  };

  const scheduleReverseGeocode = () => {
    clearTimeout(reverseGeocodeTimer);
    setText("[data-map-address-preview]", "Finding address…");
    reverseGeocodeTimer = setTimeout(reverseGeocode, 600);
  };

  const setText = (sel, text) => {
    const el = $(sel);
    if (el) el.textContent = text;
  };

  const reverseGeocode = async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${currentLatLng.lat}&lon=${currentLatLng.lng}&zoom=18`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await res.json();
      const label = data?.display_name || `${currentLatLng.lat.toFixed(5)}, ${currentLatLng.lng.toFixed(5)}`;
      setText("[data-map-address-preview]", label);
    } catch {
      setText("[data-map-address-preview]", `${currentLatLng.lat.toFixed(5)}, ${currentLatLng.lng.toFixed(5)}`);
    }
  };

  /* ------------------------------------------------------------- search */
  let searchDebounce;
  const searchInput = () => $("[data-map-search]");

  const runSearch = async (query) => {
    const resultsEl = $("[data-map-search-results]");
    if (!query) {
      resultsEl.innerHTML = "";
      return;
    }
    try {
      // Biased toward Peshawar via viewbox + bounded, but not restricted
      // to it entirely, in case a customer is coordinating delivery from
      // just outside the usual area.
      const viewbox = "71.35,34.15,71.75,33.90"; // left,top,right,bottom
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        query
      )}&viewbox=${viewbox}&bounded=0&limit=5&countrycodes=pk`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const results = await res.json();
      resultsEl.innerHTML = results
        .map(
          (r) =>
            `<li data-lat="${r.lat}" data-lng="${r.lon}">${escapeHtml(r.display_name)}</li>`
        )
        .join("");
    } catch {
      resultsEl.innerHTML = "";
    }
  };

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  document.addEventListener("input", (e) => {
    if (e.target.matches("[data-map-search]")) {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runSearch(e.target.value.trim()), 400);
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-map-picker]")) {
      openModal();
      return;
    }
    if (e.target.closest("[data-map-close]")) {
      closeModal();
      return;
    }
    const result = e.target.closest("[data-map-search-results] li");
    if (result) {
      const lat = Number(result.dataset.lat);
      const lng = Number(result.dataset.lng);
      map.setView([lat, lng], 17);
      $("[data-map-search-results]").innerHTML = "";
      searchInput().value = "";
      return;
    }
    if (e.target.closest("[data-map-confirm]")) {
      const addressField = $("[data-cf-address]");
      const preview = $("[data-map-address-preview]")?.textContent || "";
      if (addressField && preview && preview !== "Finding address…") {
        addressField.value = preview;
      }
      $("[data-cf-address-lat]").value = currentLatLng.lat;
      $("[data-cf-address-lng]").value = currentLatLng.lng;
      closeModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // If the customer edits the address by hand after picking on the map,
  // the coordinates no longer necessarily match — clear them so a stale
  // pin location is never silently sent with a manually-typed address.
  document.addEventListener("input", (e) => {
    if (e.target.matches("[data-cf-address]")) {
      const latEl = $("[data-cf-address-lat]");
      const lngEl = $("[data-cf-address-lng]");
      if (latEl) latEl.value = "";
      if (lngEl) lngEl.value = "";
    }
  });
})();
