import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitBranch, GitMerge } from "lucide-react";
import { api } from "./api";
import type { BatchSummary, Lineage } from "./api";

type Props = {
  batchId: string;
  status: string;
  custodian: string;
  category: string;
  onChange: () => void;
};

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50";

function Chip({ id, mass, active }: { id: string; mass: number; active?: boolean }) {
  return (
    <Link
      to={`/batches/${id}`}
      className={`inline-block rounded-md border px-3 py-2 text-sm ${
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50"
      }`}
    >
      <div className="font-medium">{id}</div>
      <div className={`text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>{mass} kg</div>
    </Link>
  );
}

export default function LineagePanel({ batchId, status, custodian, category, onChange }: Props) {
  const [lin, setLin] = useState<Lineage | null>(null);
  const [all, setAll] = useState<BatchSummary[]>([]);
  const [parts, setParts] = useState<string[]>([]);
  const [mergeWith, setMergeWith] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [l, b] = await Promise.all([
      api<Lineage>(`/api/v1/batches/${batchId}/lineage`),
      api<BatchSummary[]>("/api/v1/batches"),
    ]);
    setLin(l);
    setAll(b);
    if (l.available_kg !== null) {
      const half = String(Math.round((l.available_kg / 2) * 1000) / 1000);
      setParts((prev) => (prev.length ? prev : [half, half]));
    }
  };

  useEffect(() => {
    setParts([]);
    setMergeWith([]);
    setMsg(null);
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [batchId]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: `${label} recorded with mass conservation verified` });
      await load();
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!lin) return null;

  const parents = lin.edges.filter((e) => e.child_id === batchId);
  const children = lin.edges.filter((e) => e.parent_id === batchId);
  const incoming = new Set(lin.edges.map((e) => e.child_id));
  const origins = lin.nodes.filter((n) => !incoming.has(n.id));
  const me = lin.nodes.find((n) => n.id === batchId);
  const open = status === "collected" || status === "received";
  const candidates = all.filter(
    (x) =>
      x.id !== batchId &&
      x.custodian === custodian &&
      x.category === category &&
      (x.status === "collected" || x.status === "received"),
  );
  const partsTotal = parts.reduce((s, p) => s + (Number(p) || 0), 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <GitBranch size={16} /> Batch lineage
      </h2>

      {/* family view: parents -> this batch -> children */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-2">
          {parents.length === 0 ? (
            <span className="text-xs text-slate-400">no parent (original batch)</span>
          ) : (
            parents.map((e) => <Chip key={e.parent_id} id={e.parent_id} mass={e.mass_kg} />)
          )}
        </div>
        <span className="text-slate-400">
          {parents.length ? (parents[0].relation === "merge" ? "⇉ merge ⇉" : "→ split →") : ""}
        </span>
        <Chip id={batchId} mass={me?.mass_kg ?? 0} active />
        <span className="text-slate-400">
          {children.length ? (children[0].relation === "merge" ? "⇉ merged into ⇉" : "→ split into →") : ""}
        </span>
        <div className="flex flex-col gap-2">
          {children.map((e) => (
            <Chip key={e.child_id} id={e.child_id} mass={e.mass_kg} />
          ))}
        </div>
      </div>

      {lin.nodes.length > 1 && (
        <p className="mt-3 text-xs text-slate-500">
          Family of {lin.nodes.length} batches · traced back to original batch(es):{" "}
          {origins.map((o) => `${o.id} (from ${o.source})`).join(", ")}
        </p>
      )}

      {msg && (
        <p className={`mt-3 rounded-md p-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          {msg.text}
        </p>
      )}

      {/* split + merge actions (only for open, undisputed batches) */}
      {open && lin.available_kg !== null && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* split */}
          <div className="rounded-md border border-slate-200 p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <GitBranch size={14} /> Split this batch ({lin.available_kg} kg held)
            </h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {parts.map((p, i) => (
                <label key={i} className="text-xs text-slate-500">
                  {batchId}-{String.fromCharCode(65 + i)}
                  <input
                    className={`${input} block w-28`}
                    type="number"
                    value={p}
                    onChange={(e) => setParts(parts.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                </label>
              ))}
              {parts.length < 6 && (
                <button
                  className="rounded border border-slate-300 px-2 py-2 text-xs"
                  onClick={() => setParts([...parts, "0"])}
                >
                  + part
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Parts total {partsTotal} kg of {lin.available_kg} kg · loss tolerance 0.5% (demo)
            </p>
            <button
              className={`${btn} mt-2`}
              disabled={busy}
              onClick={() =>
                run("Split", () =>
                  api(`/api/v1/batches/${batchId}/split`, {
                    method: "POST",
                    body: JSON.stringify({
                      children: parts.map((kg, i) => ({
                        id: `${batchId}-${String.fromCharCode(65 + i)}`,
                        mass: { value: Number(kg), unit: "kg" },
                      })),
                      operator: `${custodian}-ops`,
                      reason: "Split for separate processing lines",
                    }),
                  }),
                )
              }
            >
              Split
            </button>
          </div>

          {/* merge */}
          <div className="rounded-md border border-slate-200 p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <GitMerge size={14} /> Merge with other {category} batches at {custodian}
            </h3>
            {candidates.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No other open {category} batch at {custodian}.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {candidates.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={mergeWith.includes(c.id)}
                      onChange={(e) =>
                        setMergeWith(
                          e.target.checked ? [...mergeWith, c.id] : mergeWith.filter((x) => x !== c.id),
                        )
                      }
                    />
                    {c.id} · {c.net_mass_kg} kg
                  </label>
                ))}
              </div>
            )}
            <button
              className={`${btn} mt-2`}
              disabled={busy || mergeWith.length === 0}
              onClick={() =>
                run("Merge", () =>
                  api("/api/v1/batches/merge", {
                    method: "POST",
                    body: JSON.stringify({
                      id: `${batchId}-M`,
                      parent_ids: [batchId, ...mergeWith],
                      operator: `${custodian}-ops`,
                      reason: "Consolidated into one truckload",
                    }),
                  }),
                )
              }
            >
              Merge into {batchId}-M
            </button>
          </div>
        </div>
      )}

      {/* locked notice for disputed batches */}
      {open && lin.available_kg === null && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          🔒 <b>Split/merge locked:</b> this batch has a <b>disputed receipt</b>. Resolve the weight dispute
          first, so a discrepancy can't be hidden behind new batch IDs.
        </p>
      )}
    </div>
  );
}