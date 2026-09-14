/* KKR Restaurant — progressive enhancement only.
   Every page works with JavaScript disabled; this file adds convenience. */
(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------- mobile nav */
  const burger = $("[data-burger]");
  const nav = $("#sitenav");
  if (burger && nav) {
    const setOpen = (open) => {
      burger.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
      document.body.style.overflow = open && window.innerWidth <= 1200 ? "hidden" : "";
    };
    burger.addEventListener("click", () => setOpen(burger.getAttribute("aria-expanded") !== "true"));
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a") && window.innerWidth <= 1200) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && burger.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        burger.focus();
      }
    });
  }

  /* Remember the reader's language for the next visit. */
  $$(".langs a").forEach((a) => {
    a.addEventListener("click", () => {
      try { localStorage.setItem("kkr-lang", a.getAttribute("lang")); } catch { /* private mode */ }
    });
  });

  /* --------------------------------------------------------- offer popup

     Admin-controlled promo. The markup only exists at all when the offer is
     switched on in the CMS; from there this just handles the scheduling
     window, the auto-close timer, and not nagging a visitor who already
     closed it once. A new offer (different title/message/dates) gets its
     own dismissal key, so publishing a new one shows it again even to
     someone who dismissed the last one earlier in the same session. */
  const offer = $("[data-offer]");
  if (offer) {
    const start = offer.getAttribute("data-offer-start");
    const end = offer.getAttribute("data-offer-end");
    const now = new Date();
    const withinWindow =
      (!start || now >= new Date(start)) && (!end || now <= new Date(end));

    if (withinWindow) {
      const dismissKey = "kkr-offer-dismissed:" + (start || "") + ":" + (end || "") +
        ":" + (offer.querySelector("h2")?.textContent || "");
      let alreadyDismissed = false;
      try { alreadyDismissed = sessionStorage.getItem(dismissKey) === "1"; } catch { /* private mode */ }

      if (!alreadyDismissed) {
        const close = () => {
          offer.classList.remove("is-visible");
          window.clearTimeout(autoCloseTimer);
          try { sessionStorage.setItem(dismissKey, "1"); } catch { /* private mode */ }
          window.setTimeout(() => { offer.hidden = true; }, 400);
        };
        offer.hidden = false;
        // A frame between removing [hidden] and adding the class, so the
        // opening transition actually plays instead of snapping straight in.
        requestAnimationFrame(() => requestAnimationFrame(() => offer.classList.add("is-visible")));
        const seconds = Number(offer.getAttribute("data-offer-seconds")) || 6;
        var autoCloseTimer = window.setTimeout(close, seconds * 1000);
        $$("[data-offer-close]", offer).forEach((el) => el.addEventListener("click", close));
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && offer.classList.contains("is-visible")) close();
        });
      }
    }
  }

  /* -------------------------------------------------------- hero background

     The film is never removed. Two earlier versions of this code deleted it —
     once for reduced motion, once for a "slow connection" guess based on
     navigator.connection.effectiveType, which browsers report unreliably and
     which reads as slow whenever the machine is offline. Both cases left the
     hero as a silent still with no clue why. Now the element always stays;
     the only thing conditional is whether it starts playing by itself. */
  const reel = $("[data-hero]");
  if (reel) {
    const video = $("video", reel);
    const toggle = $("[data-video-toggle]", reel);

    if (video) {
      const label = toggle && $("[data-video-toggle-label]", toggle);
      const blocked = () => {
        // Autoplay refused, or refused silently. Make the control obvious and
        // start on the first tap anywhere in the hero.
        reel.classList.add("is-blocked");
        sync();
        const kick = () => {
          video.play().then(() => reel.classList.remove("is-blocked")).catch(() => {});
        };
        reel.closest(".hero")?.addEventListener("click", kick, { once: true });
        document.addEventListener("pointerdown", kick, { once: true });
      };
      const sync = () => {
        if (!toggle) return;
        const paused = video.paused;
        toggle.classList.toggle("is-paused", paused);
        const text = paused ? toggle.dataset.labelPlay : toggle.dataset.labelPause;
        if (label) label.textContent = text;
        toggle.setAttribute("aria-label", text);
      };

      // Lighter files on small screens: swap the sources, then reload once.
      if (window.matchMedia("(max-width: 48rem)").matches && reel.dataset.videoSmall) {
        const sources = $$("source", video);
        let swapped = false;
        sources.forEach((src) => {
          const small =
            src.type === "video/webm" ? reel.dataset.videoSmallWebm : reel.dataset.videoSmall;
          if (small) {
            src.src = small;
            swapped = true;
          }
        });
        if (swapped) video.load();
      }

      video.addEventListener("play", sync);
      video.addEventListener("pause", sync);
      toggle?.addEventListener("click", () => {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      });

      // Save Data is a deliberate choice by the visitor, so respect it by not
      // starting playback — but leave the film there for them to press play.
      if (navigator.connection && navigator.connection.saveData === true) {
        video.autoplay = false;
        video.pause();
      } else {
        // Some browsers resolve play() and then never advance. Check the clock
        // rather than trusting the promise.
        const watchdog = setTimeout(() => {
          if (video.currentTime < 0.1) blocked();
        }, 1800);
        video.addEventListener("timeupdate", () => clearTimeout(watchdog), { once: true });

        const attempt = video.play();
        if (attempt && attempt.catch) {
          attempt.catch(() => {
            // Autoplay refused. Make the control obvious rather than leaving
            // what looks like a broken still, and start on the first tap
            // anywhere in the hero.
            blocked();
          });
        }
      }
      sync();
    }
  }

  /** Attach sources and start playing once the element nears the viewport.

      play() must not be called in the same breath as load(): the load
      interrupts it, the promise rejects, and the film sits there paused. Wait
      for the browser to say it has data, and set autoplay as a second route
      in case that event has already gone by. */
  function lazyVideo(video, onReady) {
    if (!video || !video.dataset.src) return;
    let loaded = false;

    const start = () => {
      if (!video.paused) return;
      const attempt = video.play();
      if (attempt && attempt.catch) {
        attempt.catch((err) => {
          // An abort just means load() overtook this attempt; the events below
          // will try again. Anything else is a real refusal, so hand over the
          // controls rather than leaving a still frame.
          if (err && err.name === "AbortError") return;
          video.controls = true;
        });
      }
    };

    const load = () => {
      if (loaded) return;
      loaded = true;
      const mp4 = document.createElement("source");
      mp4.src = video.dataset.src;
      mp4.type = "video/mp4";
      video.appendChild(mp4);
      if (video.dataset.srcWebm) {
        const alt = document.createElement("source");
        alt.src = video.dataset.srcWebm;
        alt.type = "video/webm";
        video.appendChild(alt);
      }
      video.muted = true;
      video.autoplay = true;
      video.preload = "auto";
      video.addEventListener("loadeddata", start, { once: true });
      video.addEventListener("canplay", start, { once: true });
      video.load();
      start();
      if (onReady) onReady();
    };

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            load();
            io.disconnect();
          });
        },
        { rootMargin: "250px 0px" }
      );
      io.observe(video);
    } else {
      load();
    }
  }

  /* ------------------------------------------------------------ film player

     Starts by itself, muted, but only once it comes into view — a fifty-second
     film has no business downloading while someone is still reading the hero.
     The sound is a deliberate choice, so it stays off until asked for. */
  // The story film carries its own autoplay attributes. If the browser refuses,
  // reveal the play button rather than leaving a still frame.
  $$(".about__video").forEach((video) => {
    const btn = video.parentElement && $("[data-about-play]", video.parentElement);
    const show = () => btn && (btn.hidden = false);
    const hide = () => btn && (btn.hidden = true);
    video.addEventListener("play", hide);
    video.addEventListener("pause", show);
    btn?.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
    const attempt = video.play();
    if (attempt && attempt.catch) attempt.catch(show);
    setTimeout(() => {
      if (video.currentTime < 0.1) show();
    }, 2000);
  });

  const film = $("[data-film]");
  if (film) {
    const video = $("video", film);
    const sound = $("[data-film-sound]", film);

    if (video && video.dataset.src) {
      lazyVideo(video);

      if (sound) {
        const label = $("[data-film-sound-label]", sound);
        const sync = () => {
          sound.classList.toggle("is-loud", !video.muted);
          const text = video.muted ? sound.dataset.labelOn : sound.dataset.labelOff;
          if (label) label.textContent = text;
          sound.setAttribute("aria-label", text);
        };
        sound.addEventListener("click", () => {
          video.muted = !video.muted;
          if (!video.muted) video.play().catch(() => {});
          sync();
        });
        sync();
      }
    }
  }

  /* ------------------------------------------------------- gallery + lightbox */
  const filters = $$("[data-filter]");
  if (filters.length) {
    filters.forEach((btn) => {
      btn.addEventListener("click", () => {
        const want = btn.dataset.filter;
        filters.forEach((b) => b.classList.toggle("is-on", b === btn));
        $$(".tile").forEach((t) => {
          t.hidden = want !== "all" && t.dataset.cat !== want;
        });
      });
    });
  }

  const dialog = $("[data-lightbox-dialog]");
  if (dialog && typeof dialog.showModal === "function") {
    const img = $("[data-lightbox-img]", dialog);
    const cap = $("[data-lightbox-cap]", dialog);
    const tiles = $$("[data-lightbox]");
    let index = 0;

    const show = (i) => {
      const t = tiles[(i + tiles.length) % tiles.length];
      if (!t) return;
      index = (i + tiles.length) % tiles.length;
      img.src = t.dataset.src;
      img.alt = t.querySelector("img")?.alt || "";
      cap.textContent = t.dataset.caption || "";
      if (!dialog.open) dialog.showModal();
    };

    tiles.forEach((t, i) => t.addEventListener("click", () => show(i)));
    $("[data-close]", dialog)?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") show(index + 1);
      if (e.key === "ArrowLeft") show(index - 1);
    });
    dialog.addEventListener("close", () => { tiles[index]?.focus(); });
  }

  /* ------------------------------------------------------------- brand mark

     Anchor links do not reload the page, so the mark is told to run its
     animation again whenever one is used. */
  const mark = $(".brand img");
  if (mark) {
    const replay = () => {
      mark.classList.add("is-replay");
      // Reading offsetWidth forces the browser to notice the animation was
      // removed; without it, re-adding the class does nothing.
      void mark.offsetWidth;
      mark.classList.remove("is-replay");
    };
    $$('.sitenav__list a[href*="#"], .brand').forEach((el) =>
      el.addEventListener("click", () => setTimeout(replay, 60))
    );
  }

  /* ---------------------------------------------------------------- the rail

     Arrows scroll the platters by one card. They are never disabled: the old
     version worked that out from a measurement taken before the cards had laid
     out, decided the rail did not overflow, and switched itself off for good. */
  $$("[data-rail]").forEach((rail) => {
    const track = $(".rail__track", rail);
    if (!track) return;

    const step = () => {
      const card = track.firstElementChild;
      const gap = parseFloat(getComputedStyle(track).columnGap || "20") || 20;
      return card ? card.getBoundingClientRect().width + gap : track.clientWidth / 2;
    };

    const move = (dir) => {
      const max = track.scrollWidth - track.clientWidth;
      let to = track.scrollLeft + dir * step();
      if (to > max) to = dir > 0 ? 0 : max;      // wrap round rather than stop
      if (to < 0) to = max;
      track.scrollTo({ left: to, behavior: "smooth" });
    };

    $("[data-rail-prev]", rail)?.addEventListener("click", () => move(-1));
    $("[data-rail-next]", rail)?.addEventListener("click", () => move(1));
  });

  /* ------------------------------------------------------------- menu search

     Hiding the dishes is only half of it: the jump links have to follow, or
     they point at sections that are no longer on the page, and an empty result
     needs to say so rather than leaving a blank page. */
  const search = $("[data-menu-search]");
  if (search) {
    const items = $$(".mitem");
    const cats = $$(".menu__cat");
    const jumps = $$("[data-jump]");
    const count = $("[data-menu-count]");
    const empty = $("[data-menu-empty]");
    const total = items.length;
    let t;

    const run = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;

      items.forEach((li) => {
        const hit = !q || (li.dataset.search || "").includes(q);
        li.hidden = !hit;
        if (hit) shown++;
      });

      cats.forEach((c) => {
        const live = $$(".mitem", c).some((li) => !li.hidden);
        c.hidden = !live;
        const link = jumps.find((j) => j.dataset.jump === c.id);
        if (link) link.hidden = !live;
        // A match hidden inside a closed accordion panel is still a match
        // the customer can't see — open it automatically so the results
        // the count claims to show are actually visible on the page.
        if (q && live) {
          const details = $(".menucard__accordion", c);
          if (details) details.open = true;
        }
      });

      if (count) {
        const tpl = count.dataset.tpl || "{n} / {total}";
        count.textContent = q ? tpl.replace("{n}", shown).replace("{total}", total) : "";
      }
      if (empty) empty.hidden = !(q && shown === 0);
    };

    const queue = () => {
      clearTimeout(t);
      t = setTimeout(run, 120);
    };
    // Cover every way the field's value can change: typing, pasting, the
    // clear button, and a value the browser restored on a back navigation.
    ["input", "keyup", "change", "paste", "search", "cut"].forEach((e) =>
      search.addEventListener(e, queue)
    );
    if (search.value) run();
  }

  /* -------------------------------------------------------- menu accordion
     Each category collapses to just its title until clicked — the jump
     nav and any direct #cat-x link still have to actually reveal the
     category they point at, since a closed <details> hides its content
     regardless of where the browser scrolls to. */
  try {
    const openCategory = (id) => {
      const section = document.getElementById(id);
      const details = section && $(".menucard__accordion", section);
      if (details) details.open = true;
    };
    $$('[data-jump] a[href^="#cat-"]').forEach((a) => {
      a.addEventListener("click", () => openCategory(a.getAttribute("href").slice(1)));
    });
    if (location.hash.startsWith("#cat-")) openCategory(location.hash.slice(1));
    window.addEventListener("hashchange", () => {
      if (location.hash.startsWith("#cat-")) openCategory(location.hash.slice(1));
    });

    /* Only one category open at a time — opening a new one folds whichever
       was open back closed, rather than letting the page just keep
       growing as more get expanded. Wired to the click on the title
       itself (not the accordion's native "toggle" event), since search
       above opens several matching categories at once by setting .open
       directly, and that needs to keep working. */
    const accordions = $$(".menucard__accordion");
    accordions.forEach((details) => {
      const summary = $(".menucard__head", details);
      summary?.addEventListener("click", () => {
        const willOpen = !details.open;
        if (willOpen) accordions.forEach((other) => other !== details && (other.open = false));
      });
    });
  } catch (err) {
    /* Categories still open on click either way — this only covers the
       "arrive with a #cat-x link" case, so a failure here is a minor
       convenience loss, not a broken accordion. */
  }

  /* ------------------------------------------------------------------ forms */
  const messages = {
    en: {
      required: "Please fill this in.",
      email: "Please check this email address.",
      sending: "Sending…",
      ok: "Request received. We will contact you to confirm.",
      okContact: "Message received. We will reply as soon as we can.",
      fail: "That did not send. Please call or message us on WhatsApp instead.",
    },
    ur: {
      required: "براہِ کرم یہ خانہ پُر کریں۔",
      email: "براہِ کرم ای میل ایڈریس دوبارہ دیکھیں۔",
      sending: "بھیجا جا رہا ہے…",
      ok: "آپ کی درخواست موصول ہو گئی۔ تصدیق کے لیے ہم آپ سے رابطہ کریں گے۔",
      okContact: "آپ کا پیغام موصول ہو گیا۔ ہم جلد جواب دیں گے۔",
      fail: "پیغام نہیں بھیجا جا سکا۔ براہِ کرم کال کریں یا واٹس ایپ پر رابطہ کریں۔",
    },
    ps: {
      required: "مهرباني وکړئ دا برخه ډکه کړئ.",
      email: "مهرباني وکړئ بریښنالیک بیا وګورئ.",
      sending: "لېږل کیږي…",
      ok: "ستاسو غوښتنه ترلاسه شوه. د تایید لپاره به له تاسو سره اړیکه ونیسو.",
      okContact: "ستاسو پیغام ترلاسه شو. ژر به ځواب درکړو.",
      fail: "پیغام ونه لېږل شو. مهرباني وکړئ زنګ ووهئ یا په واټس اپ کې اړیکه ونیسئ.",
    },
  };
  const t = messages[document.documentElement.lang] || messages.en;
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  const setError = (field, msg) => {
    const wrap = field.closest(".field");
    if (!wrap) return;
    let e = wrap.querySelector(".error");
    if (msg) {
      if (!e) {
        e = document.createElement("span");
        e.className = "error";
        e.id = `${field.id}-err`;
        wrap.appendChild(e);
      }
      e.textContent = msg;
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", e.id);
    } else {
      e?.remove();
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    }
  };

  $$("[data-form]").forEach((form) => {
    const status = $("[data-status]", form);
    const submit = $('button[type="submit"]', form);
    const kind = form.dataset.form;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fields = $$("input, select, textarea", form).filter((f) => f.type !== "hidden" && !f.closest(".hp"));
      let bad = null;

      fields.forEach((f) => {
        let msg = "";
        if (f.required && !f.value.trim()) msg = t.required;
        else if (f.type === "email" && f.value.trim() && !emailOk(f.value.trim())) msg = t.email;
        setError(f, msg);
        if (msg && !bad) bad = f;
      });
      if (bad) { bad.focus(); return; }

      const data = Object.fromEntries(new FormData(form).entries());
      status.className = "form__status";
      status.textContent = t.sending;
      submit.disabled = true;

      try {
        const res = await fetch(`/api/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(String(res.status));
        status.className = "form__status is-ok";
        status.textContent = kind === "reservation" ? t.ok : t.okContact;
        form.reset();
      } catch {
        status.className = "form__status is-error";
        status.textContent = t.fail;
      } finally {
        submit.disabled = false;
      }
    });
  });

  /* ------------------------------------------------- copy the share hashtag

     Retyping "#KKRRestaurant" into Instagram on a phone is the step people
     give up on, so the pill copies itself. The Clipboard API needs a secure
     context, so fall back to a hidden field and, if even that fails, leave
     the text selected for the reader to copy by hand. */
  $$("[data-copy-tag]").forEach((btn) => {
    const label = $("[data-copy-text]", btn);
    const tag = btn.getAttribute("data-copy-tag") || "";
    const done = btn.getAttribute("data-copied-label") || "Copied";
    if (!label || !tag) return;
    const original = label.textContent;
    let timer = 0;

    const flash = () => {
      label.textContent = done;
      btn.classList.add("is-copied");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.textContent = original;
        btn.classList.remove("is-copied");
      }, 2000);
    };

    const legacy = () => {
      const field = document.createElement("textarea");
      field.value = tag;
      field.setAttribute("readonly", "");
      field.style.cssText = "position:fixed;inset-block-start:-1000px;opacity:0";
      document.body.appendChild(field);
      field.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(field);
      return ok;
    };

    btn.addEventListener("click", () => {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(tag).then(flash, () => { if (legacy()) flash(); });
      } else if (legacy()) {
        flash();
      }
    });
  });

  /* Scroll reveal: sections rise once, gently, and only if motion is welcome. */
  if (!reduced && "IntersectionObserver" in window) {
    const targets = $$("main > section, main > .block");
    targets.forEach((el) => el.setAttribute("data-reveal", ""));
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );
    targets.forEach((el, i) => (i === 0 ? el.classList.add("is-visible") : io.observe(el)));
  }

  /* ---------------------------------------------- opened from inside the zip

     Windows will happily open a single HTML file straight out of an archive,
     copying it alone into a Temp folder. The page then looks fine — the CSS,
     the script and every image are inlined — but the videos, the PDF and the
     other pages are simply not there. That produces exactly the symptoms of a
     broken video, so say plainly what has happened. */
  if (location.protocol === "file:" && /\.zip|\.7z|\bTemp\b|Temporary/i.test(location.pathname)) {
    const warn = document.createElement("div");
    warn.style.cssText =
      "position:fixed;z-index:9999;inset-inline:0;inset-block-start:0;padding:14px 18px;" +
      "background:#7B1E14;color:#fff;font:600 14px/1.5 system-ui,sans-serif;text-align:center";
    warn.innerHTML =
      "This page was opened from <u>inside the zip file</u>, so the videos, the PDF menu and the " +
      "other pages are missing.<br>Extract the whole folder first (right-click the zip \u2192 " +
      "Extract All), then open preview-english.html from the extracted folder.";
    document.addEventListener("DOMContentLoaded", () => document.body.prepend(warn));
    if (document.body) document.body.prepend(warn);
  }

  /* ----------------------------------------------- preview: is search alive?

     Local preview files only. Prints beside the search box whether the script
     found and wired it, so a screenshot answers the question directly. */
  if (location.protocol === "file:") {
    const box = $("[data-menu-search]");
    if (box) {
      const note = document.createElement("p");
      note.style.cssText =
        "margin:.4rem 0 0;font:12px/1.5 ui-monospace,monospace;color:#1F7A50";
      note.textContent =
        "search ready \u2014 " + $$(".mitem").length + " dishes indexed, " +
        $$(".menu__cat").length + " sections";
      box.parentElement && box.parentElement.appendChild(note);
    }
  }

  /* Keep the copyright year honest without a rebuild. */
  const year = $("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  /* The bar goes solid as soon as the page moves. A zero-height sentinel with
     an IntersectionObserver was unreliable here — an element with no area
     never satisfies a threshold of 1, so the class never settled and the
     navigation sat transparent over the ivory sections, unreadable. */
  const header = $("[data-header]");
  if (header) {
    let ticking = false;
    const sync = () => {
      header.classList.toggle("is-stuck", window.scrollY > 24);
      ticking = false;
    };
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(sync);
      },
      { passive: true }
    );
    sync();
  }
  /* ------------------------------------------------------- menu tab highlight
     The active-tab highlight was built on the CSS :has() selector, which
     Firefox only gained in December 2023 and older Edge/IE never got at
     all — on any of those, every tab looked permanently unselected even
     though clicking still switched the panel underneath (that part uses
     plain :checked, supported everywhere). This replaces it with a class
     toggle that works in any browser with basic JS, radios and all.
     Wrapped defensively so that if anything here ever throws in an
     unusual browser, it fails quietly instead of taking the rest of the
     page's scripts down with it. */
  try {
    $$(".mtabs__strip").forEach((strip) => {
      const inner = strip.parentElement || document;
      const radios = $$(".mtabs__radio", inner);
      const sync = () => {
        radios.forEach((radio) => {
          const label = $(`label[for="${radio.id}"]`, strip);
          if (label) label.classList.toggle("is-active", radio.checked);
        });
      };
      radios.forEach((radio) => radio.addEventListener("change", sync));
      sync();
    });
  } catch (err) {
    /* Tab-highlight is a visual nicety, not a blocker — the radios and
       :checked panel switching underneath still work without it. */
  }

  /* --------------------------------------------------------- marquee pause
     The auto-scrolling carousels (Special Platters, Favourites) pause on
     CSS :hover, but touch screens have no real hover — a tap can land on
     a card that's still sliding, making "Add to cart" a moving target.
     This pauses the animation directly on touch, and on a real click too
     as a second safety net, so a tap always lands on a stationary button. */
  try {
    $$(".marquee").forEach((marquee) => {
      const track = $(".marquee__track", marquee);
      if (!track) return;
      let resumeTimer = null;
      const pause = () => {
        track.style.animationPlayState = "paused";
        clearTimeout(resumeTimer);
      };
      const resume = () => {
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
          track.style.animationPlayState = "";
        }, 1200);
      };
      marquee.addEventListener("touchstart", pause, { passive: true });
      marquee.addEventListener("touchend", resume, { passive: true });
      marquee.addEventListener("pointerdown", pause);
    });
  } catch (err) {
    /* Same reasoning as above — a smoother tap experience, not a blocker. */
  }

  /* ------------------------------------------------------- printed menu PDF
     The PDF itself is pre-built at deploy time (see tools/generate_menu_pdf.py)
     straight from the same menu content the page renders, not hand-maintained
     separately — this button doesn't generate anything live, but showing a
     brief "Generating…" state is a small, honest bit of feedback that the
     click registered and something is about to happen, rather than the file
     just appearing with no acknowledgement. */
  try {
    document.querySelectorAll("[data-generate-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const url = btn.getAttribute("data-generate-pdf");
        const label = btn.getAttribute("data-pdf-label") || btn.textContent;
        const generating = btn.getAttribute("data-pdf-generating") || "Generating…";
        btn.disabled = true;
        btn.textContent = generating;
        setTimeout(() => {
          // Opens in a new tab rather than downloading straight to disk —
          // the customer can view it, then save or print from there if
          // they want to, instead of a file just landing in their
          // downloads folder with no preview.
          window.open(url, "_blank", "noopener");
          btn.disabled = false;
          btn.textContent = label;
        }, 900);
      });
    });
  } catch (err) {
    /* If this fails to wire up for any reason, the button simply won't
       respond to clicks — better than a broken click handler taking any
       other script on the page down with it. */
  }

  /* ------------------------------------------------------- language dropdown */
  try {
    const dropdown = $("[data-lang-dropdown]");
    if (dropdown) {
      const toggle = $("[data-lang-toggle]", dropdown);
      const close = () => {
        dropdown.removeAttribute("data-open");
        toggle?.setAttribute("aria-expanded", "false");
      };
      const open = () => {
        dropdown.setAttribute("data-open", "");
        toggle?.setAttribute("aria-expanded", "true");
      };
      toggle?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dropdown.hasAttribute("data-open")) close();
        else open();
      });
      document.addEventListener("click", (e) => {
        if (!dropdown.contains(e.target)) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
    }
  } catch (err) {
    /* Same reasoning as above. */
  }
})();

/* Marquee card duplication for Special Platters now lives in
   featured-items.js, so it runs after that script has finished replacing
   the section's content (if any items are admin-featured) — duplicating
   before that would clone stale hardcoded cards. */

/* ---------------------------------------------------- tap-to-reveal cart
   "Add to cart" is hidden by default on every dish card to keep the list
   compact (see .cart-add in site.css) and reveals on hover. Touch devices
   have no hover, so a tap on the card itself reveals it there instead —
   tapping a different card swaps which one is revealed, and tapping
   anywhere else closes it. */
(() => {
  "use strict";
  document.addEventListener("click", (e) => {
    const item = e.target.closest(".mitem, .favcard");
    const revealed = document.querySelectorAll(".mitem.is-revealed, .favcard.is-revealed");

    if (!item) {
      revealed.forEach((el) => el.classList.remove("is-revealed"));
      return;
    }
    // Clicking inside the already-revealed control itself (the tier
    // select, the button) should behave normally, not re-toggle reveal.
    if (e.target.closest(".cart-add")) return;

    const alreadyOpen = item.classList.contains("is-revealed");
    revealed.forEach((el) => {
      if (el !== item) el.classList.remove("is-revealed");
    });
    item.classList.toggle("is-revealed", !alreadyOpen);
  });

  // A click-revealed item on a device that DOES support hover (a mouse)
  // needs its own cleanup: without this, clicking an item then simply
  // moving the mouse away — without clicking anything else — left it
  // stuck open forever, since only another click closed it.
  //
  // The removal is debounced: revealing the control changes the item's
  // layout (it grows taller), and that shift alone was enough to trigger
  // a spurious mouseleave the instant the class was added — instantly
  // undoing the very click that just opened it. A short delay, cancelled
  // if the mouse is still there (or comes back) a moment later, avoids
  // reacting to that one-frame layout glitch while still closing
  // promptly on a real, deliberate mouse-away.
  let leaveTimer = null;
  document.addEventListener(
    "mouseleave",
    (e) => {
      const item = e.target.closest?.(".mitem.is-revealed, .favcard.is-revealed");
      if (!item) return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        if (!item.matches(":hover")) item.classList.remove("is-revealed");
      }, 200);
    },
    true
  );
  document.addEventListener(
    "mouseenter",
    (e) => {
      if (e.target.closest?.(".mitem.is-revealed, .favcard.is-revealed")) {
        clearTimeout(leaveTimer);
      }
    },
    true
  );
})();

/* --------------------------------------------------- image zoom-and-pan
   The "We're ready to serve you" photo zooms in on hover and pans to
   follow the cursor within its frame, so the visitor can look around the
   zoomed image rather than just seeing a static enlarged crop. */
(() => {
  "use strict";
  const figure = document.querySelector(".serve__figure");
  const img = figure?.querySelector("img");
  if (!figure || !img) return;

  figure.addEventListener("mousemove", (e) => {
    const rect = figure.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    img.style.transformOrigin = `${xPct}% ${yPct}%`;
    img.style.transform = "scale(1.6)";
  });
  figure.addEventListener("mouseleave", () => {
    img.style.transform = "scale(1)";
  });
})();
