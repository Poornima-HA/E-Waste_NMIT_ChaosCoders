import QrCode from "./QrCode";

export default function PassportQrPanel({ batchId }: { batchId: string }) {
  const url = `${window.location.origin}/verify/batch/${batchId}`;
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-lg border border-slate-200 bg-white p-4">
      <QrCode url={url} size={120} />
      <div className="min-w-[240px] flex-1">
        <h2 className="font-medium">Scan-to-verify passport</h2>
        <p className="mt-1 text-sm text-slate-600">
          Anyone with this QR (a buyer, regulator or auditor) can view this batch's public journey
          and its live on-chain verification. Read-only, no login.
        </p>
        {local && (
          <p className="mt-2 text-xs text-amber-700">
            You opened the app via localhost, so a phone can't reach this link. Start the frontend with{" "}
            <code className="rounded bg-amber-50 px-1">npm run dev -- --host</code> and open the Network URL instead.
          </p>
        )}
      </div>
    </div>
  );
}