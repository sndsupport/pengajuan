import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { uploadFileHandler } from "./uploadFile";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";
import { shouldGeneratePdf, generateSubmissionPdfHandler } from "./generateSubmissionPdf";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Attachments/signatures arrive as base64 (a 10MB file is ~13MB of base64) and
// are held in memory as a decoded Buffer while being streamed to Drive, so this
// needs more headroom than the default 256MiB/60s callable limits.
export const uploadFile = onCall({ memory: "512MiB", timeoutSeconds: 120 }, (request) =>
  uploadFileHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const createUser = onCall((request) =>
  createUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const updateUser = onCall((request) =>
  updateUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const resetUserPassword = onCall((request) =>
  resetUserPasswordHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Puppeteer needs meaningfully more memory/time than the default 256MiB/60s —
// see docs/superpowers/specs/2026-08-27-generate-submission-pdf-design.md.
export const generateSubmissionPdf = onDocumentUpdated(
  { document: "submissions/{submissionId}", memory: "1GiB", timeoutSeconds: 120 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || !shouldGeneratePdf(before, after)) return;
    await generateSubmissionPdfHandler(event.params.submissionId, after);
  }
);
