import { onCall } from "firebase-functions/v2/https";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";

export const createUser = onCall((request) =>
  createUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const updateUser = onCall((request) =>
  updateUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const resetUserPassword = onCall((request) =>
  resetUserPasswordHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
