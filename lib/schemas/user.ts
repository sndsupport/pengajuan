import { z } from "zod";

export const roleSchema = z.enum(["admin", "spv", "management", "superadmin"]);
export type Role = z.infer<typeof roleSchema>;

export const branchSchema = z.enum(["WHO", "WHP", "SND"]).nullable();

export function isValidBranchForRole(_role: Role, branch: string | null): boolean {
  return branch === null;
}

const baseUserFields = {
  name: z.string().min(1, "Nama wajib diisi"),
  role: roleSchema,
  branch: branchSchema,
  department: z.string().min(1, "Departemen wajib diisi"),
  position: z.string().min(1, "Posisi wajib diisi"),
  email: z.string().email("Email tidak valid").nullish(),
};

export const createUserSchema = z
  .object({
    ...baseUserFields,
    username: z
      .string()
      .min(1, "Username wajib diisi")
      .refine((v) => !/\s/.test(v) && !v.includes("@"), {
        message: "Username tidak boleh mengandung spasi atau '@'.",
      }),
    password: z.string().min(6, "Password minimal 6 karakter"),
  })
  .refine((data) => isValidBranchForRole(data.role, data.branch), {
    message: "Cabang tidak sesuai dengan role",
    path: ["branch"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    uid: z.string().min(1),
    ...baseUserFields,
  })
  .refine((data) => isValidBranchForRole(data.role, data.branch), {
    message: "Cabang tidak sesuai dengan role",
    path: ["branch"],
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
