import { z } from "zod";
import { BRANCHES } from "@/lib/branches";

export const VEHICLE_CATEGORIES = ["Mobil", "Motor", "Truk"] as const;

export const createVehicleSchema = z.object({
  plateNumber: z.string().min(1, "Plat nomor wajib diisi"),
  vehicleType: z.string().min(1, "Jenis kendaraan wajib diisi"),
  branch: z.enum(BRANCHES),
  category: z.enum(VEHICLE_CATEGORIES),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = createVehicleSchema.extend({
  id: z.string().min(1),
});

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
