import type { BatchDetail } from "./api";

type Step = { label: string; state: "done" | "warn" | "current" | "todo"; note?: string };

const DOT: Record<Step["state"], string> = {
  done: "bg-emerald-500 text-white",
  warn: "bg-amber-500 text-white",
  current: "bg-blue-600 text-white ring-4 ring-blue-100",
  todo: "bg-slate-200 text-slate-500",
};
const ICON: Record<Step["state"], string> = { done: "✓", warn: "!", current: "•", todo: "" };

export default function JourneyStepper({ b }: { b: BatchDetail }) {
  const types = new Set(b.events.map((e) => e.type));
  const t = b.transfers[b.transfers.length - 1];
  const steps: Step[] = [{ label: "Collected", state: "done", note: `${b.net_mass_kg} kg at ${b.source}` }];

  if (!t) {
    steps.push({ label: "Dispatched", state: "todo" }, { label: "Received", state: "todo" });
  } else {
    steps.push({ label: "Dispatched", state: "done", note: `${t.from} → ${t.to}` });
    if (t.receipt_kg === null) {
      steps.push({ label: "Received", state: "current", note: "in transit" });
    } else {
      const gap = t.dispatch_kg - t.receipt_kg;
      steps.push(t.status === "disputed"
        ? { label: "Received", state: "warn", note: `${gap.toFixed(1)} kg gap · disputed` }
        : { label: "Received", state: "done", note: `${t.receipt_kg} kg at ${t.to}` });
    }
  }

  steps.push({ label: "Processed", state: types.has("PROCESSED") ? "done" : "todo" });
  steps.push({ label: "Claimed", state: types.has("CLAIM_ACCEPTED") ? "done" : "todo" });
  steps.push({
    label: "Certified",
    state: types.has("CERTIFICATE_ISSUED") ? "done" : "todo",
    note: types.has("CERTIFICATE_RETIRED") ? "certificate used" : undefined,
  });
  const anchored = b.events.filter((e) => e.chain_status === "anchored").length;
  steps.push({
    label: "On-chain",
    state: anchored === 0 ? "todo" : anchored === b.events.length ? "done" : "warn",
    note: anchored ? `${anchored}/${b.events.length} events` : undefined,
  });

  // the first not-yet-done step after progress is the "current" one
  const firstTodo = steps.findIndex((s) => s.state === "todo");
  if (firstTodo > 0 && !steps.some((s) => s.state === "current")) steps[firstTodo].state = "current";

  if (b.status === "split" || b.status === "merged") {
    steps.push({ label: b.status === "split" ? "Split" : "Merged", state: "done", note: "see lineage below" });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Journey</h2>
      <ol className="mt-4 flex flex-wrap items-start gap-y-4">
        {steps.map((s, i) => (
          <li key={s.label} className="flex min-w-[110px] flex-1 items-start">
            <div className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <div className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : steps[i - 1].state === "todo" ? "bg-slate-200" : "bg-emerald-300"}`} />
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${DOT[s.state]}`}>
                  {ICON[s.state]}
                </span>
                <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? "bg-transparent" : s.state === "todo" ? "bg-slate-200" : "bg-emerald-300"}`} />
              </div>
              <div className={`mt-2 text-sm font-medium ${s.state === "todo" ? "text-slate-400" : "text-slate-800"}`}>{s.label}</div>
              {s.note && (
                <div className={`mt-0.5 px-1 text-xs ${s.state === "warn" ? "text-amber-700" : "text-slate-500"}`}>{s.note}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}