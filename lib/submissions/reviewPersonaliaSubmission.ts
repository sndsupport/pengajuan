import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
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
  const role = caller.role;

  const submissionRef = doc(db, "submissions", input.submissionId);

  // Runs as a Firestore transaction (not a plain getDoc + writeBatch) because two
  // approvers can click "approve" concurrently: without a transaction, both reads
  // could see the other's approval field as still null, both writes would then
  // only set their own field, and the submission would get permanently stuck at
  // "diajukan" with both approvals set but no write ever setting status to
  // "selesai". A transaction forces the second committer to retry against a fresh
  // read that already reflects the first committer's write.
  const status = await runTransaction(db, async (tx) => {
    const submissionSnap = await tx.get(submissionRef);
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

    const historyRef = doc(collection(submissionRef, "statusHistory"));

    if (input.decision === "reject") {
      tx.update(submissionRef, {
        status: "perlu_revisi",
        rejectionNote: input.rejectionNote,
        reviewedAt: serverTimestamp(),
      });
      tx.set(historyRef, {
        status: "perlu_revisi",
        note: input.rejectionNote,
        actorId: caller.uid,
        actorRole: caller.role,
        timestamp: serverTimestamp(),
        submissionNumber: submission.submissionNumber,
        employeeName: submission.employeeName,
      });
      return "perlu_revisi" as const;
    }

    const ownField = APPROVAL_FIELD[role];
    const otherField = OTHER_APPROVAL_FIELD[role];
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

    tx.update(submissionRef, {
      [ownField]: approvalRecord,
      ...(bothApproved ? { status: "selesai", completedAt: serverTimestamp() } : {}),
    });
    tx.set(historyRef, {
      status: bothApproved ? "selesai" : "diajukan",
      note: bothApproved
        ? null
        : `Disetujui oleh ${APPROVER_LABEL[role]}, menunggu ${APPROVER_LABEL[role === "spv" ? "management" : "spv"]}`,
      actorId: caller.uid,
      actorRole: caller.role,
      timestamp: serverTimestamp(),
      submissionNumber: submission.submissionNumber,
      employeeName: submission.employeeName,
    });

    return bothApproved ? ("selesai" as const) : ("diajukan" as const);
  });

  return { submissionId: input.submissionId, status };
}
