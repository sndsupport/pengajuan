import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { uploadFileHandler } from "./uploadFile";

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
