"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export function ShareQr({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return; // "" before the URL resolves → skip.
    void QRCode.toCanvas(ref.current, value, {
      width: 168,
      margin: 1,
      color: { dark: "#08151b", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).catch(() => {
      // Non-fatal: the copy-link button remains the primary action.
    });
  }, [value]);
  return <canvas ref={ref} width={168} height={168} className="rounded-xl bg-white p-2" aria-label="QR code for public project link" />;
}
