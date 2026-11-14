export const metadata = { title: "OffMenu Ops MCP", description: "A governed MCP server for restaurant subscription operations." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif", background: "#faf8f4", color: "#1f1d1a" }}>{children}</body>
    </html>
  );
}
