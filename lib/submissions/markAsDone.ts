import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { markAsDoneSchema, MarkAsDoneInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type MarkAsDoneResult = { submissionId: string; status: "selesai" };

export async function markAsDone(rawInput: unknown, caller: AppUser): Promise<MarkAsDoneResult> {
  const parsed = markAsDoneSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: MarkAsDoneInput = parsed.data;

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "on_proses_ga") {
    throw new Error("Hanya pengajuan berstatus on_proses_ga yang bisa ditandai selesai.");
  }

  const batch = writeBatch(db);
  batch.update(submissionRef, {
    status: "selesai",
    completedAt: serverTimestamp(),
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "selesai",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "selesai" };
}
