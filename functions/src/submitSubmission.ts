import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { createSubmissionSchema, CreateSubmissionInput } from "./schemas";
import { getNextSubmissionNumber } from "./counters";
import { deleteFromDrive } from "./googleDrive";

interface CallerContext {
  auth?: { uid: string };
}

export async function submitSubmissionHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["admin_cabang", "snd"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya admin cabang atau SND yang bisa mengajukan.");
  }

  const parsed = createSubmissionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateSubmissionInput = parsed.data;

  if (input.submissionId) {
    return resubmitAfterRevisi(input, context.auth.uid, caller);
  }

  return createNewSubmission(input, context.auth.uid, caller);
}

async function createNewSubmission(
  input: CreateSubmissionInput,
  uid: string,
  caller: FirebaseFirestore.DocumentData
) {
  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, caller.branch, now.getFullYear(), now.getMonth() + 1);

  const submissionRef = db.collection("submissions").doc();
  const batch = db.batch();

  batch.set(submissionRef, {
    submissionNumber,
    type: input.type,
    subType: input.subType,
    status: "diajukan",
    requesterId: uid,
    requesterSignatureUrl: input.requesterSignatureUrl,
    approverId: null,
    approverRole: null,
    branch: caller.branch,
    department: caller.department,
    position: caller.position,
    rejectionNote: null,
    submittedAt: FieldValue.serverTimestamp(),
    reviewedAt: null,
    approvedAt: null,
  });

  input.items.forEach((item) => {
    const itemRef = submissionRef.collection("items").doc();
    batch.set(itemRef, item);
  });

  input.attachments.forEach((attachment) => {
    const attachmentRef = submissionRef.collection("attachments").doc();
    batch.set(attachmentRef, { ...attachment, uploadedAt: FieldValue.serverTimestamp() });
  });

  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "diajukan",
    note: null,
    actorId: uid,
    actorRole: caller.role,
    timestamp: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { submissionId: submissionRef.id, submissionNumber, status: "diajukan" as const };
}

async function resubmitAfterRevisi(
  input: CreateSubmissionInput,
  uid: string,
  caller: FirebaseFirestore.DocumentData
) {
  const submissionRef = db.collection("submissions").doc(input.submissionId!);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== uid) {
    throw new HttpsError("permission-denied", "Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "perlu_revisi") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus perlu_revisi yang bisa direvisi.");
  }

  const existingItems = await submissionRef.collection("items").get();
  const existingAttachments = await submissionRef.collection("attachments").get();
  const batch = db.batch();
  existingItems.forEach((doc) => batch.delete(doc.ref));
  existingAttachments.forEach((doc) => batch.delete(doc.ref));
  input.items.forEach((item) => {
    const itemRef = submissionRef.collection("items").doc();
    batch.set(itemRef, item);
  });
  input.attachments.forEach((attachment) => {
    const attachmentRef = submissionRef.collection("attachments").doc();
    batch.set(attachmentRef, { ...attachment, uploadedAt: FieldValue.serverTimestamp() });
  });

  batch.update(submissionRef, {
    type: input.type,
    subType: input.subType,
    requesterSignatureUrl: input.requesterSignatureUrl,
    status: "diajukan",
    rejectionNote: null,
  });

  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "diajukan",
    note: "Diajukan ulang setelah revisi",
    actorId: uid,
    actorRole: caller.role,
    timestamp: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Best-effort cleanup: delete the Drive file behind each attachment doc that
  // was just removed (i.e. not carried over into the new payload). This must
  // never block or fail the resubmit itself, which has already committed above.
  const keptFileIds = new Set(input.attachments.map((attachment) => attachment.fileId));
  await Promise.all(
    existingAttachments.docs.map(async (doc) => {
      const fileId = doc.data().fileId as string | undefined;
      if (!fileId || keptFileIds.has(fileId)) return;
      try {
        await deleteFromDrive(fileId);
      } catch (error) {
        console.error(`resubmitAfterRevisi: failed to delete orphaned Drive file ${fileId}`, error);
      }
    })
  );

  return { submissionId: submissionRef.id, submissionNumber: submission.submissionNumber as string, status: "diajukan" as const };
}
