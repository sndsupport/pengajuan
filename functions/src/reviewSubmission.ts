import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { reviewSubmissionSchema, ReviewSubmissionInput } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function reviewSubmissionHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["spv", "management"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya SPV atau Management yang bisa mereview.");
  }

  const parsed = reviewSubmissionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ReviewSubmissionInput = parsed.data;

  const submissionRef = db.collection("submissions").doc(input.submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission) {
    throw new HttpsError("not-found", "Pengajuan tidak ditemukan.");
  }
  if (submission.status !== "diajukan") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus diajukan yang bisa direview.");
  }

  const batch = db.batch();
  const historyRef = submissionRef.collection("statusHistory").doc();

  if (input.decision === "approve") {
    batch.update(submissionRef, {
      status: "disetujui",
      approverId: context.auth.uid,
      approverRole: caller.role,
      approverSignatureUrl: input.approverSignatureUrl,
      approvedAt: FieldValue.serverTimestamp(),
      reviewedAt: FieldValue.serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "disetujui",
      note: null,
      actorId: context.auth.uid,
      actorRole: caller.role,
      timestamp: FieldValue.serverTimestamp(),
    });
  } else {
    batch.update(submissionRef, {
      status: "perlu_revisi",
      rejectionNote: input.rejectionNote,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "perlu_revisi",
      note: input.rejectionNote,
      actorId: context.auth.uid,
      actorRole: caller.role,
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
