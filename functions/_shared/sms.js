/**
 * OTP / SMS provider abstraction.
 *
 * IMPORTANT: this file is architecture-only. Nothing in the checkout or
 * order-creation flow calls this yet. OTP is controlled by the
 * `otp_enabled` row in the settings table, which defaults to false — a
 * restaurant that hasn't set up (and paid for) an SMS provider can accept
 * orders normally forever without ever touching this file.
 *
 * When a restaurant is ready to turn OTP on:
 *   1. Set settings.otp_enabled = true (via /api/admin/settings, same
 *      pattern as tax_rate/reward_rate).
 *   2. Implement one concrete provider below (e.g. a Pakistani SMS
 *      gateway) that fulfills the SmsProvider shape.
 *   3. Wire a call to getSmsProvider(env).sendOtp(...) /
 *      verifyOtp(...) into the checkout flow at the appropriate step.
 * No other application code needs to change — order.js, checkout.js, and
 * the rest of the ordering system are written to work identically whether
 * or not OTP ever gets enabled.
 *
 * Conceptual shape every provider must implement:
 *   sendOtp(phone: string): Promise<{ success: boolean }>
 *   verifyOtp(phone: string, code: string): Promise<{ success: boolean }>
 */

class UnconfiguredSmsProvider {
  async sendOtp() {
    throw new Error("No SMS provider is configured. Set OTP_PROVIDER and implement it before enabling OTP.");
  }
  async verifyOtp() {
    throw new Error("No SMS provider is configured. Set OTP_PROVIDER and implement it before enabling OTP.");
  }
}

/**
 * Returns the configured SMS provider. Currently always returns the
 * unconfigured stub, since no real provider exists yet — this is
 * intentional per the project's requirement that OTP must not be
 * implemented until a real SMS provider is actually available. Swapping
 * in a real provider later means adding one branch here, not rewriting
 * the ordering system.
 */
export function getSmsProvider(env) {
  switch (env.OTP_PROVIDER) {
    // case "twilio": return new TwilioSmsProvider(env);
    // case "some-pakistani-provider": return new SomeLocalSmsProvider(env);
    default:
      return new UnconfiguredSmsProvider();
  }
}

/** Reads OTP configuration from the settings table (same table/pattern as
 *  tax_rate, delivery_fee, reward_rate) so it's admin-configurable without
 *  a deploy, exactly like the rest of the storefront settings. */
export async function getOtpSettings(dbSelect, env) {
  const rows = await dbSelect(env, "settings", "select=key,value&key=in.(otp_enabled,otp_required_for,otp_fallback_mode,otp_expiry_seconds,otp_resend_cooldown_seconds,otp_max_attempts)");
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map.otp_enabled === true || map.otp_enabled === "true",
    requiredFor: map.otp_required_for || "guest_orders",
    fallbackMode: map.otp_fallback_mode || "allow_order",
    expirySeconds: Number(map.otp_expiry_seconds) || 300,
    resendCooldownSeconds: Number(map.otp_resend_cooldown_seconds) || 60,
    maxAttempts: Number(map.otp_max_attempts) || 5,
  };
}
