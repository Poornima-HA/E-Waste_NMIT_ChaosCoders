import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { LayoutDashboard, Package, Route as RouteIcon, ShieldAlert, Link2 } from "lucide-react";
import Dashboard from "./pages/Dashboard";

const nav = [
  { to: "/", label: "Operations", icon: LayoutDashboard },
  { to: "/batches", label: "Batches", icon: Package },
  { to: "/dispatch", label: "Dispatch Optimizer", icon: RouteIcon },
  { to: "/audit", label: "Audit Centre", icon: ShieldAlert },
  { to: "/ledger", label: "Blockchain", icon: Link2 },
];

function Soon({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-500">Coming in the next step.</p>
    </div>
  );
}

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
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/batches" element={<Soon title="Batches" />} />
            <Route path="/dispatch" element={<Soon title="Dispatch Optimizer" />} />
            <Route path="/audit" element={<Soon title="Audit Centre" />} />
            <Route path="/ledger" element={<Soon title="Blockchain" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}