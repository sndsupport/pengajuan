"use client";

import { useEffect, useRef } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

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
      <div className="w-fit rounded-xl border-2 border-dashed bg-white p-1.5 shadow-sm">
        <canvas ref={canvasRef} width={400} height={160} className="rounded-lg" />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={handleClear}>
        <Eraser className="h-4 w-4" />
        Hapus Tanda Tangan
      </Button>
    </div>
  );
}
