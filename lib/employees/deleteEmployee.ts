// lib/employees/deleteEmployee.ts
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/lib/hooks/useAuth";

export async function deleteEmployee(id: string, caller: AppUser): Promise<void> {
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk menghapus data pegawai.");
  }
  await deleteDoc(doc(db, "employees", id));
}
