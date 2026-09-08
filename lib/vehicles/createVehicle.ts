// lib/vehicles/createVehicle.ts
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createVehicleSchema, CreateVehicleInput } from "@/lib/schemas/vehicle";
import type { AppUser } from "@/lib/hooks/useAuth";

export type CreateVehicleResult = { id: string };

export async function createVehicle(rawInput: unknown, caller: AppUser): Promise<CreateVehicleResult> {
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk membuat data kendaraan.");
  }

  const parsed = createVehicleSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateVehicleInput = parsed.data;

  const ref = await addDoc(collection(db, "vehicles"), {
    plateNumber: input.plateNumber,
    vehicleType: input.vehicleType,
    branch: input.branch,
    category: input.category,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id };
}
