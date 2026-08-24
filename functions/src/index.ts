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

export const uploadFile = onCall((request) =>
  uploadFileHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
