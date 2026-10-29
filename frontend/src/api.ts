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