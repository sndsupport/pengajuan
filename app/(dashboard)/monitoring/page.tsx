"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { MonitoringRow, MonitoringSubmission } from "@/components/monitoring-row/MonitoringRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { AlertCircle, LayoutDashboard } from "lucide-react";

export default function MonitoringPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<MonitoringSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser) return;

    const isRequesterRole = appUser.role === "admin";
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
            employeeName: d.data().employeeName,
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
  }, [appUser]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Dashboard Monitoring"
        description="Pantau seluruh pengajuan beserta durasi tiap tahap prosesnya secara realtime."
      />

      {error ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat data"
          description="Terjadi kesalahan saat memuat data monitoring. Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title="Belum ada pengajuan untuk dipantau." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No. Pengajuan</TableHead>
                <TableHead>Pengaju</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="font-mono">Diajukan→Disetujui</TableHead>
                <TableHead className="font-mono">Disetujui→Kirim</TableHead>
                <TableHead className="font-mono">Kirim→GA</TableHead>
                <TableHead className="font-mono">GA→Selesai</TableHead>
                <TableHead className="font-mono">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <MonitoringRow key={row.id} submission={row} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
