import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { merchants, orders, subscribers, WEEKS, weekFromISO, weekStartISO } from "@/lib/data";
import { reconcileWeek } from "@/lib/ledger";
import { ATTRIBUTION, type ReasonCode } from "@/lib/refunds";
import { POLICY, audit, hasScope, lookupToken, signApproval, verifyApproval, type Scope } from "@/lib/governance";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const denied = (needed: Scope) => ({ isError: true, content: [{ type: "text" as const, text: `Missing scope ${needed}.` }] });
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");
const REASONS = ["late_delivery", "damaged_in_transit", "missing_item", "wrong_item", "quality_issue"] as const;

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_merchants",
      {
        title: "List merchants",
        description: "List restaurant merchants with their plan, payout cadence, products and current active subscribers.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => {
        const auth = ctx.http?.authInfo;
        if (!hasScope(auth?.scopes, "ops:read")) return denied("ops:read");
        audit({ tool: "list_merchants", client: auth?.clientId });
        const last = WEEKS - 1;
        return json(merchants.map(m => ({
          id: m.id, name: m.name, cuisine: m.cuisine, city: m.city, plan: m.plan, payout_cadence: m.payoutCadence,
          products: m.products,
          active_subscribers: subscribers.filter(s => s.merchantId === m.id && s.joinedWeek <= last && (s.churnedWeek === null || s.churnedWeek > last)).length,
        })));
      },
    );

    server.registerTool(
      "get_merchant_health",
      {
        title: "Merchant health report",
        description: "Weekly subscription health for one merchant: active, new and churned subscribers, churn rate, churn reasons, top acquisition channel and coupon usage. This is the report restaurants received each week.",
        inputSchema: z.object({
          merchant_id: z.string().describe("e.g. m_bangkok_corner"),
          week_start: z.string().optional().describe("ISO date of the week's Monday, e.g. 2026-10-26. Defaults to the latest week."),
        }),
      },
      async ({ merchant_id, week_start }, ctx) => {
        const auth = ctx.http?.authInfo;
        if (!hasScope(auth?.scopes, "ops:read")) return denied("ops:read");
        const m = merchants.find(x => x.id === merchant_id);
        if (!m) return { isError: true, content: [{ type: "text" as const, text: `Unknown merchant. Try list_merchants.` }] };
        const w = week_start ? weekFromISO(week_start) : WEEKS - 1;
        if (w === null) return { isError: true, content: [{ type: "text" as const, text: `Week must be between ${weekStartISO(0)} and ${weekStartISO(WEEKS - 1)}.` }] };
        audit({ tool: "get_merchant_health", client: auth?.clientId, merchant_id, week: w });
        const ms = subscribers.filter(s => s.merchantId === m.id);
        const activeAtStart = ms.filter(s => s.joinedWeek < w && (s.churnedWeek === null || s.churnedWeek >= w));
        const newSubs = ms.filter(s => s.joinedWeek === w);
        const churned = ms.filter(s => s.churnedWeek === w);
        const active = ms.filter(s => s.joinedWeek <= w && (s.churnedWeek === null || s.churnedWeek > w));
        const count = <T extends string>(xs: (T | null)[]) => xs.reduce((a, x) => (x ? ((a[x] = (a[x] || 0) + 1), a) : a), {} as Record<string, number>);
        const channels = count(newSubs.map(s => s.channel));
        return json({
          merchant: m.name,
          week_start: weekStartISO(w),
          active_subscribers: active.length,
          new_subscribers: newSubs.length,
          churned_subscribers: churned.length,
          churn_rate: activeAtStart.length ? Math.round((churned.length / activeAtStart.length) * 1000) / 10 + "%" : "n/a",
          churn_reasons: count(churned.map(s => s.churnReason)),
          new_by_channel: channels,
          top_channel: Object.entries(channels).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
          coupons_used: count(newSubs.map(s => s.coupon)),
          orders_this_week: orders.filter(o => o.merchantId === m.id && o.week === w).length,
        });
      },
    );

    server.registerTool(
      "find_subscriber",
      {
        title: "Find subscriber",
        description: "Look up a subscriber by name or email fragment, with their recent orders. Emails are masked unless the caller has ops:act.",
        inputSchema: z.object({ query: z.string().min(2) }),
      },
      async ({ query }, ctx) => {
        const auth = ctx.http?.authInfo;
        if (!hasScope(auth?.scopes, "ops:read")) return denied("ops:read");
        const canSeePii = hasScope(auth?.scopes, "ops:act");
        const q = query.toLowerCase();
        const hits = subscribers.filter(s => s.name.toLowerCase().includes(q) || s.email.includes(q)).slice(0, 5);
        audit({ tool: "find_subscriber", client: auth?.clientId, results: hits.length, pii_visible: canSeePii });
        return json(hits.map(s => ({
          id: s.id, name: s.name, email: canSeePii ? s.email : mask(s.email),
          merchant: merchants.find(m => m.id === s.merchantId)?.name,
          joined: weekStartISO(s.joinedWeek), status: s.churnedWeek === null ? "active" : `churned ${weekStartISO(s.churnedWeek)} (${s.churnReason})`,
          recent_orders: orders.filter(o => o.subscriberId === s.id).slice(-3).map(o => ({ id: o.id, sku: o.sku, amount: o.amount, fulfilled_at: o.fulfilledAt })),
        })));
      },
    );

    server.registerTool(
      "reconcile_payout",
      {
        title: "Reconcile payout",
        description: "Ledger for one merchant-week: money collected, sales tax, platform fee, delivery cost, refunds charged to the merchant or absorbed by the platform, net payout and when funds release (48h after the last fulfillment). Includes a check that every dollar is accounted for.",
        inputSchema: z.object({ merchant_id: z.string(), week_start: z.string().describe("ISO Monday, e.g. 2026-09-07") }),
      },
      async ({ merchant_id, week_start }, ctx) => {
        const auth = ctx.http?.authInfo;
        if (!hasScope(auth?.scopes, "ops:read")) return denied("ops:read");
        const w = weekFromISO(week_start);
        if (w === null) return { isError: true, content: [{ type: "text" as const, text: `Week must be between ${weekStartISO(0)} and ${weekStartISO(WEEKS - 1)}.` }] };
        try {
          const result = reconcileWeek(merchant_id, w);
          audit({ tool: "reconcile_payout", client: auth?.clientId, merchant_id, week: w, balanced: result.balanced });
          return json(result);
        } catch (e) {
          return { isError: true, content: [{ type: "text" as const, text: String((e as Error).message) }] };
        }
      },
    );

    server.registerTool(
      "request_refund",
      {
        title: "Request refund",
        description: "Request a refund on an order. Small refunds for low-risk reasons are approved automatically. Anything else returns a pending approval token that a human with ops:approve must confirm via approve_action. The cost is attributed to the merchant or the platform based on the reason.",
        inputSchema: z.object({
          order_id: z.string(),
          reason: z.enum(REASONS),
          amount: z.number().positive().optional().describe("Defaults to the full order amount."),
        }),
      },
      async ({ order_id, reason, amount }, ctx) => {
        const auth = ctx.http?.authInfo;
        if (!hasScope(auth?.scopes, "ops:act")) return denied("ops:act");
        const o = orders.find(x => x.id === order_id);
        if (!o) return { isError: true, content: [{ type: "text" as const, text: "Unknown order." }] };
        const amt = Math.min(amount ?? o.amount, o.amount);
        const chargedTo = ATTRIBUTION[reason as ReasonCode];
        const auto = amt <= POLICY.auto_approve_max_refund && POLICY.auto_approve_reasons.includes(reason);
        if (auto) {
          audit({ tool: "request_refund", client: auth?.clientId, order_id, amount: amt, reason, decision: "auto_approved" });
          return json({ status: "approved", order_id, amount: amt, reason, charged_to: chargedTo, note: "Within auto-approve limits." });
        }
        const approval_token = signApproval({ action: "refund", order_id, amount: amt, reason, charged_to: chargedTo, requested_by: auth?.clientId });
        audit({ tool: "request_refund", client: auth?.clientId, order_id, amount: amt, reason, decision: "pending_approval" });
        return json({
          status: "pending_approval", order_id, amount: amt, reason, charged_to: chargedTo,
          why: amt > POLICY.auto_approve_max_refund ? `Over the $${POLICY.auto_approve_max_refund} auto-approve limit.` : `"${reason}" always needs a human.`,
          approval_token, expires_in_minutes: POLICY.approval_ttl_minutes,
        });
      },
    );

    server.registerTool(
      "approve_action",
      {
        title: "Approve pending action",
        description: "Approve a pending action using its signed approval token. Requires ops:approve. The requester cannot approve their own request.",
        inputSchema: z.object({ approval_token: z.string() }),
      },
      async ({ approval_token }, ctx) => {
        const auth = ctx.http?.authInfo;
        if (!hasScope(auth?.scopes, "ops:approve")) return denied("ops:approve");
        const v = verifyApproval(approval_token);
        if (!v.ok) return { isError: true, content: [{ type: "text" as const, text: v.error }] };
        if (v.payload.requested_by === auth?.clientId) return { isError: true, content: [{ type: "text" as const, text: "Requester cannot approve their own action." }] };
        audit({ tool: "approve_action", client: auth?.clientId, action: v.payload.action, order_id: v.payload.order_id, amount: v.payload.amount });
        return json({ status: "approved", approved_by: auth?.clientId, ...v.payload, exp: undefined });
      },
    );

    server.registerTool(
      "get_guardrail_policy",
      {
        title: "Guardrail policy",
        description: "Explain the scopes, auto-approve limits and approval rules this server enforces.",
        inputSchema: z.object({}),
      },
      async (_a, ctx) => json({ your_scopes: ctx.http?.authInfo?.scopes ?? [], ...POLICY }),
    );
  },
  { serverInfo: { name: "offmenu-ops-mcp", version: "1.0.0" } },
);

const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  if (!bearer) return undefined;
  const t = lookupToken(bearer);
  if (!t) return undefined;
  return { token: bearer, clientId: t.clientId, scopes: t.scopes };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true, requiredScopes: ["ops:read"] });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
