import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { uploadFileHandler } from "./uploadFile";
import { confirmSentToGaHandler } from "./confirmSentToGa";
import { markAsDoneHandler } from "./markAsDone";
import { generateSubmissionPdfHandler } from "./generateSubmissionPdf";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Attachments/signatures arrive as base64 (a 10MB file is ~13MB of base64) and
// are held in memory as a decoded Buffer while being streamed to Drive, so this
// needs more headroom than the default 256MiB/60s callable limits.
//
// Runs as a dedicated service account (rather than the default compute SA)
// because it's the identity shared with the Google Drive folder that holds
// attachments/signatures — see docs/superpowers/specs/2026-08-22-attachments-signature-upload-gdrive-design.md.
export const uploadFile = onCall(
  { memory: "512MiB", timeoutSeconds: 120, serviceAccount: "drive-uploader-dev@sndsupportapps.iam.gserviceaccount.com" },
  (request) => uploadFileHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const confirmSentToGa = onCall((request) =>
  confirmSentToGaHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const markAsDone = onCall((request) =>
  markAsDoneHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Fires when a submission's status transitions to "disetujui", renders the GA
// form PDF, uploads it to the same Drive folder as attachments/signatures, and
// advances status to "siap_dikirim". Runs as the Drive-sharing service account
// (same as uploadFile) since it needs Drive write access.
export const generateSubmissionPdf = onDocumentUpdated(
  {
    document: "submissions/{submissionId}",
    memory: "1GiB",
    timeoutSeconds: 60,
    retry: true,
    serviceAccount: "drive-uploader-dev@sndsupportapps.iam.gserviceaccount.com",
  },
  async (event) => {
    if (!event.data) return;
    await generateSubmissionPdfHandler(
      event.params.submissionId,
      event.data.before.data() ?? {},
      event.data.after.data() ?? {}
    );
  }
);
