import { FieldValue } from "firebase-admin/firestore";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { db } from "./admin";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";
import { uploadToDrive } from "./googleDrive";

const APPROVER_ROLE_VALUES = ["spv", "management"];

export function shouldGeneratePdf(
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): boolean {
  return before.status !== "disetujui" && after.status === "disetujui";
}

export async function generateSubmissionPdfHandler(
  submissionId: string,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const submissionRef = db.collection("submissions").doc(submissionId);

  const [itemsSnap, requesterSnap, approverSnap] = await Promise.all([
    submissionRef.collection("items").get(),
    db.collection("users").doc(after.requesterId).get(),
    db.collection("users").doc(after.approverId).get(),
  ]);

  const requester = requesterSnap.data();
  const approver = approverSnap.data();
  if (!requester || !approver) {
    console.error(`generateSubmissionPdfHandler: missing requester or approver user doc for submission ${submissionId}`);
    return;
  }
  if (!APPROVER_ROLE_VALUES.includes(after.approverRole)) {
    console.error(`generateSubmissionPdfHandler: unexpected approverRole "${after.approverRole}" for submission ${submissionId}`);
    return;
  }

  const pdfData: SubmissionPdfData = {
    submissionNumber: after.submissionNumber,
    type: after.type,
    subType: after.subType,
    branch: after.branch,
    department: after.department,
    position: after.position,
    requesterName: requester.name,
    requesterSignatureUrl: after.requesterSignatureUrl,
    approverName: approver.name,
    approverRole: after.approverRole,
    approverSignatureUrl: after.approverSignatureUrl,
    submittedAt: after.submittedAt?.toDate() ?? new Date(),
    approvedAt: after.approvedAt?.toDate() ?? new Date(),
    items: itemsSnap.docs.map((doc) => {
      const item = doc.data();
      return {
        itemName: item.itemName as string,
        brandType: item.brandType as string,
        km: (item.km as number | null) ?? null,
        quantity: item.quantity as number,
        unit: item.unit as string,
        description: item.description as string,
      };
    }),
  };

  const html = buildSubmissionPdfHtml(pdfData);

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: null,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    pdfBuffer = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
  } finally {
    await browser.close();
  }

  const { webViewLink } = await uploadToDrive({
    fileName: `${pdfData.submissionNumber.replace(/\//g, "-")}.pdf`,
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const batch = db.batch();
  batch.update(submissionRef, {
    pdfUrl: webViewLink,
    status: "siap_dikirim",
  });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: null,
    actorId: "system",
    actorRole: "system",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
