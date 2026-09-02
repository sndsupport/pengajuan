"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateEmployeeSchema, UpdateEmployeeInput } from "@/lib/schemas/employee";
import { updateEmployee } from "@/lib/employees/updateEmployee";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

function EditEmployeeContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [isLoadingEmployee, setIsLoadingEmployee] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateEmployeeSchema>, unknown, UpdateEmployeeInput>({
    resolver: zodResolver(updateEmployeeSchema),
    defaultValues: { id: id ?? "", name: "", branch: "WHO", department: "", position: "" },
  });

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    if (!id) {
      setIsLoadingEmployee(false);
      setLoadError("Data pegawai tidak ditemukan.");
      return;
    }
    let cancelled = false;

    async function loadEmployee() {
      setIsLoadingEmployee(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "employees", id as string));
        if (!snap.exists()) {
          throw new Error("Data pegawai tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        reset({
          id: id as string,
          name: data.name ?? "",
          branch: data.branch ?? "WHO",
          department: data.department ?? "",
          position: data.position ?? "",
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat data pegawai.");
        }
      } finally {
        if (!cancelled) setIsLoadingEmployee(false);
      }
    }

    loadEmployee();
    return () => {
      cancelled = true;
    };
  }, [id, reset]);

  async function onSubmit(data: UpdateEmployeeInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await updateEmployee(data, appUser);
      router.push("/admin/pegawai");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah data pegawai.");
    }
  }

  if (isLoadingEmployee) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>;
  }

  if (loadError) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-destructive">{loadError}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Edit Pegawai" description="Perbarui data pegawai." />

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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="branch">Cabang</Label>
                <NativeSelect id="branch" {...register("branch")}>
                  <option value="WHO">WHO</option>
                  <option value="WHP">WHP</option>
                  <option value="SND">SND</option>
                </NativeSelect>
              </div>

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
    </div>
  );
}

export default function EditEmployeePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>}>
      <EditEmployeeContent />
    </Suspense>
  );
}
