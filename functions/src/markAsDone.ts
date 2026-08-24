import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { submissionActionSchema } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function markAsDoneHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = submissionActionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { submissionId } = parsed.data;

  const submissionRef = db.collection("submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();
  if (!submission) {
    throw new HttpsError("not-found", "Pengajuan tidak ditemukan.");
  }
  // Only the requester may mark a submission done — not spv/management/superadmin,
  // even though they can read/review it. This mirrors the rule in CLAUDE.md that
  // "selesai" hanya bisa di-set oleh pemilik pengajuan.
  if (submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Hanya pemilik pengajuan yang bisa menandai selesai.");
  }
  if (submission.status !== "on_proses_ga") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus on_proses_ga yang bisa ditandai selesai.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, { status: "selesai", completedAt: FieldValue.serverTimestamp() });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "selesai",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? "unknown",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId, status: "selesai" as const };
}
