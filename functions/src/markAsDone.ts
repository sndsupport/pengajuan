import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { markAsDoneSchema, MarkAsDoneInput } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function markAsDoneHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = markAsDoneSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: MarkAsDoneInput = parsed.data;

  const submissionRef = db.collection("submissions").doc(input.submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "on_proses_ga") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus on_proses_ga yang bisa ditandai selesai.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, {
    status: "selesai",
    completedAt: FieldValue.serverTimestamp(),
  });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "selesai",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "selesai" as const };
}
