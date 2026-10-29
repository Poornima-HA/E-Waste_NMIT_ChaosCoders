// ---------- HTTP helper ----------
// ---------- acting participant (demo identity switcher) ----------
export const ACTOR_KEY = "ewl-actor";

export function currentActor(): string | null {
  try {
    return localStorage.getItem(ACTOR_KEY);
  } catch {
    return null;
  }
}

export function setActor(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTOR_KEY, id);
    else localStorage.removeItem(ACTOR_KEY);
  } catch {
    /* storage unavailable: ignore */
  }
  window.location.reload();
}

// ---------- HTTP helper ----------
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const actor = currentActor();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { "X-Actor": actor } : {}),
      ...(init?.headers ?? {}),
    },
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
// ---------- F4: recovery + audit ----------
export type MaterialOut = {
  id: number; material: string; mass_kg: number; allocated_kg: number; available_kg: number;
};
export type ProcRun = {
  id: string; batch_id: string; facility_id: string;
  input_kg: number; recovered_kg: number; residual_kg: number; loss_kg: number;
  wip_change_kg: number; variance_kg: number; variance_pct: number; yield_pct: number;
  balance_status: "pass" | "warning" | "critical"; evidence_hash: string;
  operator: string; created_at: string;
  thresholds: { pass_pct: number; critical_pct: number; note: string };
  outputs: MaterialOut[];
};
export type ClaimAttemptT = {
  id: number; claim_id: string; run_id: string; material: string; mass_kg: number;
  claimant: string; decision: "accepted" | "rejected"; rule: string | null;
  reason: string; created_at: string;
};
export type ClaimsList = {
  accepted: { claim_id: string; output_id: number; claimant: string; mass_kg: number;
    evidence_hash: string; created_at: string }[];
  attempts: ClaimAttemptT[];
};
export type GateResult = {
  decision: "accepted"; claim_id: string;
  checks: { check: string; pass: boolean; detail?: string }[];
};

// ---------- inventory reconciliation ----------
export type InvFinding = { rule: string; severity: string; message: string };
export type InvRow = {
  facility_id: string; material: string;
  system_kg: number; disputed_kg: number; claimed_kg: number;
  physical_kg: number | null; difference_kg: number | null; difference_pct: number | null;
  status: "reconciled" | "warning" | "critical" | "not_counted";
  findings: InvFinding[];
  last_count: { counted_by: string; method: string; counted_at: string; evidence_hash: string } | null;
};
export type Reconciliation = {
  tolerance: { pass_pct: number; critical_pct: number; note: string };
  rows: InvRow[];
};

// ---------- costs ----------
export type CostSummary = {
  batch_id: string; total_inr: number;
  by_category_inr: Record<"transport" | "processing" | "disposal" | "handling", number>;
  collected_kg: number; recovered_kg: number;
  cost_per_kg_collected_inr: number | null; cost_per_kg_recovered_inr: number | null;
  records: { id: number; category: string; amount_inr: number; reference: string;
    recorded_by: string; created_at: string }[];
};

// ---------- lineage ----------
export type LineageNode = {
  id: string; category: string; status: string; custodian: string; source: string; mass_kg: number;
};
export type LineageEdge = {
  parent_id: string; child_id: string; mass_kg: number; relation: "split" | "merge";
};
export type Lineage = {
  root: string; available_kg: number | null; nodes: LineageNode[]; edges: LineageEdge[];
};

// ---------- governance + metrics ----------
export type Resolution = {
  id: number; alert_id: number; from: string; to: string; reviewer: string; note: string; at: string;
};
export type Metrics = {
  operations: { batches: number; original_batches: number; collected_kg: number;
    processed_input_kg: number; recovered_kg: number; avg_yield_pct: number | null };
  custody: { transfers: number; received: number; disputed: number;
    missing_handovers: number; total_receipt_gap_kg: number };
  mass_balance: { runs: number; pass: number; warning: number; critical: number; unexplained_kg: number };
  claims: { accepted: number; accepted_kg: number; blocked: number; blocked_kg: number;
    blocked_by_rule: Record<string, number> };
  inventory: Record<string, number>;
  alerts: { total: number; open: number; investigating: number; resolved: number;
    false_positive: number; critical_open: number };
  blockchain: { events: number; anchored_events: number; confirmed_receipts: number; failed_receipts: number };
  optimization: null | {
    run_id: string; status: string; guarantee: string;
    optimized_assigned: string; baseline_assigned: string;
    optimized_feasible: boolean; baseline_feasible: boolean;
    optimized_inr_per_kg: number | null; baseline_inr_per_kg: number | null;
    per_kg_saving_pct?: number;
  };
  quantum: { benchmarks: number; matches_optimum: number; cloud_jobs: number };
  tests: null | { tests: number; passed: number; failures: number; errors: number;
    skipped: number; report: string; generated: string | null };
};

// ---------- certificates + public verification ----------
export type CertSummary = {
  id: string; claim_id: string; batch_id: string; material: string; mass_kg: number;
  status: "issued" | "retired"; chain_status: string; cert_hash: string;
  issue_tx: string | null; retire_tx: string | null; retired_by: string | null;
  retire_purpose: string | null; retired_at: string | null; issued_at: string;
};
export type EligibleClaim = {
  claim_id: string; run_id: string; batch_id: string; material: string; mass_kg: number; claimant: string;
};
export type CertPayload = {
  certificate_id: string; standard: string;
  claim: { claim_id: string; material: string; mass_kg: number; claimant: string;
    evidence_sha256: string; accepted_at: string };
  processing: { run_id: string; facility: string; input_kg: number; recovered_kg: number;
    variance_pct: number; yield_pct: number; balance_status: string; evidence_sha256: string };
  batch: { batch_id: string; category: string; source: string;
    origins: { id: string; source: string }[]; audit_chain_head: string | null; events: number };
  integrity_checks: string[];
  documents: { name: string; sha256: string; bytes: number }[];
  issued_by: string; issued_at: string;
};
export type CertVerify = {
  certificate_id: string; verdict: "valid" | "retired" | "tampered" | "unverified"; status: string;
  payload: CertPayload; cert_hash: string; recomputed_hash: string; db_integrity: boolean;
  onchain: null | { cert_hash: string; issued_at: number; retired_at: number; network: string;
    contract: string; public: boolean };
  chain_error: string | null; retired_by: string | null; retire_purpose: string | null;
  retired_at: string | null; issue_tx: string | null; retire_tx: string | null;
};
export type PublicBatch = {
  id: string; category: string; status: string; source: string; custodian: string; mass_kg: number;
  original_reading: string; weighed_at: string; origins: { id: string; source: string }[];
  transfers: { id: string; from: string; to: string; dispatch_kg: number; receipt_kg: number | null; status: string }[];
  processing: { run_id: string; facility: string; input_kg: number; recovered_kg: number;
    yield_pct: number; balance_status: string }[];
  certificates: { id: string; status: string; material: string; mass_kg: number }[];
  verification: { status: string; network?: string; onchain_event_count?: number;
    db_event_count?: number; unanchored_events?: number; detail?: string };
};

// ---------- roles + workspace ----------
export type Role = "generator" | "collector" | "transporter" | "recycler" | "auditor" | "buyer";
export type Actor = {
  id: string; name: string; role: Role; role_label: string; step: number; does: string;
  facility_id: string | null;
};
export type Workspace = {
  actor: Actor;
  incoming: { transfer_id: string; batch_id: string; from: string; dispatch_kg: number; dispatched_at: string }[];
  holding: { batch_id: string; category: string; mass_kg: number; disputed: boolean; status: string }[];
  sent: { transfer_id: string; batch_id: string; to: string; dispatch_kg: number; receipt_kg: number | null; status: string }[];
  next_parties: { id: string; name: string; eligible: boolean; note: string | null }[];
  my_batches: { batch_id: string; category: string; mass_kg: number; status: string; custodian: string }[];
  to_certify: { claim_id: string; material: string; mass_kg: number }[];
  certificates: { id: string; material: string; mass_kg: number; status: string; retired_by: string | null }[];
  audit: null | { open_alerts: number; critical_open: number };
};