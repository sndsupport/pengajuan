import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { generateSubmissionPdfClient } from "./generateSubmissionPdfClient";
import type { SubmissionPdfData, SubmissionPdfItem } from "./pdfTemplate";
import type { AppUser } from "@/lib/hooks/useAuth";

const APPROVER_ROLE_VALUES = ["spv", "management"];

export type GenerateAndAttachSubmissionPdfResult = { pdfUrl: string };

export async function generateAndAttachSubmissionPdf(
  submissionId: string,
  caller: AppUser
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

  const [itemsSnap, requesterSnap] = await Promise.all([
    getDocs(collection(submissionRef, "items")),
    getDoc(doc(db, "users", submission.requesterId)),
  ]);
  const requester = requesterSnap.data();
  if (!requester) {
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

  const pdfData: SubmissionPdfData = {
    submissionNumber: submission.submissionNumber,
    type: submission.type,
    subType: submission.subType,
    branch: submission.branch,
    department: submission.department,
    position: submission.position,
    requesterName: requester.name,
    requesterSignatureUrl: submission.requesterSignatureUrl,
    approverName: submission.approverName,
    approverRole: submission.approverRole,
    approverSignatureUrl: submission.approverSignatureUrl,
    submittedAt: submission.submittedAt?.toDate() ?? new Date(),
    approvedAt: submission.approvedAt?.toDate() ?? new Date(),
    items,
  };

  const { pdfUrl } = await generateSubmissionPdfClient(pdfData);

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
  });

  try {
    await batch.commit();
  } catch (error) {
    // Someone else (the auto-trigger or a concurrent retry) may have already
    // finished this same transition while we were mid-render/upload. If so,
    // adopt their result instead of surfacing a confusing permission error —
    // the outcome the caller actually wanted (a PDF attached) already happened.
    const freshSnap = await getDoc(submissionRef);
    const fresh = freshSnap.data();
    if (fresh?.status === "siap_dikirim" && fresh.pdfUrl) {
      return { pdfUrl: fresh.pdfUrl as string };
    }
    throw error;
  }

  return { pdfUrl };
}
