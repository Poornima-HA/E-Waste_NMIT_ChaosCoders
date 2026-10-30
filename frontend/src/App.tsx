import CertificatePrint from "./pages/CertificatePrint";
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

const allItems = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));

function pageFor(pathname: string) {
  if (pathname.startsWith("/batches/")) return { label: "Batch Passport", group: "Operate" };
  const hit = allItems.find((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));
  return hit ? { label: hit.label, group: hit.group } : { label: "E-Waste Ledger", group: "" };
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="h-9 w-9 shrink-0" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#4f46e5" />
      <path d="M32 11 L50 21.5 V42.5 L32 53 L14 42.5 V21.5 Z" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinejoin="round" />
      <path d="M23.5 32.5 l6 6 l11.5 -13" fill="none" stroke="#fbbf24" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChainBadge() {
  const [s, setS] = useState({ tone: "bg-slate-400", text: "Checking chain…" });

  useEffect(() => {
    const check = () =>
      api<ChainStatus>("/api/v1/blockchain/status")
        .then((c) =>
          setS(c.public
            ? { tone: "bg-teal-500", text: `${c.network} · block ${c.latest_block}` }
            : { tone: "bg-amber-500", text: `Local demo chain · block ${c.latest_block}` }))
        .catch(() => setS({ tone: "bg-red-500", text: "Chain offline" }));
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="hidden items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-slate-600 md:flex">
      <span className={`h-2 w-2 rounded-full ${s.tone}`} />
      <span className="font-mono">{s.text}</span>
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
    <label className="flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-1 text-xs font-semibold text-brand-700">
      <UserCircle size={15} />
      <span className="hidden sm:inline">Acting as</span>
      <select
        className="max-w-[260px] rounded-full border-0 bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm outline-none"
        value={cur ?? ""}
        onChange={(e) => setActor(e.target.value || null)}
      >
        <option value="">Operator console (full access)</option>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>{a.step}. {a.role_label}: {a.name}</option>
        ))}
      </select>
    </label>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-white">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo />
        <div>
          <div className="text-[15px] font-bold leading-tight text-slate-900">E-Waste Ledger</div>
          <div className="text-xs text-slate-500">Traceable recovery &amp; audit</div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {g.title}
            </div>
            <div className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-brand-50 text-brand-700"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-md ${
                          isActive ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <Icon size={15} />
                      </span>
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-4 text-[11px] leading-relaxed text-slate-400">
        Demo data · facilities not government-verified
      </div>
    </aside>
  );
}

function TopBar() {
  const { pathname } = useLocation();
  const page = pageFor(pathname);
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-white/85 px-6 backdrop-blur">
      <div className="min-w-0">
        {page.group && (
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{page.group}</div>
        )}
        <div className="truncate text-base font-bold text-slate-900">{page.label}</div>
      </div>
      <div className="flex items-center gap-3">
        <ChainBadge />
        <ActorSwitcher />
      </div>
    </header>
  );
}

function Shell() {
  const location = useLocation();
  return (
    <div className="flex min-h-screen bg-canvas text-slate-900">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <TopBar />
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
        <Route path="/verify/certificate/:id/print" element={<ErrorBoundary><CertificatePrint /></ErrorBoundary>} />
        <Route path="/verify/certificate/:id" element={<ErrorBoundary><VerifyCertificate /></ErrorBoundary>} />
        <Route path="/verify/batch/:id" element={<ErrorBoundary><VerifyBatch /></ErrorBoundary>} />
        {/* internal console */}
        <Route path="/*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
  );
}