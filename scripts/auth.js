/**
 * Shared customer auth — a thin wrapper over Supabase's plain REST auth
 * endpoints (GoTrue). No SDK needed for the handful of calls this makes.
 * Exposes window.KKRAuth so the header account modal, the checkout page,
 * and the cart drawer's "logged in as…" line all share one session
 * instead of three separate copies of this logic.
 */
(() => {
  "use strict";

  const SESSION_KEY = "kkr-session-v1";
  const listeners = new Set();

  const SB = () => window.KKR_SUPABASE || {};

  const loadSession = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  };
  const saveSession = (session) => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* non-fatal */
    }
  };

  let session = loadSession();
  const notify = () => listeners.forEach((fn) => fn(session));

  const authFetch = async (path, opts = {}) => {
    const { url, anonKey } = SB();
    const res = await fetch(`${url}${path}`, {
      ...opts,
      headers: { apikey: anonKey, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error_description || data?.msg || data?.error || "Something went wrong.");
    }
    return data;
  };

  const register = (name, phone, email, password) => {
    if (!String(phone || "").trim()) {
      return Promise.reject(new Error("A phone number is required to register."));
    }
    return authFetch("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, data: { full_name: name, phone } }),
    });
  };

  const refreshProfile = async () => {
    if (!session) return null;
    try {
      const { url, anonKey } = SB();
      const res = await fetch(`${url}/rest/v1/profiles?id=eq.${session.user.id}&select=*`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
      });
      const rows = await res.json();
      session.profile = rows[0] || null;
      saveSession(session);
      notify();
      return session.profile;
    } catch {
      return null;
    }
  };

  const login = async (email, password) => {
    const data = await authFetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: { id: data.user.id, email: data.user.email },
    };
    saveSession(session);
    notify();
    await refreshProfile();
    return session;
  };

  const logout = () => {
    session = null;
    saveSession(null);
    notify();
  };

  window.addEventListener("storage", (e) => {
    if (e.key !== SESSION_KEY) return;
    session = loadSession();
    notify();
  });

  window.KKRAuth = {
    getSession: () => (session ? { ...session } : null),
    isLoggedIn: () => !!session,
    login,
    register,
    logout,
    refreshProfile,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Warm the profile (name/phone/reward points) on every page load so it's
  // ready the instant any UI asks for it, rather than waiting on a click.
  if (session) refreshProfile();
})();
