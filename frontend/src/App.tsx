import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  BadgeCheck, BarChart3, Boxes, Factory, LayoutDashboard, Link2, Package,
  Route as RouteIcon, ShieldAlert, UserCircle,
} from "lucide-react";
import { api, currentActor, setActor } from "./api";
import type { Actor, ChainStatus } from "./api";
import ErrorBoundary from "./ErrorBoundary";
import Workspace from "./pages/Workspace";
import Dashboard from "./pages/Dashboard";
import Batches from "./pages/Batches";
import BatchPassport from "./pages/BatchPassport";
import DispatchOptimizer from "./pages/DispatchOptimizer";
import Recovery from "./pages/Recovery";
import Inventory from "./pages/Inventory";
import Certificates from "./pages/Certificates";
import AuditCentre from "./pages/AuditCentre";
import Ledger from "./pages/Ledger";
import MetricsPage from "./pages/Metrics";
import VerifyCertificate from "./pages/VerifyCertificate";
import VerifyBatch from "./pages/VerifyBatch";

const groups = [
  {
    title: "Participate",
    items: [{ to: "/workspace", label: "My workspace", icon: UserCircle }],
  },
  {
    title: "Operate",
    items: [
      { to: "/", label: "Operations", icon: LayoutDashboard },
      { to: "/batches", label: "Batches", icon: Package },
      { to: "/dispatch", label: "Dispatch Optimizer", icon: RouteIcon },
    ],
  },
  {
    title: "Recover",
    items: [
      { to: "/recovery", label: "Recovery & Claims", icon: Factory },
      { to: "/inventory", label: "Inventory", icon: Boxes },
      { to: "/certificates", label: "Certificates", icon: BadgeCheck },
    ],
  },
  {
    title: "Assure",
    items: [
      { to: "/audit", label: "Audit Centre", icon: ShieldAlert },
      { to: "/ledger", label: "Blockchain", icon: Link2 },
      { to: "/impact", label: "Impact & Evidence", icon: BarChart3 },
    ],
  },
];

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="h-9 w-9 shrink-0" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1e293b" />
      <path d="M32 11 L50 21.5 V42.5 L32 53 L14 42.5 V21.5 Z" fill="none" stroke="#34d399" strokeWidth="4" strokeLinejoin="round" />
      <path d="M23.5 32.5 l6 6 l11.5 -13" fill="none" stroke="#34d399" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChainBadge() {
  const [s, setS] = useState({ tone: "bg-slate-500", text: "Checking chain…" });

  useEffect(() => {
    const check = () =>
      api<ChainStatus>("/api/v1/blockchain/status")
        .then((c) =>
          setS(c.public
            ? { tone: "bg-emerald-400", text: `${c.network} · block ${c.latest_block}` }
            : { tone: "bg-amber-400", text: `Local demo chain · block ${c.latest_block}` }))
        .catch(() => setS({ tone: "bg-red-500", text: "Chain offline" }));
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <span className={`h-2 w-2 rounded-full ${s.tone}`} />
      {s.text}
    </div>
  );
}

function ActorSwitcher() {
  const [actors, setActors] = useState<Actor[]>([]);
  const cur = currentActor();

  useEffect(() => {
    api<Actor[]>("/api/v1/actors").then(setActors).catch(() => undefined);
  }, []);

  return (
    <div className="border-b border-slate-800 px-4 py-3">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Acting as</label>
      <select
        className="mt-1 w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm text-white"
        value={cur ?? ""}
        onChange={(e) => setActor(e.target.value || null)}
      >
        <option value="">Operator console (full access)</option>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>{a.step}. {a.role_label}: {a.name}</option>
        ))}
      </select>
    </div>
  );
}

function Shell() {
  const location = useLocation();
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-5">
          <Logo />
          <div>
            <div className="font-semibold leading-tight text-white">E-Waste Ledger</div>
            <div className="text-xs text-slate-400">Traceable recovery &amp; audit</div>
          </div>
        </div>

        <ActorSwitcher />

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {g.title}
              </div>
              <div className="space-y-0.5">
                {g.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm transition ${
                        isActive
                          ? "border-emerald-400 bg-slate-800 text-white"
                          : "border-transparent hover:bg-slate-800/60 hover:text-white"
                      }`
                    }
                  >
                    <Icon size={16} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-slate-800 p-4">
          <ChainBadge />
          <div className="text-[11px] text-slate-500">Demo data · facilities not government-verified</div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div key={location.pathname} className="page-enter mx-auto max-w-[1400px]">
          <ErrorBoundary>
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="workspace" element={<Workspace />} />
              <Route path="batches" element={<Batches />} />
              <Route path="batches/:id" element={<BatchPassport />} />
              <Route path="dispatch" element={<DispatchOptimizer />} />
              <Route path="recovery" element={<Recovery />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="certificates" element={<Certificates />} />
              <Route path="audit" element={<AuditCentre />} />
              <Route path="ledger" element={<Ledger />} />
              <Route path="impact" element={<MetricsPage />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* public, read-only, no sidebar: what a QR scan opens */}
        <Route path="/verify/certificate/:id" element={<ErrorBoundary><VerifyCertificate /></ErrorBoundary>} />
        <Route path="/verify/batch/:id" element={<ErrorBoundary><VerifyBatch /></ErrorBoundary>} />
        {/* internal console */}
        <Route path="/*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
  );
}