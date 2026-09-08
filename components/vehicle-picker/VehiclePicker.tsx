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
}: {
  value: string | null | undefined;
  onSelect: (vehicle: Vehicle | null) => void;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const selected = vehicles.find((v) => v.id === value) ?? null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    onSelect(vehicles.find((v) => v.id === id) ?? null);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Memuat daftar kendaraan...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="vehiclePicker">Kendaraan</Label>
      <NativeSelect id="vehiclePicker" value={value ?? ""} onChange={handleChange}>
        <option value="" disabled>
          Pilih kendaraan
        </option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.plateNumber} — {v.vehicleType}
          </option>
        ))}
      </NativeSelect>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {selected.branch} · {selected.category}
        </p>
      )}
    </div>
  );
}
