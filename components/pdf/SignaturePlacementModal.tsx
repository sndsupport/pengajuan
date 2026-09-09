"use client";

import { useEffect, useRef, useState } from "react";
import { renderSubmissionBaseCanvas } from "@/lib/pdf/generateSubmissionPdfClient";
import { clampSignaturePosition, SignaturePositionPx } from "@/lib/pdf/signaturePosition";
import type { SubmissionPdfData } from "@/lib/pdf/pdfTemplate";
import { computePdfPageSlices } from "@/lib/pdf/generateSubmissionPdfClient";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const DISPLAY_WIDTH_PX = 600;

export function SignaturePlacementModal({
  data,
  signatureImageUrl,
  onConfirm,
  onCancel,
}: {
  data: Omit<SubmissionPdfData, "approverSignatureUrl">;
  signatureImageUrl: string;
  onConfirm: (position: SignaturePositionPx) => Promise<void>;
  onCancel: () => void;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [position, setPosition] = useState<SignaturePositionPx | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const dragState = useRef<{ startClientX: number; startClientY: number; startPosition: SignaturePositionPx } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    renderSubmissionBaseCanvas(data)
      .then(({ canvas: baseCanvas, defaultSignaturePositionPx }) => {
        if (cancelled) return;
        setCanvas(baseCanvas);
        setImageDataUrl(baseCanvas.toDataURL("image/png"));
        setPosition(defaultSignaturePositionPx);
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : "Gagal me-render preview PDF.");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayScale = canvas ? DISPLAY_WIDTH_PX / canvas.width : 1;

  function handlePointerDown(e: React.PointerEvent) {
    if (!position) return;
    e.preventDefault();
    dragState.current = { startClientX: e.clientX, startClientY: e.clientY, startPosition: position };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragState.current || !canvas) return;
    const dxCanvasPx = (e.clientX - dragState.current.startClientX) / displayScale;
    const dyCanvasPx = (e.clientY - dragState.current.startClientY) / displayScale;
    const next = clampSignaturePosition(
      {
        ...dragState.current.startPosition,
        x: dragState.current.startPosition.x + dxCanvasPx,
        y: dragState.current.startPosition.y + dyCanvasPx,
      },
      canvas.width,
      canvas.height
    );
    setPosition(next);
  }

  function handlePointerUp() {
    dragState.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }

  async function handleConfirmClick() {
    if (!position) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      await onConfirm(position);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal menyelesaikan approve/generate PDF.");
    } finally {
      setConfirming(false);
    }
  }

  const pageBreaksPx = canvas ? computePdfPageSlices(canvas.width, canvas.height) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl">
        <h2 className="mb-3 text-base font-semibold">Posisikan Tanda Tangan</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Geser tanda tangan ke posisi yang diinginkan, atau langsung Konfirmasi untuk pakai posisi default. Garis
          putus-putus menandai batas potong halaman — hindari menaruh tanda tangan tepat di garis itu.
        </p>

        {renderError && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{renderError}</span>
          </div>
        )}

        {!renderError && !canvas && <p className="py-8 text-center text-sm text-muted-foreground">Menyiapkan preview...</p>}

        {canvas && imageDataUrl && position && (
          <div
            className="relative mx-auto select-none"
            style={{ width: DISPLAY_WIDTH_PX, height: canvas.height * displayScale }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageDataUrl} alt="Preview dokumen" className="pointer-events-none w-full" />
            {pageBreaksPx.slice(0, -1).map((slice, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t-2 border-dashed border-red-400"
                style={{ top: (slice.sourceYPx + slice.sliceHeightPx) * displayScale }}
              />
            ))}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signatureImageUrl}
              alt="Tanda tangan approver"
              onPointerDown={handlePointerDown}
              className="absolute touch-none border border-dashed border-primary bg-white/60"
              style={{
                left: position.x * displayScale,
                top: position.y * displayScale,
                width: position.width * displayScale,
                height: position.height * displayScale,
                cursor: "grab",
              }}
            />
          </div>
        )}

        {confirmError && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{confirmError}</span>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            Batal
          </Button>
          <Button type="button" onClick={handleConfirmClick} disabled={!position || confirming}>
            {confirming ? "Memproses..." : "Konfirmasi"}
          </Button>
        </div>
      </div>
    </div>
  );
}
