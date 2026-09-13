(() => {
  "use strict";

  const $ = (sel, root = document) => (root || document).querySelector(sel);

  const renderForm = () => {
    const session = window.KKRAuth?.getSession();
    const loggedOut = $("[data-ma-logged-out]");
    const formWrap = $("[data-ma-form-wrap]");
    if (!session) {
      loggedOut.hidden = false;
      formWrap.hidden = true;
      return;
    }
    loggedOut.hidden = true;
    formWrap.hidden = false;
    const p = session.profile || {};
    $("[data-ma-name]").value = p.full_name || "";
    $("[data-ma-phone]").value = p.phone || "";
    $("[data-ma-email]").value = p.email || session.user?.email || "";
    $("[data-ma-address]").value = p.default_address || "";
  };

  const save = async () => {
    const session = window.KKRAuth?.getSession();
    const errEl = $("[data-ma-error]");
    const okEl = $("[data-ma-success]");
    errEl.hidden = true;
    okEl.hidden = true;
    if (!session) return;

    const name = $("[data-ma-name]").value.trim();
    const phone = $("[data-ma-phone]").value.trim();
    const email = $("[data-ma-email]").value.trim();
    const address = $("[data-ma-address]").value.trim();

    if (!name || !phone) {
      errEl.hidden = false;
      errEl.textContent = "Name and phone are required.";
      return;
    }

    try {
      const { url, anonKey } = window.KKR_SUPABASE || {};
      const res = await fetch(`${url}/rest/v1/profiles?id=eq.${session.user.id}`, {
        method: "PATCH",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          full_name: name,
          phone,
          email,
          default_address: address || null,
        }),
      });
      const rows = await res.json();
      if (!res.ok) throw new Error(rows?.message || "Could not save changes.");

      session.profile = rows[0];
      try {
        localStorage.setItem("kkr-session-v1", JSON.stringify(session));
      } catch {
        /* non-fatal */
      }
      okEl.hidden = false;
      okEl.textContent = "Saved.";
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  };

  $("[data-ma-save]")?.addEventListener("click", save);
  if (window.KKRAuth) window.KKRAuth.onChange(renderForm);
  window.addEventListener("DOMContentLoaded", renderForm);
})();
