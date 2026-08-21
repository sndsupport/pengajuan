import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
