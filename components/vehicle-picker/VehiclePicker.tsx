"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type Vehicle = { id: string; plateNumber: string; vehicleType: string; branch: string; category: string };

export function VehiclePicker({
  value,
  onSelect,
  branchFilter,
  id = "vehiclePicker",
  ariaInvalid,
  ariaDescribedBy,
}: {
  value: string | null | undefined;
  onSelect: (vehicle: Vehicle | null) => void;
  branchFilter: string | null;
  id?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllOverride, setShowAllOverride] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadVehicles() {
      try {
        const snap = await getDocs(query(collection(db, "vehicles"), orderBy("plateNumber", "asc")));
        if (cancelled) return;
        setVehicles(
          snap.docs.map((d) => ({
            id: d.id,
            plateNumber: d.data().plateNumber,
            vehicleType: d.data().vehicleType,
            branch: d.data().branch,
            category: d.data().category,
          }))
        );
      } catch {
        if (!cancelled) setError("Gagal memuat daftar kendaraan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setShowAllOverride(false);
  }, [branchFilter]);

  const filteredVehicles = branchFilter && !showAllOverride ? vehicles.filter((v) => v.branch === branchFilter) : vehicles;
  const selected = vehicles.find((v) => v.id === value) ?? null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const selectedId = event.target.value;
    onSelect(vehicles.find((v) => v.id === selectedId) ?? null);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Memuat daftar kendaraan...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!branchFilter) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>Kendaraan</Label>
        <NativeSelect id={id} value="" disabled>
          <option value="">Pilih pegawai terlebih dahulu</option>
        </NativeSelect>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Kendaraan</Label>
      <NativeSelect
        id={id}
        value={value ?? ""}
        onChange={handleChange}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      >
        <option value="" disabled>
          Pilih kendaraan
        </option>
        {filteredVehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.plateNumber} — {v.vehicleType}
          </option>
        ))}
      </NativeSelect>
      {filteredVehicles.length === 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Tidak ada kendaraan terdaftar di cabang ini ({branchFilter}).
          </p>
          <button
            type="button"
            className="text-xs font-medium text-primary underline underline-offset-2"
            onClick={() => setShowAllOverride(true)}
          >
            Tampilkan semua kendaraan
          </button>
        </div>
      )}
      {selected && (
        <p className="text-xs text-muted-foreground">
          {selected.branch} · {selected.category}
        </p>
      )}
    </div>
  );
}
