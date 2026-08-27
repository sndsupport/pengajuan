import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";
import { updateUserSchema, UpdateUserInput } from "./userSchemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function updateUserHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || caller.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Hanya superadmin yang bisa mengubah user.");
  }

  const parsed = updateUserSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateUserInput = parsed.data;

  const userRef = db.collection("users").doc(input.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User tidak ditemukan.");
  }

  await userRef.update({
    name: input.name,
    role: input.role,
    branch: input.branch,
    department: input.department,
    position: input.position,
    email: input.email ?? null,
  });

  return { uid: input.uid };
}
