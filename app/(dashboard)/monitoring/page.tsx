"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { MonitoringRow, MonitoringSubmission } from "@/components/monitoring-row/MonitoringRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function MonitoringPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<MonitoringSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser) return;

    const isRequesterRole = appUser.role === "admin_cabang" || appUser.role === "snd";
    const q = isRequesterRole
      ? query(collection(db, "submissions"), where("requesterId", "==", appUser.uid), orderBy("submittedAt", "desc"))
      : query(collection(db, "submissions"), orderBy("submittedAt", "desc"));

    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            branch: d.data().branch,
            status: d.data().status,
            requesterId: d.data().requesterId,
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
  }, [appUser]);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Dashboard Monitoring</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. Pengajuan</TableHead>
            <TableHead>Pengaju</TableHead>
            <TableHead>Cabang</TableHead>
            <TableHead>Jenis</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Diajukan→Disetujui</TableHead>
            <TableHead>Disetujui→Kirim</TableHead>
            <TableHead>Kirim→GA</TableHead>
            <TableHead>GA→Selesai</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <MonitoringRow key={row.id} submission={row} />
          ))}
        </TableBody>
      </Table>
      {error && <p className="text-sm text-red-600">Gagal memuat data. Coba muat ulang halaman.</p>}
      {!error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>
      )}
    </main>
  );
}
