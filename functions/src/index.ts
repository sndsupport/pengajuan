import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";
import { shouldGeneratePdf, generateSubmissionPdfHandler } from "./generateSubmissionPdf";

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
