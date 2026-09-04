"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { exportSubmissionsToExcel } from "@/lib/export/exportSubmissionsExcel";
import { resetAllSubmissions, countSubmissions, ResetProgress } from "@/lib/admin/resetAllSubmissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle, CheckCircle2, Download, TriangleAlert } from "lucide-react";

const CONFIRM_PHRASE = "RESET SEMUA DATA";

export default function DataManagementPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [submissionCount, setSubmissionCount] = useState<number | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetProgress, setResetProgress] = useState<ResetProgress | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    if (!appUser || appUser.role !== "superadmin") return;
    countSubmissions()
      .then(setSubmissionCount)
      .catch(() => setSubmissionCount(null));
  }, [appUser]);

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      await exportSubmissionsToExcel();
      setHasExported(true);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Gagal export data.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleReset() {
    if (!appUser || confirmText !== CONFIRM_PHRASE) return;
    setIsResetting(true);
    setResetError(null);
    try {
      const result = await resetAllSubmissions(appUser, setResetProgress);
      setResetProgress(result);
      setResetDone(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Gagal mereset data.");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Manajemen Data"
        description="Export seluruh data pengajuan ke Excel, atau reset seluruh data pengajuan (untuk kebutuhan demo/testing)."
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-semibold">1. Export Excel</h2>
          <p className="text-sm text-muted-foreground">
            Mengunduh seluruh data pengajuan (submissions, item, riwayat status) sebagai file Excel.
            {submissionCount !== null && ` Saat ini ada ${submissionCount} pengajuan.`}
          </p>
          <Button onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4" />
            {isExporting ? "Mengekspor..." : "Export Excel"}
          </Button>
          {hasExported && (
            <div role="status" className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Export berhasil.</span>
            </div>
          )}
          {exportError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{exportError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-semibold text-destructive">2. Reset Semua Data</h2>
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Aksi ini akan menghapus SEMUA pengajuan (beserta item, lampiran, dan riwayat status) secara permanen dan
              tidak bisa dibatalkan. Data pegawai dan akun user tidak terpengaruh. Wajib export Excel dulu sebelum
              lanjut.
            </span>
          </div>

          {!hasExported ? (
            <p className="text-sm text-muted-foreground">Export Excel dulu di atas untuk mengaktifkan langkah ini.</p>
          ) : resetDone ? (
            <div role="status" className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Reset selesai. {resetProgress?.total ?? 0} dokumen berhasil dihapus.</span>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-phrase">
                  Ketik <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> untuk konfirmasi
                </Label>
                <Input
                  id="confirm-phrase"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                variant="destructive"
                onClick={handleReset}
                disabled={confirmText !== CONFIRM_PHRASE || isResetting}
              >
                {isResetting
                  ? `Menghapus... (${resetProgress?.done ?? 0}/${resetProgress?.total ?? 0})`
                  : "Reset Sekarang"}
              </Button>
              {resetError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {resetError} {resetProgress && `(berhasil menghapus ${resetProgress.done} dari ${resetProgress.total} dokumen sejauh ini — aman untuk klik "Reset Sekarang" lagi.)`}
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
