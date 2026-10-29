import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QrCode({ url, size = 140 }: { url: string; size?: number }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    QRCode.toDataURL(url, { width: size, margin: 1 }).then(setSrc).catch(() => setSrc(""));
  }, [url, size]);

  return (
    <div className="inline-flex flex-col items-center gap-1">
      {src
        ? <img src={src} width={size} height={size} alt={`QR code for ${url}`} className="rounded border border-slate-200" />
        : <div style={{ width: size, height: size }} className="rounded bg-slate-100" />}
      <a href={url} target="_blank" rel="noreferrer"
        className="max-w-[200px] truncate text-xs text-blue-700 hover:underline">
        {url.replace(/^https?:\/\//, "")}
      </a>
    </div>
  );
}