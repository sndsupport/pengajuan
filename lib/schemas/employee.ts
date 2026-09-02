import { z } from "zod";

export const createEmployeeSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  branch: z.enum(["WHO", "WHP", "SND"]),
  department: z.string().min(1, "Departemen wajib diisi"),
  position: z.string().min(1, "Posisi wajib diisi"),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.extend({
  id: z.string().min(1),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
