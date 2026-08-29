import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { reviewPersonaliaSubmissionSchema, ReviewPersonaliaSubmissionInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type ReviewPersonaliaSubmissionResult = { submissionId: string; status: "selesai" | "perlu_revisi" | "diajukan" };

const APPROVAL_FIELD: Record<"spv" | "management", "spvApproval" | "managerApproval"> = {
  spv: "spvApproval",
  management: "managerApproval",
};
const OTHER_APPROVAL_FIELD: Record<"spv" | "management", "spvApproval" | "managerApproval"> = {
  spv: "managerApproval",
  management: "spvApproval",
};
const APPROVER_LABEL: Record<"spv" | "management", string> = {
  spv: "AWS Supervisor",
  management: "Operational Manager",
};

export async function reviewPersonaliaSubmission(
  rawInput: unknown,
  caller: AppUser
): Promise<ReviewPersonaliaSubmissionResult> {
  const parsed = reviewPersonaliaSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ReviewPersonaliaSubmissionInput = parsed.data;

  if (caller.role !== "spv" && caller.role !== "management") {
    throw new Error("Anda tidak memiliki akses untuk mereview pengajuan.");
  }

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.type !== "personalia") {
    throw new Error("Pengajuan ini bukan kategori personalia.");
  }
  if (submission.status !== "diajukan") {
    throw new Error("Hanya pengajuan berstatus diajukan yang bisa direview.");
  }

  const batch = writeBatch(db);
  const historyRef = doc(collection(submissionRef, "statusHistory"));

  if (input.decision === "reject") {
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
    await batch.commit();
    return { submissionId: input.submissionId, status: "perlu_revisi" };
  }

  const ownField = APPROVAL_FIELD[caller.role];
  const otherField = OTHER_APPROVAL_FIELD[caller.role];
  if (submission[ownField]) {
    throw new Error("Anda sudah memberikan approval untuk pengajuan ini.");
  }

  const bothApproved = submission[otherField] != null;
  const approvalRecord = {
    approverId: caller.uid,
    approverName: caller.name,
    note: input.note ?? null,
    decidedAt: serverTimestamp(),
  };

  batch.update(submissionRef, {
    [ownField]: approvalRecord,
    ...(bothApproved ? { status: "selesai", completedAt: serverTimestamp() } : {}),
  });
  batch.set(historyRef, {
    status: bothApproved ? "selesai" : "diajukan",
    note: bothApproved
      ? null
      : `Disetujui oleh ${APPROVER_LABEL[caller.role]}, menunggu ${APPROVER_LABEL[caller.role === "spv" ? "management" : "spv"]}`,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: bothApproved ? "selesai" : "diajukan" };
}
