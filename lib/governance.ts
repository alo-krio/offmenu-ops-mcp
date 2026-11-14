import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Guardrails, modeled on how the OffMenu agents were rolled out:
 * read freely, act on trivial things within limits, and send anything
 * sensitive to a human for approval.
 */
export type Scope = "ops:read" | "ops:act" | "ops:approve";

export const POLICY = {
  auto_approve_max_refund: 20,
  auto_approve_reasons: ["late_delivery", "missing_item"],
  approval_ttl_minutes: 60,
  pii: "Subscriber emails are masked unless the caller has ops:act.",
  notes: [
    "Read tools need ops:read.",
    "request_refund needs ops:act. Small refunds for low-risk reasons run automatically; everything else returns a pending approval.",
    "approve_action needs ops:approve and a valid, unexpired approval token. Tokens are HMAC-signed, so approvals need no database and cannot be edited.",
    "Every tool call writes a structured audit line to the server log.",
  ],
};

const TOKENS: Record<string, { clientId: string; scopes: Scope[] }> = {};
function loadTokens() {
  if (Object.keys(TOKENS).length) return TOKENS;
  // A public, read-only demo token so anyone can try the server.
  TOKENS[process.env.DEMO_READ_TOKEN || "offmenu-demo-read"] = { clientId: "demo-reader", scopes: ["ops:read"] };
  if (process.env.OPERATOR_TOKEN) TOKENS[process.env.OPERATOR_TOKEN] = { clientId: "operator", scopes: ["ops:read", "ops:act"] };
  if (process.env.ADMIN_TOKEN) TOKENS[process.env.ADMIN_TOKEN] = { clientId: "admin", scopes: ["ops:read", "ops:act", "ops:approve"] };
  return TOKENS;
}
export function lookupToken(token: string) {
  return loadTokens()[token];
}

const secret = () => process.env.APPROVAL_SIGNING_SECRET || "dev-only-secret-change-me";
const b64 = (s: string) => Buffer.from(s).toString("base64url");

export function signApproval(payload: Record<string, unknown>) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + POLICY.approval_ttl_minutes * 60000 }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyApproval(token: string): { ok: true; payload: any } | { ok: false; error: string } {
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, error: "Malformed approval token." };
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "Signature check failed." };
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (Date.now() > payload.exp) return { ok: false, error: "Approval token expired." };
  return { ok: true, payload };
}

export function hasScope(scopes: string[] | undefined, needed: Scope) {
  return !!scopes?.includes(needed);
}

export function audit(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ type: "audit", at: new Date().toISOString(), ...entry }));
}
