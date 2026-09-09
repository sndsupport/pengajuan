import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";
// Relative import (not "@/lib/drive-upload"): avoids pulling in a path-alias
// resolution plugin for Vitest just for this one import.
import { uploadToDriveClient } from "../drive-upload";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RENDER_WIDTH_PX = 794; // ~210mm at 96dpi, so the captured canvas maps cleanly onto an A4-width page

function waitForImagesToLoad(doc: Document): Promise<void> {
  const images = Array.from(doc.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve, reject) => {
          // naturalWidth > 0 is the reliable signal a load actually succeeded —
          // img.complete alone becomes true even for a broken/CORS-blocked image
          // once the browser is done attempting it, success or not. Rejecting
          // here (rather than silently resolving on error, as before) turns a
          // blank/missing signature in the generated PDF into a visible,
          // catchable error instead of a silently-produced defective document.
          function settle() {
            if (img.naturalWidth > 0) {
              resolve();
            } else {
              reject(new Error(`Gagal memuat gambar tanda tangan: ${img.src}`));
            }
          }
          if (img.complete) {
            settle();
            return;
          }
          img.addEventListener("load", settle, { once: true });
          img.addEventListener("error", () => reject(new Error(`Gagal memuat gambar tanda tangan: ${img.src}`)), {
            once: true,
          });
        })
    )
  ).then(() => undefined);
}

export function computePdfPageSlices(
  canvasWidthPx: number,
  canvasHeightPx: number,
  pageWidthMm: number = A4_WIDTH_MM,
  pageHeightMm: number = A4_HEIGHT_MM
): Array<{ sourceYPx: number; sliceHeightPx: number }> {
  const pxPerMm = canvasWidthPx / pageWidthMm;
  const pageHeightPx = pageHeightMm * pxPerMm;

  const slices: Array<{ sourceYPx: number; sliceHeightPx: number }> = [];
  let remainingHeightPx = canvasHeightPx;
  let sourceYPx = 0;
  while (remainingHeightPx > 0) {
    const sliceHeightPx = Math.min(pageHeightPx, remainingHeightPx);
    slices.push({ sourceYPx, sliceHeightPx });
    sourceYPx += sliceHeightPx;
    remainingHeightPx -= sliceHeightPx;
  }
  return slices;
}

import type { SignaturePositionPx } from "./signaturePosition";

export type GenerateSubmissionPdfResult = { pdfUrl: string };

export type BaseCanvasResult = {
  canvas: HTMLCanvasElement;
  defaultSignaturePositionPx: SignaturePositionPx;
};

// Renders the template WITHOUT the approver signature into one tall canvas,
// and reports where the (now-empty) approver signature box landed on that
// canvas — this becomes the default drag position in SignaturePlacementModal,
// so an approver who doesn't care can just confirm without dragging anything.
export async function renderSubmissionBaseCanvas(
  data: Omit<SubmissionPdfData, "approverSignatureUrl">
): Promise<BaseCanvasResult> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${RENDER_WIDTH_PX}px`;
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    throw new Error("Gagal menyiapkan dokumen render PDF.");
  }
  iframeDoc.open();
  iframeDoc.write(buildSubmissionPdfHtml({ ...data, approverSignatureUrl: null }));
  iframeDoc.close();

  try {
    await iframeDoc.fonts.ready;
    await waitForImagesToLoad(iframeDoc);
    iframe.style.height = `${iframeDoc.body.scrollHeight}px`;

    const box = iframeDoc.querySelector("[data-approver-signature-box]") as HTMLElement | null;
    if (!box) {
      throw new Error("Template tidak punya blok tanda tangan approver.");
    }
    const rect = box.getBoundingClientRect();
    // scale:2 below means the rendered canvas is exactly 2x RENDER_WIDTH_PX —
    // computed from the same constant html2canvas is told to scale from,
    // rather than re-derived from layout, so it can't drift from reality.
    const scale = 2;

    const canvas = await html2canvas(iframeDoc.body, { useCORS: true, scale, backgroundColor: "#ffffff" });

    return {
      canvas,
      defaultSignaturePositionPx: {
        x: rect.left * scale,
        y: rect.top * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      },
    };
  } finally {
    document.body.removeChild(iframe);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat gambar tanda tangan: ${src}`));
    img.src = src;
  });
}

// Draws the approver signature onto a COPY of the base canvas (the original
// is left untouched so a modal preview can composite a signature multiple
// times as the approver drags it around), then runs the same page-slicing +
// jsPDF assembly the old single-shot generateSubmissionPdfClient used to do.
export async function compositeSignatureAndBuildPdf(
  baseCanvas: HTMLCanvasElement,
  signatureImageUrl: string,
  positionPx: SignaturePositionPx,
  submissionNumber: string
): Promise<GenerateSubmissionPdfResult> {
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = baseCanvas.width;
  compositeCanvas.height = baseCanvas.height;
  const ctx = compositeCanvas.getContext("2d")!;
  ctx.drawImage(baseCanvas, 0, 0);

  const signatureImage = await loadImage(signatureImageUrl);
  ctx.drawImage(signatureImage, positionPx.x, positionPx.y, positionPx.width, positionPx.height);

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const slices = computePdfPageSlices(compositeCanvas.width, compositeCanvas.height, A4_WIDTH_MM, A4_HEIGHT_MM);

  slices.forEach((slice, index) => {
    if (index > 0) {
      pdf.addPage();
    }
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = compositeCanvas.width;
    sliceCanvas.height = slice.sliceHeightPx;
    const sliceCtx = sliceCanvas.getContext("2d")!;
    sliceCtx.drawImage(
      compositeCanvas,
      0,
      slice.sourceYPx,
      compositeCanvas.width,
      slice.sliceHeightPx,
      0,
      0,
      compositeCanvas.width,
      slice.sliceHeightPx
    );
    const sliceImageData = sliceCanvas.toDataURL("image/png");
    const sliceHeightMm = (slice.sliceHeightPx / compositeCanvas.width) * A4_WIDTH_MM;
    pdf.addImage(sliceImageData, "PNG", 0, 0, A4_WIDTH_MM, sliceHeightMm);
  });

  const pdfBlob = pdf.output("blob");
  const pdfFile = new File([pdfBlob], `${submissionNumber.replace(/\//g, "-")}.pdf`, {
    type: "application/pdf",
  });
  const { fileUrl } = await uploadToDriveClient(pdfFile, "attachment");
  return { pdfUrl: fileUrl };
}
