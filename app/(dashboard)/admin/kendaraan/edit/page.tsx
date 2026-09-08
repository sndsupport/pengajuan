"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateVehicleSchema, UpdateVehicleInput, VEHICLE_CATEGORIES } from "@/lib/schemas/vehicle";
import { BRANCHES } from "@/lib/branches";
import { updateVehicle } from "@/lib/vehicles/updateVehicle";
import { deleteVehicle } from "@/lib/vehicles/deleteVehicle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

function EditVehicleContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [isLoadingVehicle, setIsLoadingVehicle] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateVehicleSchema>, unknown, UpdateVehicleInput>({
    resolver: zodResolver(updateVehicleSchema),
    defaultValues: { id: id ?? "", plateNumber: "", vehicleType: "", branch: BRANCHES[0], category: "Mobil" },
  });

  useEffect(() => {
    if (!loading && appUser && !["admin", "spv", "superadmin"].includes(appUser.role)) {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    if (!id) {
      setIsLoadingVehicle(false);
      setLoadError("Data kendaraan tidak ditemukan.");
      return;
    }
    let cancelled = false;

    async function loadVehicle() {
      setIsLoadingVehicle(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "vehicles", id as string));
        if (!snap.exists()) {
          throw new Error("Data kendaraan tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        reset({
          id: id as string,
          plateNumber: data.plateNumber ?? "",
          vehicleType: data.vehicleType ?? "",
          branch: data.branch ?? BRANCHES[0],
          category: data.category ?? "Mobil",
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat data kendaraan.");
        }
      } finally {
        if (!cancelled) setIsLoadingVehicle(false);
      }
    }

    loadVehicle();
    return () => {
      cancelled = true;
    };
  }, [id, reset]);

  async function onSubmit(data: UpdateVehicleInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await updateVehicle(data, appUser);
      router.push("/admin/kendaraan");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah data kendaraan.");
    }
  }

  async function handleDelete() {
    if (!appUser || !id) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteVehicle(id, appUser);
      router.push("/admin/kendaraan");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus data kendaraan.");
      setIsDeleting(false);
    }
  }

  if (isLoadingVehicle) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>;
  }

  if (loadError) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-destructive">{loadError}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Edit Kendaraan" description="Perbarui data kendaraan." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plateNumber">Plat Nomor</Label>
              <Input
                id="plateNumber"
                className="font-mono"
                aria-invalid={!!errors.plateNumber}
                aria-describedby={errors.plateNumber ? "plateNumber-error" : undefined}
                {...register("plateNumber")}
              />
              {errors.plateNumber && (
                <p id="plateNumber-error" className="text-sm text-destructive">
                  {errors.plateNumber.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vehicleType">Jenis Kendaraan</Label>
              <Input
                id="vehicleType"
                aria-invalid={!!errors.vehicleType}
                aria-describedby={errors.vehicleType ? "vehicleType-error" : undefined}
                {...register("vehicleType")}
              />
              {errors.vehicleType && (
                <p id="vehicleType-error" className="text-sm text-destructive">
                  {errors.vehicleType.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="branch">Cabang</Label>
                <NativeSelect id="branch" {...register("branch")}>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category">Kategori</Label>
                <NativeSelect id="category" {...register("category")}>
                  {VEHICLE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </div>
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

          <div className="mt-2 border-t pt-4">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Yakin hapus data kendaraan ini?</span>
                <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Menghapus..." : "Ya, Hapus"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                >
                  Batal
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Hapus Kendaraan
              </Button>
            )}
            {deleteError && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EditVehiclePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>}>
      <EditVehicleContent />
    </Suspense>
  );
}
