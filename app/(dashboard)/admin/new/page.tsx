"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { createUserSchema, CreateUserInput } from "@/lib/schemas/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (error) {
    // connectFunctionsEmulator throws if called again on an already-configured
    // instance (e.g. Next.js Fast Refresh re-evaluating this module).
    console.warn("[functions] Emulator connection skipped (already configured):", error);
  }
}

const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Management" },
  { value: "superadmin", label: "Superadmin" },
] as const;

function defaultBranchForRole(role: CreateUserInput["role"]): CreateUserInput["branch"] {
  if (role === "admin_cabang") return "WHO";
  if (role === "snd") return "SND";
  return null;
}

export default function NewUserPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createUserSchema>, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      username: "",
      password: "",
      role: "admin_cabang",
      branch: "WHO",
      department: "",
      position: "",
      email: "",
    },
  });

  const selectedRole = watch("role");
  const roleField = register("role");

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    roleField.onChange(event);
    setValue("branch", defaultBranchForRole(event.target.value as CreateUserInput["role"]));
  }

  async function onSubmit(data: CreateUserInput) {
    setServerError(null);
    try {
      const createUser = httpsCallable(functions, "createUser");
      await createUser({ ...data, email: data.email || null });
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat user.");
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-xl font-semibold">Buat User</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Nama</Label>
          <Input id="name" {...register("name")} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="username">Username</Label>
          <Input id="username" {...register("username")} />
          {errors.username && <p className="text-sm text-red-600">{errors.username.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="password">Password Awal</Label>
          <Input id="password" type="password" {...register("password")} />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          <select id="role" {...roleField} onChange={handleRoleChange} className="w-full rounded border p-2">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {selectedRole === "admin_cabang" && (
          <div className="space-y-1">
            <Label htmlFor="branch">Cabang</Label>
            <select id="branch" {...register("branch")} className="w-full rounded border p-2">
              <option value="WHO">WHO</option>
              <option value="WHP">WHP</option>
            </select>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="department">Departemen</Label>
          <Input id="department" {...register("department")} />
          {errors.department && <p className="text-sm text-red-600">{errors.department.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="position">Posisi</Label>
          <Input id="position" {...register("position")} />
          {errors.position && <p className="text-sm text-red-600">{errors.position.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="email">Email (opsional)</Label>
          <Input
            id="email"
            type="email"
            {...register("email", { setValueAs: (v) => (v === "" ? undefined : v) })}
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Membuat..." : "Buat User"}
        </Button>
      </form>
    </main>
  );
}
