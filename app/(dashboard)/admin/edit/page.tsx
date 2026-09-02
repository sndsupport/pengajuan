"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateUserSchema, UpdateUserInput } from "@/lib/schemas/user";
import { updateUser } from "@/lib/users/updateUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Operational Manager" },
  { value: "superadmin", label: "Superadmin" },
] as const;

function EditUserContent() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState<string | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateUserSchema>, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { uid: uid ?? "", name: "", role: "admin", branch: null, department: "", position: "", email: "" },
  });

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    if (!uid) {
      setIsLoadingUser(false);
      setLoadError("User tidak ditemukan.");
      return;
    }
    let cancelled = false;

    async function loadUser() {
      setIsLoadingUser(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "users", uid as string));
        if (!snap.exists()) {
          throw new Error("User tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        setUsername(data.username ?? null);
        reset({
          uid: uid as string,
          name: data.name ?? "",
          role: data.role,
          branch: data.branch ?? null,
          department: data.department ?? "",
          position: data.position ?? "",
          email: data.email ?? "",
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat data user.");
        }
      } finally {
        if (!cancelled) setIsLoadingUser(false);
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, [uid, reset]);

  const roleField = register("role");

  async function onSubmit(data: UpdateUserInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await updateUser({ ...data, email: data.email || null }, appUser);
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah user.");
    }
  }

  if (isLoadingUser) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>;
  }

  if (loadError) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-destructive">{loadError}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title={`Edit User${username ? ` — ${username}` : ""}`} description="Perbarui data akun pengguna." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
              <Label htmlFor="role">Role</Label>
              <NativeSelect id="role" {...roleField}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
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
              {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reset Password</CardTitle>
          <CardDescription>
            Reset password tidak bisa dilakukan lewat aplikasi ini. Gunakan tab Authentication di Firebase Console
            untuk mereset password user.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export default function EditUserPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>}>
      <EditUserContent />
    </Suspense>
  );
}
