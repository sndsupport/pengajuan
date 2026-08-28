import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";
// Relative import (not "@/lib/drive-upload"): avoids pulling in a path-alias
// resolution plugin for Vitest just for this one import.
import { uploadToDriveClient } from "../drive-upload";

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap";
const GOOGLE_FONTS_LINK_ID = "pdf-google-fonts-link";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RENDER_WIDTH_PX = 794; // ~210mm at 96dpi, so the captured canvas maps cleanly onto an A4-width page

function ensureGoogleFontsLinkInjected(): void {
  if (!document.getElementById(GOOGLE_FONTS_LINK_ID)) {
    const link = document.createElement("link");
    link.id = GOOGLE_FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
  }
}

function waitForImagesToLoad(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
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
  ensureGoogleFontsLinkInjected();

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${RENDER_WIDTH_PX}px`;
  container.innerHTML = buildSubmissionPdfHtml(data);
  document.body.appendChild(container);

  try {
    await document.fonts.ready;
    await waitForImagesToLoad(container);

    const canvas = await html2canvas(container, { useCORS: true, scale: 2 });

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
    document.body.removeChild(container);
  }
}
