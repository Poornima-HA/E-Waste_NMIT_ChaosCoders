import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import type { Metrics } from "./api";

export default function HeroStrip() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    api<Metrics>("/api/v1/metrics").then(setM).catch(() => setM(null));
  }, []);

  if (!m) return null;
  const o = m.optimization;
  const items = [
    {
      label: "False recovery blocked",
      value: `${m.claims.blocked_kg.toLocaleString("en-IN")} kg`,
      sub: `${m.claims.blocked} invalid claim${m.claims.blocked === 1 ? "" : "s"} stopped`,
      to: "/recovery",
    },
    {
      label: "QpiAI dispatch",
      value: o ? `${o.optimized_assigned} placed` : "—",
      sub: o?.per_kg_saving_pct !== undefined ? `${o.per_kg_saving_pct}% cheaper per kg · ${o.guarantee}` : "run the optimizer",
      to: "/dispatch",
    },
    {
      label: "Anchored on-chain",
      value: `${m.blockchain.anchored_events}/${m.blockchain.events}`,
      sub: "hash-chained events",
      to: "/ledger",
    },
    {
      label: "Automated tests",
      value: m.tests ? `${m.tests.passed}/${m.tests.tests}` : "—",
      sub: "integrity rules verified",
      to: "/impact",
    },
  ];

  return (
    <div
      className="grid gap-3 rounded-xl p-4 text-white shadow-sm sm:grid-cols-2 xl:grid-cols-4"
      style={{ background: "linear-gradient(100deg, #0f172a 0%, #1e293b 55%, #064e3b 100%)" }}
    >
      {items.map((i) => (
        <Link key={i.label} to={i.to}
          className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10 transition hover:bg-white/10">
          <div className="text-xs uppercase tracking-wide text-slate-300">{i.label}</div>
          <div className="mt-1 text-2xl font-semibold">{i.value}</div>
          <div className="text-xs text-emerald-200">{i.sub}</div>
        </Link>
      ))}
    </div>
  );
}