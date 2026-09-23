import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tech Intel", description: "One place to understand tech right now." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body style={{ fontFamily: "system-ui", background: "#0a0a0a", color: "#e5e5e5", margin: 0 }}>
        <header style={{ borderBottom: "1px solid #222", padding: "12px 16px" }}>
          <strong>Tech Intel</strong> <span style={{ color: "#888" }}>signal &gt; noise</span>
        </header>
        <main style={{ maxWidth: 880, margin: "0 auto", padding: 16 }}>{children}</main>
      </body>
    </html>
  );
}
