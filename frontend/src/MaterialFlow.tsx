import { useEffect, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { Waypoints } from "lucide-react";
import { api } from "./api";

type FlowNode = { name: string; col: number; color: string };
type Flow = {
  nodes: FlowNode[];
  links: { source: number; target: number; value: number }[];
  summary: { tracked_kg: number; processed_kg: number; recovered_kg: number;
    recovery_pct: number | null; unexplained_kg: number; certified_kg: number };
};

const kg = (n: number) => `${Math.round(n).toLocaleString("en-IN")} kg`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NodeShape(props: any) {
  const { x, y, width, height, payload } = props;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 3)} rx={2} fill={payload.color} />
      <text x={x + width + 8} y={y + height / 2} dominantBaseline="middle" fontSize={12} fill="#0f172a">
        <tspan fontWeight={600}>{payload.name}</tspan>
        <tspan fill="#64748b" dx={6}>{kg(payload.value)}</tspan>
        {payload.note && <tspan fill="#059669" dx={6}>({payload.note})</tspan>}
      </text>
    </g>
  );
}

export default function MaterialFlow() {
  const [f, setF] = useState<Flow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Flow>("/api/v1/analytics/material-flow").then(setF).catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-medium"><Waypoints size={16} /> Where did every kilogram go?</h2>
          <p className="text-xs text-slate-500">Live material flow from collection to recovered, claimed and certified material</p>
        </div>
        {f && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-3 py-1">{kg(f.summary.tracked_kg)} tracked</span>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-teal-800">{kg(f.summary.processed_kg)} processed</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
              {kg(f.summary.recovered_kg)} recovered{f.summary.recovery_pct !== null && ` (${f.summary.recovery_pct}%)`}
            </span>
            <span className="rounded-full bg-red-50 px-3 py-1 text-red-800">{kg(f.summary.unexplained_kg)} unexplained</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">{kg(f.summary.certified_kg)} certified</span>
          </div>
        )}
      </div>

      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
      {f && f.links.length === 0 && <p className="mt-3 text-sm text-slate-500">No material movements recorded yet.</p>}
      {f && f.links.length > 0 && (
        <div className="mt-3 h-[380px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={{ nodes: f.nodes, links: f.links }}
              node={<NodeShape />}
              nodeWidth={10}
              nodePadding={22}
              margin={{ top: 10, right: 360, bottom: 10, left: 10 }}
              link={{ stroke: "#94a3b8", strokeOpacity: 0.3 }}
            >
              <Tooltip formatter={(v) => `${Number(v).toLocaleString("en-IN")} kg`} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}