import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateUserSchema, UpdateUserInput } from "@/lib/schemas/user";
import type { AppUser } from "@/lib/hooks/useAuth";

export type UpdateUserResult = { uid: string };

export async function updateUser(rawInput: unknown, caller: AppUser): Promise<UpdateUserResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah user.");
  }

  const parsed = updateUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateUserInput = parsed.data;

  const userRef = doc(db, "users", input.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error("User tidak ditemukan.");
  }

  await updateDoc(userRef, {
    name: input.name,
    role: input.role,
    branch: input.branch,
    department: input.department,
    position: input.position,
    email: input.email ?? null,
  });

  return { uid: input.uid };
}
