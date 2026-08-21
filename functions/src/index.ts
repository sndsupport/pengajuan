import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
