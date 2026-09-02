import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createSubmissionSchema, CreateSubmissionInput } from "@/lib/schemas/submission";
import { getNextSubmissionNumber } from "@/lib/counters";
import { deleteFromDriveClient } from "@/lib/drive-upload";
import type { AppUser } from "@/lib/hooks/useAuth";

export type SubmitSubmissionResult = { submissionId: string; submissionNumber: string; status: "diajukan" };

export async function submitSubmission(rawInput: unknown, caller: AppUser): Promise<SubmitSubmissionResult> {
  const parsed = createSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateSubmissionInput = parsed.data;

  if (input.submissionId) {
    return resubmitAfterRevisi(input, caller);
  }
  return createNewSubmission(input, caller);
}

async function createNewSubmission(input: CreateSubmissionInput, caller: AppUser): Promise<SubmitSubmissionResult> {
  const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
  const employee = employeeSnap.data();
  if (!employee) {
    throw new Error("Data pegawai tidak ditemukan.");
  }

  // NOTE: unlike the old Cloud Function (server clock, trustworthy), this now runs
  // client-side — a misconfigured device clock/timezone could stamp the wrong
  // month/year on submissionNumber. Accepted risk: no cheap way to get a trusted
  // server time synchronously before the counter transaction without Cloud Functions.
  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, employee.branch, now.getFullYear(), now.getMonth() + 1);

  // Create the submission doc first (awaited, truly committed) BEFORE writing its
  // items/attachments/statusHistory in a batch — the items/attachments create rule
  // needs to `get()` this document, and Firestore evaluates every write in a batch
  // against the pre-batch state, so a same-batch create wouldn't be visible yet.
  const submissionRef = doc(collection(db, "submissions"));
  await setDoc(submissionRef, {
    submissionNumber,
    type: input.type,
    subType: input.subType,
    status: "diajukan",
    requesterId: caller.uid,
    employeeId: input.employeeId,
    employeeName: employee.name,
    requesterSignatureUrl: input.requesterSignatureUrl,
    approverId: null,
    approverRole: null,
    approverSignatureUrl: null,
    branch: employee.branch,
    department: employee.department,
    position: employee.position,
    rejectionNote: null,
    pdfUrl: null,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    approvedAt: null,
    sentToGaAt: null,
    completedAt: null,
  });

  const batch = writeBatch(db);
  input.items.forEach((item) => {
    const itemRef = doc(collection(submissionRef, "items"));
    batch.set(itemRef, item);
  });
  input.attachments.forEach((attachment) => {
    const attachmentRef = doc(collection(submissionRef, "attachments"));
    batch.set(attachmentRef, { ...attachment, uploadedAt: serverTimestamp() });
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "diajukan",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    throw new Error(
      `Pengajuan ${submissionNumber} sudah dibuat tapi item/lampirannya gagal tersimpan. Hubungi admin untuk pengecekan manual.`,
      { cause: error }
    );
  }

  return { submissionId: submissionRef.id, submissionNumber, status: "diajukan" };
}

async function resubmitAfterRevisi(input: CreateSubmissionInput, caller: AppUser): Promise<SubmitSubmissionResult> {
  const submissionRef = doc(db, "submissions", input.submissionId!);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "perlu_revisi") {
    throw new Error("Hanya pengajuan berstatus perlu_revisi yang bisa direvisi.");
  }

  const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
  const employee = employeeSnap.data();
  if (!employee) {
    throw new Error("Data pegawai tidak ditemukan.");
  }

  const existingItemsSnap = await getDocs(collection(submissionRef, "items"));
  const existingAttachmentsSnap = await getDocs(collection(submissionRef, "attachments"));

  // Single atomic batch is safe here: the items/attachments create/delete rule's
  // get() on the parent submission sees the PRE-batch status ("perlu_revisi"),
  // which is itself one of the two statuses that rule allows editing under — so
  // it doesn't matter that this same batch also updates status to "diajukan".
  const batch = writeBatch(db);
  existingItemsSnap.forEach((d) => batch.delete(d.ref));
  existingAttachmentsSnap.forEach((d) => batch.delete(d.ref));
  input.items.forEach((item) => {
    const itemRef = doc(collection(submissionRef, "items"));
    batch.set(itemRef, item);
  });
  input.attachments.forEach((attachment) => {
    const attachmentRef = doc(collection(submissionRef, "attachments"));
    batch.set(attachmentRef, { ...attachment, uploadedAt: serverTimestamp() });
  });
  batch.update(submissionRef, {
    type: input.type,
    subType: input.subType,
    employeeId: input.employeeId,
    employeeName: employee.name,
    branch: employee.branch,
    department: employee.department,
    position: employee.position,
    requesterSignatureUrl: input.requesterSignatureUrl,
    status: "diajukan",
    rejectionNote: null,
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "diajukan",
    note: "Diajukan ulang setelah revisi",
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  const keptFileIds = new Set(input.attachments.map((a) => a.fileId));
  await Promise.all(
    existingAttachmentsSnap.docs.map(async (d) => {
      const fileId = d.data().fileId as string | undefined;
      if (!fileId || keptFileIds.has(fileId)) return;
      try {
        await deleteFromDriveClient(fileId);
      } catch (error) {
        console.error(`resubmitAfterRevisi: failed to delete orphaned Drive file ${fileId}`, error);
      }
    })
  );

  return {
    submissionId: submissionRef.id,
    submissionNumber: submission.submissionNumber as string,
    status: "diajukan",
  };
}
