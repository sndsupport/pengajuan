"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { exportSubmissionsToExcel } from "@/lib/export/exportSubmissionsExcel";
import { MonitoringRow, MonitoringSubmission } from "@/components/monitoring-row/MonitoringRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { AlertCircle, Download, LayoutDashboard } from "lucide-react";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { BreakdownDonut } from "@/components/dashboard/BreakdownDonut";
import { BranchChart } from "@/components/dashboard/BranchChart";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { computeKpis, computeDailyTrend, computeStatusBreakdown, computeTypeBreakdown, computeBranchBreakdown } from "@/lib/dashboard-stats";
import { STATUS_STYLES } from "@/components/status-badge/StatusBadge";
import { TYPE_LABEL } from "@/lib/schemas/submission";

const TYPE_COLORS: Record<string, string> = {
  kendaraan: "#2a78d6",
  perlengkapan: "#eb6834",
  gedung_fasilitas: "#1baf7a",
  personalia: "#eda100",
};

export default function MonitoringPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<MonitoringSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      await exportSubmissionsToExcel();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Gagal export data.");
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    if (!appUser) return;

    const q = query(collection(db, "submissions"), orderBy("submittedAt", "desc"));

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
            submittedAt: d.data().submittedAt?.toDate() ?? null,
            completedAt: d.data().completedAt?.toDate() ?? null,
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
  }, [appUser]);

  // Deliberately not memoized: freezing "now" at mount would make month-boundary
  // filtering (computeKpis/computeDailyTrend/etc.) go stale if this dashboard is
  // left open across midnight while new submissions stream in via onSnapshot.
  const now = new Date();
  const kpis = useMemo(() => computeKpis(rows, now), [rows, now]);
  const trend = useMemo(() => computeDailyTrend(rows, now), [rows, now]);
  const statusBreakdown = useMemo(() => computeStatusBreakdown(rows, now), [rows, now]);
  const typeBreakdown = useMemo(() => computeTypeBreakdown(rows, now), [rows, now]);
  const branchBreakdown = useMemo(() => computeBranchBreakdown(rows, now), [rows, now]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Dashboard Monitoring"
        description="Pantau seluruh pengajuan beserta durasi tiap tahap prosesnya secara realtime."
        actions={
          <Button variant="outline" onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4" />
            {isExporting ? "Mengekspor..." : "Export Excel"}
          </Button>
        }
      />

      {exportError && (
        <EmptyState icon={AlertCircle} variant="error" title="Gagal export data" description={exportError} />
      )}

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
        <>
          <KpiCards kpis={kpis} />

          <TrendChart data={trend} />

          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownDonut
              title="Breakdown Status Bulan Ini"
              slices={statusBreakdown}
              labelFor={(key) => STATUS_STYLES[key]?.label ?? key}
              colorFor={(key) => STATUS_STYLES[key]?.color ?? "#64748B"}
            />
            <BreakdownDonut
              title="Breakdown Jenis Bulan Ini"
              slices={typeBreakdown}
              labelFor={(key) => TYPE_LABEL[key] ?? key}
              colorFor={(key) => TYPE_COLORS[key] ?? "#2a78d6"}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <BranchChart slices={branchBreakdown} />
            <ActivityFeed />
          </div>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>No. Pengajuan</TableHead>
                  <TableHead>Diajukan</TableHead>
                  <TableHead>Untuk</TableHead>
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
        </>
      )}
    </div>
  );
}
