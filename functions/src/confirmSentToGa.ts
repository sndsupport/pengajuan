import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { submissionActionSchema } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function confirmSentToGaHandler(rawData: unknown, context: CallerContext) {
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
  if (submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Hanya pemilik pengajuan yang bisa mengonfirmasi ini.");
  }
  if (submission.status !== "siap_dikirim") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus siap_dikirim yang bisa dikonfirmasi.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, { status: "on_proses_ga", sentToGaAt: FieldValue.serverTimestamp() });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "on_proses_ga",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? "unknown",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId, status: "on_proses_ga" as const };
}
