import { HttpsError } from "firebase-functions/v2/https";
import { auth, db } from "./admin";
import { resetUserPasswordSchema, ResetUserPasswordInput } from "./userSchemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function resetUserPasswordHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || caller.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Hanya superadmin yang bisa mereset password.");
  }

  const parsed = resetUserPasswordSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ResetUserPasswordInput = parsed.data;

  try {
    await auth.updateUser(input.uid, { password: input.newPassword });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/user-not-found") {
      throw new HttpsError("not-found", "User tidak ditemukan.");
    }
    throw err;
  }

  return { uid: input.uid };
}
