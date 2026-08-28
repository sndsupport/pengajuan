import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { reviewSubmissionSchema, ReviewSubmissionInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type ReviewSubmissionResult = { submissionId: string; status: "disetujui" | "perlu_revisi" };

export async function reviewSubmission(rawInput: unknown, caller: AppUser): Promise<ReviewSubmissionResult> {
  const parsed = reviewSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ReviewSubmissionInput = parsed.data;

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
      approvedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "disetujui",
      note: null,
      actorId: caller.uid,
      actorRole: caller.role,
      timestamp: serverTimestamp(),
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
    });
  }

  await batch.commit();
  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
