import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { generatePersonaliaSubmissionPdf } from "./generatePersonaliaSubmissionPdf";
import type { AppUser } from "@/lib/hooks/useAuth";

export type GenerateAndAttachPersonaliaPdfResult = { pdfUrl: string };

export async function generateAndAttachPersonaliaPdf(
  submissionId: string,
  caller: AppUser
): Promise<GenerateAndAttachPersonaliaPdfResult> {
  const submissionRef = doc(db, "submissions", submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.type !== "personalia") {
    throw new Error("Pengajuan ini bukan kategori personalia.");
  }
  if (submission.status !== "selesai") {
    throw new Error("Hanya pengajuan personalia berstatus selesai yang bisa dibuatkan PDF.");
  }
  if (submission.spvApproval?.approverId !== caller.uid && submission.managerApproval?.approverId !== caller.uid) {
    throw new Error("Anda tidak memiliki akses untuk membuat PDF pengajuan ini.");
  }
  if (!submission.spvApproval?.signatureUrl || !submission.managerApproval?.signatureUrl) {
    throw new Error("Data tanda tangan approval belum lengkap.");
  }

  const { pdfUrl } = await generatePersonaliaSubmissionPdf({
    submissionNumber: submission.submissionNumber,
    subType: submission.subType,
    employeeName: submission.employeeName,
    branch: submission.branch,
    department: submission.department,
    position: submission.position,
    periodStart: submission.periodStart,
    periodEnd: submission.periodEnd,
    submittedAt: submission.submittedAt?.toDate() ?? new Date(),
    completedAt: submission.completedAt?.toDate() ?? new Date(),
    spvApproverName: submission.spvApproval.approverName,
    spvSignatureUrl: submission.spvApproval.signatureUrl,
    managerApproverName: submission.managerApproval.approverName,
    managerSignatureUrl: submission.managerApproval.signatureUrl,
  });

  await updateDoc(submissionRef, { pdfUrl });
  return { pdfUrl };
}
