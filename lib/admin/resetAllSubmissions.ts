import { collection, DocumentReference, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/lib/hooks/useAuth";

const BATCH_SIZE = 500;

export type ResetProgress = { done: number; total: number };

async function collectRefsToDelete(): Promise<DocumentReference[]> {
  const submissionsSnap = await getDocs(collection(db, "submissions"));
  const refs: DocumentReference[] = [];

  await Promise.all(
    submissionsSnap.docs.map(async (submissionDoc) => {
      const [itemsSnap, attachmentsSnap, historySnap] = await Promise.all([
        getDocs(collection(db, "submissions", submissionDoc.id, "items")),
        getDocs(collection(db, "submissions", submissionDoc.id, "attachments")),
        getDocs(collection(db, "submissions", submissionDoc.id, "statusHistory")),
      ]);
      itemsSnap.docs.forEach((d) => refs.push(d.ref));
      attachmentsSnap.docs.forEach((d) => refs.push(d.ref));
      historySnap.docs.forEach((d) => refs.push(d.ref));
      refs.push(submissionDoc.ref);
    })
  );

  const countersSnap = await getDocs(collection(db, "counters"));
  countersSnap.docs.forEach((d) => refs.push(d.ref));

  return refs;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function resetAllSubmissions(
  caller: AppUser,
  onProgress?: (progress: ResetProgress) => void
): Promise<ResetProgress> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mereset data.");
  }

  const refs = await collectRefsToDelete();
  const total = refs.length;
  let done = 0;
  onProgress?.({ done, total });

  for (const batchRefs of chunk(refs, BATCH_SIZE)) {
    const batch = writeBatch(db);
    batchRefs.forEach((ref) => batch.delete(ref));
    await batch.commit();
    done += batchRefs.length;
    onProgress?.({ done, total });
  }

  return { done, total };
}

export async function countSubmissions(): Promise<number> {
  const snap = await getDocs(collection(db, "submissions"));
  return snap.size;
}
