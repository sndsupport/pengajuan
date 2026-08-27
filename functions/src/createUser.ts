import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "./admin";
import { createUserSchema, CreateUserInput } from "./userSchemas";
import { normalizeUsername, usernameToSyntheticEmail } from "./username";

interface CallerContext {
  auth?: { uid: string };
}

export async function createUserHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || caller.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Hanya superadmin yang bisa membuat user.");
  }

  const parsed = createUserSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateUserInput = parsed.data;
  const normalizedUsername = normalizeUsername(input.username);

  let uid: string;
  try {
    const userRecord = await auth.createUser({
      email: usernameToSyntheticEmail(input.username),
      password: input.password,
      displayName: input.name,
    });
    uid = userRecord.uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Username sudah dipakai.");
    }
    throw err;
  }

  await db.collection("users").doc(uid).set({
    name: input.name,
    username: normalizedUsername,
    email: input.email ?? null,
    role: input.role,
    branch: input.branch,
    department: input.department,
    position: input.position,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { uid, username: normalizedUsername };
}
