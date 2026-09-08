"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { createVehicleSchema, CreateVehicleInput, VEHICLE_CATEGORIES } from "@/lib/schemas/vehicle";
import { BRANCHES } from "@/lib/branches";
import { createVehicle } from "@/lib/vehicles/createVehicle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

export default function NewVehiclePage() {
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
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createVehicleSchema>, unknown, CreateVehicleInput>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: { plateNumber: "", vehicleType: "", branch: BRANCHES[0], category: "Mobil" },
  });

  async function onSubmit(data: CreateVehicleInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await createVehicle(data, appUser);
      router.push("/admin/kendaraan");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat data kendaraan.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Tambah Kendaraan" description="Tambahkan data kendaraan baru yang bisa dipilih admin saat membuat pengajuan kendaraan." />

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
              {isSubmitting ? "Menyimpan..." : "Tambah Kendaraan"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
