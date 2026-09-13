/**
 * Public Supabase project config. The anon key is meant to be public — it
 * can only ever do what Row Level Security allows, which for this project
 * is: a user can read/update their own profile and read their own reward
 * history. It can never read or write orders directly (see the ordering
 * spec / functions/_shared/supabase.js for why).
 */
window.KKR_SUPABASE = {
  url: "https://eiwkolocxqjnxgrzbntk.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpd2tvbG9jeHFqbnhncnpibnRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTYzMDgsImV4cCI6MjEwNDc5MjMwOH0.fJzYwdOxisTwTZhXzxP_dILxOVHD2EtbHpnTCNzBTdA",
};
