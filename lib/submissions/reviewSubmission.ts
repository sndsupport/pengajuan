import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { reviewSubmissionSchema, ReviewSubmissionInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";

export type ReviewSubmissionResult = { submissionId: string; status: "disetujui" | "perlu_revisi" };

export async function reviewSubmission(rawInput: unknown, caller: AppUser): Promise<ReviewSubmissionResult> {
  const parsed = reviewSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ReviewSubmissionInput = parsed.data;

  if (!["spv", "management"].includes(caller.role)) {
    throw new Error("Anda tidak memiliki akses untuk mereview pengajuan.");
  }

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.status !== "diajukan") {
    throw new Error("Hanya pengajuan berstatus diajukan yang bisa direview.");
  }

  const batch = writeBatch(db);
  const historyRef = doc(collection(submissionRef, "statusHistory"));

  if (input.decision === "approve") {
    batch.update(submissionRef, {
      status: "disetujui",
      approverId: caller.uid,
      approverRole: caller.role,
      approverSignatureUrl: input.approverSignatureUrl,
      approverName: caller.name,
      approvedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "disetujui",
      note: null,
      actorId: caller.uid,
      actorRole: caller.role,
      timestamp: serverTimestamp(),
      submissionNumber: submission.submissionNumber,
      employeeName: submission.employeeName,
    });
  } else {
    batch.update(submissionRef, {
      status: "perlu_revisi",
      rejectionNote: input.rejectionNote,
      reviewedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "perlu_revisi",
      note: input.rejectionNote,
      actorId: caller.uid,
      actorRole: caller.role,
      timestamp: serverTimestamp(),
      submissionNumber: submission.submissionNumber,
      employeeName: submission.employeeName,
    });
  }

  await batch.commit();

  if (input.decision === "approve") {
    void generateAndAttachSubmissionPdf(input.submissionId, caller).catch((error) => {
      console.error(`reviewSubmission: PDF generation failed for submission ${input.submissionId}`, error);
    });
  }

  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
