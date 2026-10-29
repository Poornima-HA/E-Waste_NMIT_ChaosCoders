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