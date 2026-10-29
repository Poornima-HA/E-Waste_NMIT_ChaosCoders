import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Boxes, Factory, LayoutDashboard, Link2, Package, Route as RouteIcon, ShieldAlert } from "lucide-react";
import ErrorBoundary from "./ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import Batches from "./pages/Batches";
import BatchPassport from "./pages/BatchPassport";
import DispatchOptimizer from "./pages/DispatchOptimizer";
import Recovery from "./pages/Recovery";
import Inventory from "./pages/Inventory";
import AuditCentre from "./pages/AuditCentre";
import Ledger from "./pages/Ledger";

const nav = [
  { to: "/", label: "Operations", icon: LayoutDashboard },
  { to: "/batches", label: "Batches", icon: Package },
  { to: "/dispatch", label: "Dispatch Optimizer", icon: RouteIcon },
  { to: "/recovery", label: "Recovery & Claims", icon: Factory },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/audit", label: "Audit Centre", icon: ShieldAlert },
  { to: "/ledger", label: "Blockchain", icon: Link2 },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
          <div className="border-b border-slate-800 px-5 py-5">
            <div className="font-semibold text-white">E-Waste Ledger</div>
            <div className="text-xs text-slate-400">Traceable recovery &amp; audit</div>
          </div>
          <nav className="space-y-1 p-3">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    isActive ? "bg-slate-800 text-white" : "hover:bg-slate-800/60"
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto p-4 text-xs text-slate-500">
            Demo data · facilities not government-verified
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/batches" element={<Batches />} />
              <Route path="/batches/:id" element={<BatchPassport />} />
              <Route path="/dispatch" element={<DispatchOptimizer />} />
              <Route path="/recovery" element={<Recovery />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/audit" element={<AuditCentre />} />
              <Route path="/ledger" element={<Ledger />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}