/**
 * Structured security-event logging. Writes JSON lines to the Cloudflare
 * Functions console (visible in the Pages dashboard's real-time logs /
 * `wrangler pages deployment tail`), tagged with a per-request correlation
 * ID so related log lines can be traced without needing to log anything
 * sensitive (no OTP codes, no secrets, no full card/payment data — this
 * project has none of those, but the same rule applies to anything
 * added later).
 */
export function newRequestId() {
  return crypto.randomUUID();
}

export function logSecurityEvent(requestId, event, details = {}) {
  try {
    console.warn(
      JSON.stringify({
        type: "security_event",
        event,
        requestId,
        at: new Date().toISOString(),
        ...details,
      })
    );
  } catch {
    // Never let logging itself break the request.
  }
}
