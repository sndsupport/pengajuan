import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createPersonaliaSubmissionSchema, CreatePersonaliaSubmissionInput } from "@/lib/schemas/submission";
import { getNextSubmissionNumber } from "@/lib/counters";
import { deleteFromDriveClient } from "@/lib/drive-upload";
import type { AppUser } from "@/lib/hooks/useAuth";

export type SubmitPersonaliaSubmissionResult = { submissionId: string; submissionNumber: string; status: "diajukan" };

const ALLOWED_ROLES_BY_SUBTYPE: Record<CreatePersonaliaSubmissionInput["subType"], AppUser["role"][]> = {
  lembur: ["admin"],
  cuti: ["admin", "spv"],
  izin: ["admin", "spv"],
};

async function resolveEmployeeContext(
  input: CreatePersonaliaSubmissionInput,
  caller: AppUser
): Promise<{ branch: string; department: string; position: string }> {
  if (input.employeeId) {
    const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
    const employee = employeeSnap.data();
    if (!employee) {
      throw new Error("Data pegawai tidak ditemukan.");
    }
    return { branch: employee.branch, department: employee.department, position: employee.position };
  }

  if (caller.role === "spv") {
    // Self-submit path (spv submitting their own cuti/izin): every role's
    // own branch is null under the centralized-admin model, and there's no
    // employee record to pull a real one from. Fall back to a fixed label
    // instead of leaking "null" into the submission number/counter key —
    // this is a pre-existing gap (the old code silently passed a null
    // branch via a non-null assertion), not new behavior introduced here.
    return { branch: caller.branch ?? "HQ", department: caller.department, position: caller.position };
  }

  throw new Error("Pegawai wajib dipilih.");
}

export async function submitPersonaliaSubmission(
  rawInput: unknown,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  const parsed = createPersonaliaSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreatePersonaliaSubmissionInput = parsed.data;

  if (!ALLOWED_ROLES_BY_SUBTYPE[input.subType].includes(caller.role)) {
    throw new Error("Anda tidak memiliki akses untuk mengajukan kategori ini.");
  }

  if (input.submissionId) {
    return resubmitAfterRevisi(input, caller);
  }
  return createNewSubmission(input, caller);
}

async function createNewSubmission(
  input: CreatePersonaliaSubmissionInput,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  const { branch, department, position } = await resolveEmployeeContext(input, caller);

  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, branch, now.getFullYear(), now.getMonth() + 1);

  // Same ordering rationale as submitSubmission.ts: the submission doc is created
  // and awaited before the batch, because the attachments subcollection's create
  // rule needs to get() this parent doc, and a same-batch create wouldn't be
  // visible yet when Firestore evaluates the batch against pre-batch state.
  const submissionRef = doc(collection(db, "submissions"));
  await setDoc(submissionRef, {
    submissionNumber,
    type: "personalia",
    subType: input.subType,
    status: "diajukan",
    requesterId: caller.uid,
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    spvApproval: null,
    managerApproval: null,
    branch,
    department,
    position,
    rejectionNote: null,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    completedAt: null,
  });

  const batch = writeBatch(db);
  const attachmentRef = doc(collection(submissionRef, "attachments"));
  batch.set(attachmentRef, { ...input.attachment, uploadedAt: serverTimestamp() });
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
      `Pengajuan ${submissionNumber} sudah dibuat tapi dokumennya gagal tersimpan. Hubungi admin untuk pengecekan manual.`,
      { cause: error }
    );
  }

  return { submissionId: submissionRef.id, submissionNumber, status: "diajukan" };
}

async function resubmitAfterRevisi(
  input: CreatePersonaliaSubmissionInput,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  const submissionRef = doc(db, "submissions", input.submissionId!);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "perlu_revisi") {
    throw new Error("Hanya pengajuan berstatus perlu_revisi yang bisa direvisi.");
  }

  const { branch, department, position } = await resolveEmployeeContext(input, caller);

  const existingAttachmentsSnap = await getDocs(collection(submissionRef, "attachments"));

  const batch = writeBatch(db);
  existingAttachmentsSnap.forEach((d) => batch.delete(d.ref));
  const attachmentRef = doc(collection(submissionRef, "attachments"));
  batch.set(attachmentRef, { ...input.attachment, uploadedAt: serverTimestamp() });
  batch.update(submissionRef, {
    subType: input.subType,
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName,
    branch,
    department,
    position,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: "diajukan",
    rejectionNote: null,
    spvApproval: null,
    managerApproval: null,
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

  const keptFileIds = new Set([input.attachment.fileId]);
  await Promise.all(
    existingAttachmentsSnap.docs.map(async (d) => {
      const fileId = d.data().fileId as string | undefined;
      if (!fileId || keptFileIds.has(fileId)) return;
      try {
        await deleteFromDriveClient(fileId);
      } catch (error) {
        console.error(`resubmitAfterRevisi (personalia): failed to delete orphaned Drive file ${fileId}`, error);
      }
    })
  );

  return {
    submissionId: submissionRef.id,
    submissionNumber: submission.submissionNumber as string,
    status: "diajukan",
  };
}
