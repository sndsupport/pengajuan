// lib/vehicles/updateVehicle.ts
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateVehicleSchema, UpdateVehicleInput } from "@/lib/schemas/vehicle";
import type { AppUser } from "@/lib/hooks/useAuth";

export type UpdateVehicleResult = { id: string };

export async function updateVehicle(rawInput: unknown, caller: AppUser): Promise<UpdateVehicleResult> {
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk mengubah data kendaraan.");
  }

  const parsed = updateVehicleSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateVehicleInput = parsed.data;

  const ref = doc(db, "vehicles", input.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Data kendaraan tidak ditemukan.");
  }

  await updateDoc(ref, {
    plateNumber: input.plateNumber,
    vehicleType: input.vehicleType,
    branch: input.branch,
    category: input.category,
  });

  return { id: input.id };
}
