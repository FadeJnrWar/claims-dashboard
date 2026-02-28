"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const C = {
  bg: "#0B0F1A", sidebar: "#090D16", card: "#111827", elevated: "#1A2332",
  border: "#1E2D3D", accent: "#00E5A0", accentDim: "#00B87D",
  text: "#F0F4F8", sub: "#8899AA", muted: "#556677",
  purple: "#A78BFA", blue: "#60A5FA",
};

const NAV_ITEMS = [
  { href: "/", label: "Claims Dashboard", icon: "📊", desc: "Real-time monitoring" },
  { href: "/query-builder", label: "Query Builder", icon: "⚡", desc: "SQL generator & templates" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: 240, minHeight: "100vh", background: C.sidebar,
      borderRight: `1px solid ${C.border}`, display: "flex",
      flexDirection: "column", position: "fixed", top: 0, left: 0, zIndex: 50,
    }}>
      {/* Brand — Curacel Logo */}
      <div style={{ padding: "20px 18px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* ✅ Improvement #5: Curacel logo replaces the green "C" box */}
          <img
            src="/curacel-logo.png"
            alt="Curacel"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              objectFit: "contain",
              background: "transparent",
            }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>Claims Intel</div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 500 }}>Curacel Health Ops</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "12px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".08em", padding: "8px 8px 4px", marginBottom: 2 }}>
          Navigation
        </div>
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, textDecoration: "none",
              background: active ? `${C.accent}15` : "transparent",
              border: active ? `1.5px solid ${C.accent}40` : "1.5px solid transparent",
              transition: "all .15s",
            }}>
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? C.accent : C.sub, lineHeight: 1.2 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{item.desc}</div>
              </div>
            </Link>
          );
        })}

        {/* Future tools placeholder */}
        <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".08em", padding: "16px 8px 4px", marginTop: 8 }}>
          Coming Soon
        </div>
        {[
          { icon: "🔔", label: "Alerts & SLA", desc: "Breach monitoring" },
          { icon: "📈", label: "Analytics", desc: "Trends & insights" },
        ].map((item, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, opacity: 0.4, cursor: "default",
          }}>
            <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{item.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.muted, lineHeight: 1.2 }}>{item.label}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted }}>
        v3.1 · Health Ops Tools
      </div>
    </aside>
  );
}
