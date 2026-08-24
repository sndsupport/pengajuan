import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdf/buildSubmissionPdfHtml";
import { renderPdfBuffer } from "./pdf/renderPdfBuffer";
import { uploadToDrive } from "./googleDrive";

export async function generateSubmissionPdfHandler(
  submissionId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  if (before.status === "disetujui" || after.status !== "disetujui") {
    return;
  }

  const submissionRef = db.collection("submissions").doc(submissionId);
  const [itemsSnap, requesterSnap, approverSnap] = await Promise.all([
    submissionRef.collection("items").get(),
    db.collection("users").doc(after.requesterId).get(),
    db.collection("users").doc(after.approverId).get(),
  ]);

  const requester = requesterSnap.data();
  const approver = approverSnap.data();
  const submittedAt: Date =
    after.submittedAt && typeof after.submittedAt.toDate === "function" ? after.submittedAt.toDate() : new Date();

  const pdfData: SubmissionPdfData = {
    submissionNumber: after.submissionNumber,
    submittedAt,
    type: after.type,
    branch: after.branch,
    department: after.department,
    position: after.position,
    requesterName: requester?.name ?? "-",
    requesterSignatureUrl: after.requesterSignatureUrl,
    approverName: approver?.name ?? "-",
    approverPosition: approver?.position ?? "-",
    approverSignatureUrl: after.approverSignatureUrl,
    items: itemsSnap.docs.map((docSnap) => {
      const item = docSnap.data();
      return {
        itemName: item.itemName,
        brandType: item.brandType,
        km: item.km ?? null,
        quantity: item.quantity,
        unit: item.unit,
        description: item.description,
      };
    }),
  };

  const html = buildSubmissionPdfHtml(pdfData);
  const pdfBuffer = await renderPdfBuffer(html);
  const { webViewLink } = await uploadToDrive({
    fileName: `Formulir - ${after.submissionNumber}.pdf`,
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const batch = db.batch();
  batch.update(submissionRef, { pdfUrl: webViewLink, status: "siap_dikirim" });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: "PDF digenerate otomatis",
    actorId: "system",
    actorRole: "system",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
