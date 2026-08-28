import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";
import { uploadToDriveClient } from "@/lib/drive-upload";

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap";
const GOOGLE_FONTS_LINK_ID = "pdf-google-fonts-link";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RENDER_WIDTH_PX = 794; // ~210mm at 96dpi, so the captured canvas maps cleanly onto an A4-width page

async function ensureGoogleFontsLoaded(): Promise<void> {
  if (!document.getElementById(GOOGLE_FONTS_LINK_ID)) {
    const link = document.createElement("link");
    link.id = GOOGLE_FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
  }
  await document.fonts.ready;
}

function waitForImagesToLoad(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
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
  await ensureGoogleFontsLoaded();

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${RENDER_WIDTH_PX}px`;
  container.innerHTML = buildSubmissionPdfHtml(data);
  document.body.appendChild(container);

  try {
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
