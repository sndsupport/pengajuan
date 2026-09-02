"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type Employee = { id: string; name: string; branch: string; department: string; position: string };

export function EmployeePicker({
  value,
  onSelect,
}: {
  value: string | null | undefined;
  onSelect: (employee: Employee | null) => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployees() {
      try {
        const snap = await getDocs(query(collection(db, "employees"), orderBy("name", "asc")));
        if (cancelled) return;
        setEmployees(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            branch: d.data().branch,
            department: d.data().department,
            position: d.data().position,
          }))
        );
      } catch {
        if (!cancelled) setError("Gagal memuat daftar pegawai.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadEmployees();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = employees.find((e) => e.id === value) ?? null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    onSelect(employees.find((e) => e.id === id) ?? null);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Memuat daftar pegawai...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="employeeId">Pegawai</Label>
      <NativeSelect id="employeeId" value={value ?? ""} onChange={handleChange}>
        <option value="" disabled>
          Pilih pegawai
        </option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} — {e.branch}
          </option>
        ))}
      </NativeSelect>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {selected.branch} · {selected.department} · {selected.position}
        </p>
      )}
    </div>
  );
}
