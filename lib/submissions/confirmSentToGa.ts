import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { confirmSentToGaSchema, ConfirmSentToGaInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type ConfirmSentToGaResult = { submissionId: string; status: "on_proses_ga" };

export async function confirmSentToGa(rawInput: unknown, caller: AppUser): Promise<ConfirmSentToGaResult> {
  const input: ConfirmSentToGaInput = confirmSentToGaSchema.parse(rawInput);

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "siap_dikirim") {
    throw new Error("Hanya pengajuan berstatus siap_dikirim yang bisa dikonfirmasi.");
  }

  const batch = writeBatch(db);
  batch.update(submissionRef, {
    status: "on_proses_ga",
    sentToGaAt: serverTimestamp(),
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "on_proses_ga",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "on_proses_ga" };
}
