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

  // Supabase access tokens expire after about an hour. Without this, a
  // session that looked "logged in" (the session object and email are
  // still sitting in localStorage) would silently carry a dead token —
  // every authenticated request from that point on gets rejected by the
  // server, which is exactly what "it says I'm logged in but won't let
  // me do anything" looks like from the outside. The refresh_token is
  // long-lived and exists precisely to mint a new access_token without
  // making the person log in again.
  let refreshingToken = null;
  const refreshAccessToken = () => {
    if (!session?.refresh_token) return Promise.resolve(false);
    if (refreshingToken) return refreshingToken; // avoid parallel refreshes racing each other
    refreshingToken = authFetch("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
      .then((data) => {
        session.access_token = data.access_token;
        session.refresh_token = data.refresh_token;
        saveSession(session);
        notify();
        return true;
      })
      .catch(() => {
        // The refresh_token itself is invalid/expired too — this session
        // is genuinely dead. Log out cleanly so the UI honestly shows a
        // login form instead of a "logged in" state that can never
        // successfully do anything.
        logout();
        return false;
      })
      .finally(() => {
        refreshingToken = null;
      });
    return refreshingToken;
  };

  // A version of authFetch for calls that need a valid session: retries
  // once with a refreshed token if the server says the current one is
  // no longer valid, instead of failing outright.
  const authedFetchWithRetry = async (path, opts = {}) => {
    const { url, anonKey } = SB();
    const run = () =>
      fetch(`${url}${path}`, {
        ...opts,
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || anonKey}`,
          ...(opts.headers || {}),
        },
      });
    let res = await run();
    if (res.status === 401 && session?.refresh_token) {
      const refreshed = await refreshAccessToken();
      if (refreshed) res = await run();
    }
    return res;
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
    refreshAccessToken,
    authedFetch: authedFetchWithRetry,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Refresh the token proactively on every page load — cheap, and means
  // a session that's been sitting in localStorage for a while (from an
  // earlier visit) starts this page load with a token that's actually
  // valid, rather than waiting to discover it's dead on the first thing
  // that needs it. Then warm the profile (name/phone/reward points) so
  // it's ready the instant any UI asks for it.
  if (session) {
    refreshAccessToken().then(() => refreshProfile());
    // Also refresh periodically for people who stay on one page a long
    // time (e.g. slowly filling out checkout) rather than navigating —
    // 45 minutes keeps it comfortably ahead of the ~60 minute expiry.
    setInterval(refreshAccessToken, 45 * 60 * 1000);
  }
})();
