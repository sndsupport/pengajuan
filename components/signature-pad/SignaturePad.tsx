"use client";

import { useEffect, useRef } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const pad = new SignaturePadLib(canvasRef.current, { backgroundColor: "rgb(255,255,255)" });
    pad.addEventListener("endStroke", () => {
      onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"));
    });
    padRef.current = pad;
    return () => pad.off();
  }, []);

  function handleClear() {
    padRef.current?.clear();
    onChangeRef.current(null);
  }

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} width={400} height={160} className="rounded border bg-white" />
      <Button type="button" variant="outline" size="sm" onClick={handleClear}>
        Hapus Tanda Tangan
      </Button>
    </div>
  );
}
