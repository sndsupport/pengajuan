import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { confirmSentToGaSchema, ConfirmSentToGaInput } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function confirmSentToGaHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = confirmSentToGaSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ConfirmSentToGaInput = parsed.data;

  const submissionRef = db.collection("submissions").doc(input.submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "siap_dikirim") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus siap_dikirim yang bisa dikonfirmasi.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, {
    status: "on_proses_ga",
    sentToGaAt: FieldValue.serverTimestamp(),
  });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "on_proses_ga",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "on_proses_ga" as const };
}
