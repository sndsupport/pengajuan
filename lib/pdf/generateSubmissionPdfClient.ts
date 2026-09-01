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

export type GenerateSubmissionPdfResult = { pdfUrl: string };

export async function generateSubmissionPdfClient(data: SubmissionPdfData): Promise<GenerateSubmissionPdfResult> {
  // Rendered inside an isolated iframe document rather than a div appended
  // to the page: html2canvas clones the whole document to preserve stacking
  // context, which means it also has to read computed styles for every
  // element already on the page — including the app's own sidebar/cards/etc,
  // all styled through this app's Tailwind tokens, which are oklch() colors
  // (CSS Color 4) that html2canvas's parser can't read at all. That crashed
  // PDF generation unconditionally (auto on approve, and the manual "Coba
  // Generate PDF" retry), regardless of anything set on a div living inside
  // that same document. An iframe gets its own document with no connection
  // to the parent page's stylesheets, so html2canvas only ever sees the
  // template's own hex-based <style> block.
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
  iframeDoc.write(buildSubmissionPdfHtml(data));
  iframeDoc.close();

  try {
    await iframeDoc.fonts.ready;
    await waitForImagesToLoad(iframeDoc);
    // The template's own body height is auto (grows with content); give the
    // iframe's viewport the same height so html2canvas doesn't clip it.
    iframe.style.height = `${iframeDoc.body.scrollHeight}px`;

    const canvas = await html2canvas(iframeDoc.body, { useCORS: true, scale: 2, backgroundColor: "#ffffff" });

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const slices = computePdfPageSlices(canvas.width, canvas.height, A4_WIDTH_MM, A4_HEIGHT_MM);

    slices.forEach((slice, index) => {
      if (index > 0) {
        pdf.addPage();
      }
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = slice.sliceHeightPx;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, slice.sourceYPx, canvas.width, slice.sliceHeightPx, 0, 0, canvas.width, slice.sliceHeightPx);
      const sliceImageData = sliceCanvas.toDataURL("image/png");
      const sliceHeightMm = (slice.sliceHeightPx / canvas.width) * A4_WIDTH_MM;
      pdf.addImage(sliceImageData, "PNG", 0, 0, A4_WIDTH_MM, sliceHeightMm);
    });

    const pdfBlob = pdf.output("blob");
    const pdfFile = new File([pdfBlob], `${data.submissionNumber.replace(/\//g, "-")}.pdf`, {
      type: "application/pdf",
    });
    const { fileUrl } = await uploadToDriveClient(pdfFile, "attachment");
    return { pdfUrl: fileUrl };
  } finally {
    document.body.removeChild(iframe);
  }
}
