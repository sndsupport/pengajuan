// lib/employees/createEmployee.ts
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createEmployeeSchema, CreateEmployeeInput } from "@/lib/schemas/employee";
import type { AppUser } from "@/lib/hooks/useAuth";

export type CreateEmployeeResult = { id: string };

export async function createEmployee(rawInput: unknown, caller: AppUser): Promise<CreateEmployeeResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat data pegawai.");
  }

  const parsed = createEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateEmployeeInput = parsed.data;

  const ref = await addDoc(collection(db, "employees"), {
    name: input.name,
    branch: input.branch,
    department: input.department,
    position: input.position,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id };
}
