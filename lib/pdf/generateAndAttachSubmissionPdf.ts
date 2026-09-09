import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { renderSubmissionBaseCanvas, compositeSignatureAndBuildPdf } from "./generateSubmissionPdfClient";
import type { SignaturePositionPx } from "./signaturePosition";
import type { SubmissionPdfData, SubmissionPdfItem } from "./pdfTemplate";
import type { AppUser } from "@/lib/hooks/useAuth";

const APPROVER_ROLE_VALUES = ["spv", "management"];

export type GenerateAndAttachSubmissionPdfResult = { pdfUrl: string };

export async function generateAndAttachSubmissionPdf(
  submissionId: string,
  caller: AppUser,
  signaturePositionPx: SignaturePositionPx
): Promise<GenerateAndAttachSubmissionPdfResult> {
  const submissionRef = doc(db, "submissions", submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.approverId !== caller.uid && submission.requesterId !== caller.uid) {
    throw new Error("Anda tidak memiliki akses untuk membuat PDF pengajuan ini.");
  }
  if (submission.status !== "disetujui") {
    throw new Error("Hanya pengajuan berstatus disetujui yang bisa dibuatkan PDF.");
  }
  if (!APPROVER_ROLE_VALUES.includes(submission.approverRole)) {
    throw new Error("Role approver pada pengajuan ini tidak valid.");
  }

  const itemsSnap = await getDocs(collection(submissionRef, "items"));
  if (!submission.employeeName) {
    throw new Error("Data pengaju tidak ditemukan.");
  }

  const items: SubmissionPdfItem[] = itemsSnap.docs.map((d) => {
    const item = d.data();
    return {
      itemName: item.itemName as string,
      brandType: item.brandType as string,
      km: (item.km as number | null) ?? null,
      quantity: item.quantity as number,
      unit: item.unit as string,
      description: item.description as string,
    };
  });

  const pdfData: Omit<SubmissionPdfData, "approverSignatureUrl"> = {
    submissionNumber: submission.submissionNumber,
    type: submission.type,
    subType: submission.subType,
    branch: submission.branch,
    department: submission.department,
    position: submission.position,
    requesterName: submission.employeeName,
    requesterSignatureUrl: submission.requesterSignatureUrl,
    approverName: submission.approverName,
    approverRole: submission.approverRole,
    submittedAt: submission.submittedAt?.toDate() ?? new Date(),
    approvedAt: submission.approvedAt?.toDate() ?? new Date(),
    items,
  };

  const { canvas } = await renderSubmissionBaseCanvas(pdfData);
  const { pdfUrl } = await compositeSignatureAndBuildPdf(
    canvas,
    submission.approverSignatureUrl,
    signaturePositionPx,
    submission.submissionNumber
  );

  const batch = writeBatch(db);
  batch.update(submissionRef, {
    status: "siap_dikirim",
    pdfUrl,
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
    submissionNumber: submission.submissionNumber,
    employeeName: submission.employeeName,
  });

  try {
    await batch.commit();
  } catch (error) {
    const freshSnap = await getDoc(submissionRef);
    const fresh = freshSnap.data();
    if (fresh?.status === "siap_dikirim" && fresh.pdfUrl) {
      return { pdfUrl: fresh.pdfUrl as string };
    }
    throw error;
  }

  return { pdfUrl };
}
