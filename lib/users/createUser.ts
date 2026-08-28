import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, firebaseApp } from "@/lib/firebase/client";
import { createUserSchema, CreateUserInput } from "@/lib/schemas/user";
import { normalizeUsername, usernameToSyntheticEmail } from "./username";
import type { AppUser } from "@/lib/hooks/useAuth";

export type CreateUserResult = { uid: string; username: string };

export async function createUser(rawInput: unknown, caller: AppUser): Promise<CreateUserResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat user.");
  }

  const parsed = createUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateUserInput = parsed.data;
  const normalizedUsername = normalizeUsername(input.username);

  // createUserWithEmailAndPassword signs in as the newly-created user on
  // whichever app instance it's called on — using a throwaway secondary
  // FirebaseApp instance (same project config, different app name) keeps
  // that from replacing the acting superadmin's own session on the primary
  // app instance used everywhere else in this codebase.
  const secondaryApp = initializeApp(firebaseApp.options, `secondary-user-creation-${crypto.randomUUID()}`);
  const secondaryAuth = getAuth(secondaryApp);

  let uid: string;
  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      usernameToSyntheticEmail(input.username),
      input.password
    );
    uid = credential.user.uid;
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "auth/email-already-in-use") {
      throw new Error("Username sudah dipakai.");
    }
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }

  try {
    await setDoc(doc(db, "users", uid), {
      name: input.name,
      username: normalizedUsername,
      email: input.email ?? null,
      role: input.role,
      branch: input.branch,
      department: input.department,
      position: input.position,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    throw new Error(
      `Akun login untuk "${normalizedUsername}" berhasil dibuat, tapi profil usernya gagal tersimpan (uid: ${uid}). Hubungi admin untuk pengecekan manual.`,
      { cause: error }
    );
  }

  return { uid, username: normalizedUsername };
}
