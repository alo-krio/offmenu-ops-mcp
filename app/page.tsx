const tools = [
  ["list_merchants", "ops:read", "Restaurants, plans, payout cadence, products and active subscribers."],
  ["get_merchant_health", "ops:read", "The weekly health report: new, churned, churn reasons, top channel, coupons."],
  ["find_subscriber", "ops:read", "Look up a subscriber and recent orders. Emails masked without ops:act."],
  ["reconcile_payout", "ops:read", "Ledger for a merchant-week: tax, fees, delivery, refunds by fault, net payout, 48h release."],
  ["request_refund", "ops:act", "Small low-risk refunds run automatically. Everything else returns a signed approval token."],
  ["approve_action", "ops:approve", "A human approves the pending action. Requesters cannot approve themselves."],
  ["get_guardrail_policy", "any", "Shows the scopes and limits the server enforces."],
];

export default function Home() {
  const url = "https://offmenu-ops-mcp.vercel.app/api/mcp";
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px 80px", lineHeight: 1.6 }}>
      <p style={{ letterSpacing: 2, textTransform: "uppercase", fontSize: 12, color: "#7a6f60", margin: 0 }}>Model Context Protocol server</p>
      <h1 style={{ fontSize: 40, margin: "8px 0 12px", lineHeight: 1.15 }}>OffMenu Ops MCP</h1>
      <p style={{ fontSize: 18, color: "#4a443c", marginTop: 0 }}>
        A governed MCP server for restaurant subscription operations. Agents can read merchant health and reconcile payouts freely,
        act on small things within limits, and send anything sensitive to a human for approval.
      </p>
      <p style={{ color: "#4a443c" }}>
        It is modeled on how I rolled out support and operations agents at OffMenu (CookUnity): read first, gate every sensitive action behind
        human approval, then grant autonomy task by task. All data here is synthetic.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 40 }}>Tools</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #e4ddd2" }}><th style={{ padding: "8px 8px 8px 0" }}>Tool</th><th style={{ padding: 8 }}>Scope</th><th style={{ padding: 8 }}>What it does</th></tr></thead>
        <tbody>
          {tools.map(([n, s, d]) => (
            <tr key={n} style={{ borderBottom: "1px solid #ece6dc", verticalAlign: "top" }}>
              <td style={{ padding: "8px 8px 8px 0" }}><code>{n}</code></td>
              <td style={{ padding: 8, whiteSpace: "nowrap" }}><code>{s}</code></td>
              <td style={{ padding: 8 }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 22, marginTop: 40 }}>Try it</h2>
      <p>Endpoint (Streamable HTTP): <code>{url}</code></p>
      <p>Public read-only token: <code>offmenu-demo-read</code></p>
      <pre style={{ background: "#1f1d1a", color: "#f4efe6", padding: 16, borderRadius: 8, overflowX: "auto", fontSize: 13 }}>{`{
  "mcpServers": {
    "offmenu-ops": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${url}",
               "--header", "Authorization: Bearer offmenu-demo-read"]
    }
  }
}`}</pre>
      <p style={{ color: "#4a443c" }}>Then ask your agent something like: "Which merchant had the worst churn last week, and why?" or "Reconcile Seoul Dumpling House for the week of 2026-09-07."</p>

      <p style={{ marginTop: 48, fontSize: 14, color: "#7a6f60" }}>
        Built by Aman Lohia · <a href="https://linkedin.com/in/amanlohia" style={{ color: "#7a6f60" }}>LinkedIn</a>
      </p>
    </main>
  );
}
