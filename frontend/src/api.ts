// ---------- HTTP helper ----------
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (body as { detail?: unknown }).detail;
    throw new Error(d ? (typeof d === "string" ? d : JSON.stringify(d)) : `HTTP ${res.status}`);
  }
  return body as T;
}

// ---------- F1: dashboard ----------
export type BatchSummary = {
  id: string; category: string; status: string; custodian: string; net_mass_kg: number;
};
export type Alert = {
  id: number; batch_id: string; rule: string; severity: string; message: string; status: string;
};
export type Audits = {
  alerts: Alert[];
  missing_handovers: { transfer_id: string; batch_id: string; to: string; dispatched_at: string }[];
};
export type Facility = {
  id: string; name: string; kind: string; licence_no: string | null;
  licence_valid_until: string | null; accepted_categories: string;
  capacity_g: number; verification: string; licence_valid: boolean | null;
};
export type OptRun = {
  id: string; mode: string; status: string; plan_hash: string; created_at: string;
};
export type ChainStatus = {
  connected: boolean; network: string; chain_id: number; contract: string;
  deploy_tx: string; latest_block: number; public: boolean;
};

// ---------- F2: batch passport ----------
export type Transfer = {
  id: string; from: string; to: string; status: string;
  dispatch_kg: number; receipt_kg: number | null;
  dispatched_at: string; received_at: string | null;
};
export type ChainEvent = {
  id: number; type: string; actor: string; hash: string;
  prev_hash: string; chain_status: string; at: string;
};
export type BatchDetail = BatchSummary & {
  source: string; original_reading: string; operator: string; weighed_at: string;
  transfers: Transfer[]; events: ChainEvent[];
  alerts: { id: number; rule: string; severity: string; message: string; status: string }[];
};
export type Receipt = {
  subject: string; status: string; anchored_hash: string; event_count: number | null;
  network: string; contract: string; tx_hash: string | null; block: number | null;
  note: string | null; explorer: string | null;
};
export type VerifyResult = {
  batch_id: string; status: "verified" | "mismatch" | "not_anchored"; network: string;
  onchain_head: string | null; onchain_event_count: number; db_event_count: number;
  unanchored_events: number; db_chain_broken_at_event: number | null;
  last_receipt: Receipt | null; tx_receipt_verified: boolean | null;
};

// ---------- F3: dispatch optimizer ----------
export type PlanCheck = {
  plan: Record<string, string[]>; feasible: boolean; violations: string[];
  assigned: number; total_batches: number; total_cost_inr: number;
  load_kg: Record<string, number>;
};
export type OptResult = {
  run_id?: string; id?: string; status?: string;
  scenario_name: string; scenario_hash: string; plan_hash: string; as_of: string;
  excluded_pairs: { batch: string; facility: string; reasons: string[] }[];
  cost_matrix_inr: { batch: string; facility: string; cost: number }[];
  solver: {
    product: string; execution_mode: string; problem_class: string;
    objective: number | null; method: string | null; termination: string | null;
    guarantee: string | null; job_id: string | null;
    solver_time_s: number | null; wall_time_s: number;
  };
  optimized: PlanCheck; baseline_nearest: PlanCheck;
  objective_matches_independent_cost: boolean; cost_improvement_pct: number | null;
};
export type Scenario = {
  name: string; transport_rate_inr_per_kg_km: number;
  facilities: { id: string; name: string; capacity_kg: number; licence_valid_until: string;
    processing_inr_per_kg: Record<string, number> }[];
  batches: { id: string; source: string; category: string; mass_kg: number }[];
};
export type QBench = {
  file: string; mode: string; device: string; backend: string | null; job_ids: string[];
  qubits: number; depth: number; reps: number; shots: number;
  plan: Record<string, string[]>; feasible: boolean; cost_inr: number; guarantee: string;
  matches_optimum: boolean; brute_force_cost_inr: number; milp_cost_inr: number;
  milp_guarantee: string; wall_time_s: number; sub_instance: string[];
};