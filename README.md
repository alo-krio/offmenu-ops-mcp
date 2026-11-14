# OffMenu Ops MCP

A governed [Model Context Protocol](https://modelcontextprotocol.io) server for restaurant subscription operations. AI agents can read merchant health and reconcile payouts, act on small things within limits, and send anything sensitive to a human for approval.

It's modeled on how I rolled out support and operations agents at OffMenu, the restaurant subscription product I launched at CookUnity: let the agent read first, gate every sensitive action behind human approval, then grant autonomy one task at a time. **All data in this repo is synthetic.**

Live: https://offmenu-ops-mcp.vercel.app · Endpoint: `https://offmenu-ops-mcp.vercel.app/api/mcp`

## Tools

| Tool | Scope | What it does |
|---|---|---|
| `list_merchants` | `ops:read` | Restaurants, plan (15% software-only or 25% with paid acquisition), payout cadence, products (meal plans and CPG items), active subscribers |
| `get_merchant_health` | `ops:read` | The weekly report restaurants got: active, new and churned subscribers, churn rate and reasons, top acquisition channel, coupons |
| `find_subscriber` | `ops:read` | Find a subscriber and their recent orders. Emails are masked unless the caller has `ops:act` |
| `reconcile_payout` | `ops:read` | Ledger for one merchant-week: sales tax, platform fee, delivery cost, refunds charged to whoever caused the issue, net payout, release time, and a check that every dollar is accounted for |
| `request_refund` | `ops:act` | Refunds of $20 or less for low-risk reasons are approved automatically. Anything else returns a signed approval token |
| `approve_action` | `ops:approve` | A human approves a pending action. The requester can't approve their own request |
| `get_guardrail_policy` | any | Shows the caller's scopes and the limits the server enforces |

## Guardrails

- **Scoped bearer tokens.** `ops:read`, `ops:act` and `ops:approve` are separate. A public read-only token (`offmenu-demo-read`) is available so anyone can try it.
- **Staged autonomy.** Small, low-risk refunds run on their own. Larger amounts and fault-based reasons (wrong item, quality) wait for a human.
- **Stateless signed approvals.** Pending actions are HMAC-signed tokens that expire after 60 minutes, so approvals need no database and can't be edited in transit.
- **Fault-based attribution.** Late or damaged deliveries are charged to the platform. Wrong, missing or poor-quality items are charged to the restaurant.
- **PII masking.** Read-only callers see masked emails.
- **Audit trail.** Every tool call writes a structured JSON audit line to the server log.

## Money flow (reconcile_payout)

Every dollar collected from subscribers goes to one of five places: the tax authority, the restaurant, the delivery vendors, refunds back to subscribers, or the platform. The tool shows each one and checks that they add up to what was collected. Funds release 48 hours after the last fulfillment of the week, after any refunds in that window are processed. On the 25% plan the platform covers delivery and paid acquisition. On the 15% plan delivery is passed through to the restaurant.

## Connect

Claude Desktop, Cursor or any stdio client through `mcp-remote`:

```json
{
  "mcpServers": {
    "offmenu-ops": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://offmenu-ops-mcp.vercel.app/api/mcp",
               "--header", "Authorization: Bearer offmenu-demo-read"]
    }
  }
}
```

Clients that support Streamable HTTP can point straight at the endpoint with the same header.

Try asking: "Which merchant had the worst churn last week, and why?" or "Reconcile Seoul Dumpling House for the week of 2026-09-07."

## Run locally

```bash
npm install
OPERATOR_TOKEN=op-local ADMIN_TOKEN=admin-local APPROVAL_SIGNING_SECRET=change-me npm run dev
```

Environment variables:

| Variable | Purpose |
|---|---|
| `DEMO_READ_TOKEN` | Optional. Overrides the public read token |
| `OPERATOR_TOKEN` | Grants `ops:read` + `ops:act` |
| `ADMIN_TOKEN` | Grants all scopes, including `ops:approve` |
| `APPROVAL_SIGNING_SECRET` | HMAC key for approval tokens |

## What I'd add for production

- OAuth (the MCP authorization spec) instead of static tokens, with per-user identities
- A one-time-use store for approval tokens so an approval can't be replayed
- A real ledger database with idempotent writes, plus the Stripe Connect payout call behind `approve_action`
- Evals on agent behavior: does it pick the right tool, and does it escalate when it should

## Stack

Next.js route handler, [`mcp-handler`](https://github.com/vercel/mcp-handler), MCP TypeScript SDK v2, Zod. Deployed on Vercel.
