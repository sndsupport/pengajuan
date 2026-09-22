import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildPersonaliaPdfHtml, PersonaliaPdfData } from "./pdfTemplate";
import { computePdfPageSlices } from "./generateSubmissionPdfClient";
// Relative import (not "@/lib/drive-upload"): avoids pulling in a path-alias
// resolution plugin for Vitest just for this one import.
import { uploadToDriveClient, resolveDriveImageAsDataUrl } from "../drive-upload";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RENDER_WIDTH_PX = 794; // ~210mm at 96dpi, so the captured canvas maps cleanly onto an A4-width page

function waitForImagesToLoad(doc: Document): Promise<void> {
  const images = Array.from(doc.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve, reject) => {
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

export type GeneratePersonaliaSubmissionPdfResult = { pdfUrl: string };

// Both approvers' signatures are already known once dual approval completes -- unlike
// the operational flow (lib/pdf/generateSubmissionPdfClient.ts), there's no variable-
// height items table shifting the signature block around, so this renders straight to
// a final PDF in one pass instead of a base-canvas + interactive-placement + composite
// pipeline.
export async function generatePersonaliaSubmissionPdf(
  data: PersonaliaPdfData
): Promise<GeneratePersonaliaSubmissionPdfResult> {
  const [spvSignatureUrl, managerSignatureUrl] = await Promise.all([
    resolveDriveImageAsDataUrl(data.spvSignatureUrl),
    resolveDriveImageAsDataUrl(data.managerSignatureUrl),
  ]);

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

  let canvas: HTMLCanvasElement;
  try {
    iframeDoc.open();
    iframeDoc.write(buildPersonaliaPdfHtml({ ...data, spvSignatureUrl, managerSignatureUrl }));
    iframeDoc.close();

    await iframeDoc.fonts.ready;
    await waitForImagesToLoad(iframeDoc);
    iframe.style.height = `${iframeDoc.body.scrollHeight}px`;

    canvas = await html2canvas(iframeDoc.body, { useCORS: true, scale: 2, backgroundColor: "#ffffff" });
  } finally {
    document.body.removeChild(iframe);
  }

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const slices = computePdfPageSlices(canvas.width, canvas.height, A4_WIDTH_MM, A4_HEIGHT_MM);

  slices.forEach((slice, index) => {
    if (index > 0) {
      pdf.addPage();
    }
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = slice.sliceHeightPx;
    const sliceCtx = sliceCanvas.getContext("2d")!;
    sliceCtx.drawImage(
      canvas,
      0,
      slice.sourceYPx,
      canvas.width,
      slice.sliceHeightPx,
      0,
      0,
      canvas.width,
      slice.sliceHeightPx
    );
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
}
