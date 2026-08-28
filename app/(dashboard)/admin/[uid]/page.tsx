"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Management" },
  { value: "superadmin", label: "Superadmin" },
] as const;

function defaultBranchForRole(role: UpdateUserInput["role"]): UpdateUserInput["branch"] {
  if (role === "admin_cabang") return "WHO";
  if (role === "snd") return "SND";
  return null;
}

export default function EditUserPage({ params }: { params: { uid: string } }) {
  const { uid } = params;
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState<string | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateUserSchema>, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { uid, name: "", role: "admin_cabang", branch: "WHO", department: "", position: "", email: "" },
  });

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      setIsLoadingUser(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) {
          throw new Error("User tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        setUsername(data.username ?? null);
        reset({
          uid,
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

  const selectedRole = watch("role");
  const roleField = register("role");

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    roleField.onChange(event);
    setValue("branch", defaultBranchForRole(event.target.value as UpdateUserInput["role"]));
  }

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
    return <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Memuat...</main>;
  }

  if (loadError) {
    return <main className="mx-auto max-w-md p-6 text-sm text-red-600">{loadError}</main>;
  }

  return (
    <main className="mx-auto max-w-md space-y-8 p-6">
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Edit User{username ? ` (${username})` : ""}</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Nama</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
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
            <Input id="email" type="email" {...register("email", { setValueAs: (v) => (v === "" ? undefined : v) })} />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>

          {serverError && <p className="text-sm text-red-600">{serverError}</p>}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </form>
      </div>

      <div className="space-y-2 border-t pt-6">
        <h2 className="text-lg font-semibold">Reset Password</h2>
        <p className="text-sm text-muted-foreground">
          Reset password tidak bisa dilakukan lewat aplikasi ini. Gunakan tab Authentication di Firebase Console
          untuk mereset password user.
        </p>
      </div>
    </main>
  );
}
