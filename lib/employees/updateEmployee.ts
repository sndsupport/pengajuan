// lib/employees/updateEmployee.ts
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateEmployeeSchema, UpdateEmployeeInput } from "@/lib/schemas/employee";
import type { AppUser } from "@/lib/hooks/useAuth";

export type UpdateEmployeeResult = { id: string };

export async function updateEmployee(rawInput: unknown, caller: AppUser): Promise<UpdateEmployeeResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah data pegawai.");
  }

  const parsed = updateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateEmployeeInput = parsed.data;

  const ref = doc(db, "employees", input.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Data pegawai tidak ditemukan.");
  }

  await updateDoc(ref, {
    name: input.name,
    branch: input.branch,
    department: input.department,
    position: input.position,
  });

  return { id: input.id };
}
