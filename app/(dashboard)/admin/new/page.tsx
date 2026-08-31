"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { createUserSchema, CreateUserInput } from "@/lib/schemas/user";
import { createUser } from "@/lib/users/createUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Operational Manager" },
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
  const [showPassword, setShowPassword] = useState(false);

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
    if (!appUser) return;
    setServerError(null);
    try {
      await createUser({ ...data, email: data.email || null }, appUser);
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat user.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Buat User" description="Tambahkan akun pengguna baru untuk aplikasi ini." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Nama</Label>
                <Input
                  id="name"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  {...register("name")}
                />
                {errors.name && (
                  <p id="name-error" className="text-sm text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  aria-invalid={!!errors.username}
                  aria-describedby={errors.username ? "username-error" : undefined}
                  {...register("username")}
                />
                {errors.username && (
                  <p id="username-error" className="text-sm text-destructive">
                    {errors.username.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password Awal</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="pr-9"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <NativeSelect id="role" {...roleField} onChange={handleRoleChange}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {selectedRole === "admin_cabang" && (
                <div className="space-y-1.5">
                  <Label htmlFor="branch">Cabang</Label>
                  <NativeSelect id="branch" {...register("branch")}>
                    <option value="WHO">WHO</option>
                    <option value="WHP">WHP</option>
                  </NativeSelect>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="department">Departemen</Label>
                <Input
                  id="department"
                  aria-invalid={!!errors.department}
                  aria-describedby={errors.department ? "department-error" : undefined}
                  {...register("department")}
                />
                {errors.department && (
                  <p id="department-error" className="text-sm text-destructive">
                    {errors.department.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="position">Posisi</Label>
                <Input
                  id="position"
                  aria-invalid={!!errors.position}
                  aria-describedby={errors.position ? "position-error" : undefined}
                  {...register("position")}
                />
                {errors.position && (
                  <p id="position-error" className="text-sm text-destructive">
                    {errors.position.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email (opsional)</Label>
              <Input
                id="email"
                type="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email", { setValueAs: (v) => (v === "" ? undefined : v) })}
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            {serverError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Membuat..." : "Buat User"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
