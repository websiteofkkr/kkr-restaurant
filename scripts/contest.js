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
    if (attr === "contest") stopCamera();
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

  // ------------------------------------------------------- camera capture
  // Opens the device camera directly inside the page (getUserMedia) rather
  // than a generic file picker — there's no "choose from gallery" option
  // in this flow at all, which rules out the easy version of submitting
  // an existing/AI-generated image. It can't rule out someone recapturing
  // a screen with their camera, but it meaningfully raises the bar.
  let capturedPhotoBlob = null;
  let cameraStream = null;

  const cameraVideo = $("[data-contest-camera-video]");
  const cameraCanvas = $("[data-contest-camera-canvas]");
  const cameraPreview = $("[data-contest-camera-preview]");
  const startBtn = $("[data-contest-camera-start]");
  const snapBtn = $("[data-contest-camera-snap]");
  const retakeBtn = $("[data-contest-camera-retake]");
  const fallbackNote = $("[data-contest-camera-fallback-note]");
  const fallbackInput = $("[data-contest-photo-fallback]");

  const stopCamera = () => {
    cameraStream?.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackNote.hidden = false;
      fallbackInput.hidden = false;
      fallbackInput.required = true;
      startBtn.hidden = true;
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      cameraVideo.srcObject = cameraStream;
      cameraVideo.hidden = false;
      cameraPreview.hidden = true;
      startBtn.hidden = true;
      snapBtn.hidden = false;
      retakeBtn.hidden = true;
    } catch {
      // Permission denied or no camera present — fall back to a normal
      // file picker rather than leaving the customer stuck.
      fallbackNote.hidden = false;
      fallbackInput.hidden = false;
      fallbackInput.required = true;
      startBtn.hidden = true;
    }
  };

  startBtn?.addEventListener("click", startCamera);

  snapBtn?.addEventListener("click", () => {
    const w = cameraVideo.videoWidth || 720;
    const h = cameraVideo.videoHeight || 960;
    cameraCanvas.width = w;
    cameraCanvas.height = h;
    cameraCanvas.getContext("2d").drawImage(cameraVideo, 0, 0, w, h);
    cameraCanvas.toBlob(
      (blob) => {
        capturedPhotoBlob = blob;
        cameraPreview.src = URL.createObjectURL(blob);
        cameraPreview.hidden = false;
        cameraVideo.hidden = true;
        snapBtn.hidden = true;
        retakeBtn.hidden = false;
        stopCamera();
      },
      "image/jpeg",
      0.9
    );
  });

  retakeBtn?.addEventListener("click", () => {
    capturedPhotoBlob = null;
    cameraPreview.hidden = true;
    retakeBtn.hidden = true;
    startBtn.hidden = false;
    startCamera();
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
      if (!capturedPhotoBlob && !fallbackInput.files?.[0]) {
        status.className = "form__status is-error";
        status.textContent = "Please take a live photo (or use the file upload if your camera isn't available).";
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
        // The live-captured photo takes priority over the fallback file
        // input if both somehow have a value.
        if (capturedPhotoBlob) {
          formData.set("photo", capturedPhotoBlob, "kkr-moment.jpg");
        }
        const res = await fetch("/api/contest-entry", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not submit your entry.");

        status.className = "form__status is-ok";
        status.textContent = "Thank you! Your KKR moment has been entered into this month's Photo of the Month contest.";
        form.reset();
        capturedPhotoBlob = null;
        cameraPreview.hidden = true;
        startBtn.hidden = false;
        stopCamera();
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
        $("[data-contest-winner-amount]", section).textContent = currentWinner.prizeDescription;
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
