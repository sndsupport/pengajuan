"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { buildWaTemplate } from "@/lib/wa-template";
import { confirmSentToGa } from "@/lib/submissions/confirmSentToGa";
import { markAsDone } from "@/lib/submissions/markAsDone";
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { CheckCircle2, Copy, ExternalLink, FileWarning, ShieldAlert } from "lucide-react";

type SubmissionDoc = DocumentData & { id: string };

function PengajuanDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { appUser } = useAuth();
  const [submission, setSubmission] = useState<SubmissionDoc | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState(false);
  const [markDoneError, setMarkDoneError] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsubSub = onSnapshot(
      doc(db, "submissions", id),
      (snap) => {
        setSubmission(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      (err) => {
        setError(err.code);
      }
    );
    const historyQuery = query(collection(db, "submissions", id, "statusHistory"), orderBy("timestamp", "asc"));
    const unsubHistory = onSnapshot(
      historyQuery,
      (snap) => {
        setHistory(
          snap.docs.map((d) => ({
            id: d.id,
            status: d.data().status,
            note: d.data().note,
            actorRole: d.data().actorRole,
            timestamp: d.data().timestamp?.toDate() ?? new Date(),
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
    return () => {
      unsubSub();
      unsubHistory();
    };
  }, [id]);

  async function handleCopy() {
    if (!submission || !appUser) return;
    setCopyError(null);
    const text = buildWaTemplate(
      {
        submissionNumber: submission.submissionNumber,
        type: submission.type,
        subType: submission.subType,
        branch: submission.branch,
        pdfUrl: submission.pdfUrl,
      },
      appUser.name
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      setCopyError("Gagal menyalin. Coba salin manual.");
    }
  }

  async function handleConfirm() {
    if (!submission || !appUser) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      await confirmSentToGa({ submissionId: submission.id }, appUser);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal konfirmasi.");
    } finally {
      setConfirming(false);
    }
  }

  async function handleMarkDone() {
    if (!submission || !appUser) return;
    setMarkDoneError(null);
    setMarkingDone(true);
    try {
      await markAsDone({ submissionId: submission.id }, appUser);
    } catch (err) {
      setMarkDoneError(err instanceof Error ? err.message : "Gagal menandai selesai.");
    } finally {
      setMarkingDone(false);
    }
  }

  async function handleGeneratePdf() {
    if (!submission || !appUser) return;
    setPdfError(null);
    setGeneratingPdf(true);
    try {
      await generateAndAttachSubmissionPdf(submission.id, appUser);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Gagal generate PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (!id || error) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <EmptyState
          icon={ShieldAlert}
          variant="error"
          title="Pengajuan tidak ditemukan"
          description="Pengajuan tidak ditemukan atau Anda tidak punya akses untuk melihatnya."
        />
      </div>
    );
  }

  if (!submission) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xl font-bold tracking-tight">{submission.submissionNumber}</h2>
        <StatusBadge status={submission.status} />
      </div>

      {submission.status === "perlu_revisi" && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="space-y-2 pt-6">
            <p className="flex items-center gap-2 font-medium text-amber-900">
              <FileWarning className="h-4 w-4" />
              Catatan revisi
            </p>
            <p className="text-sm text-amber-900/90">{submission.rejectionNote}</p>
            <Link href={`/pengajuan/new?resubmit=${submission.id}`}>
              <Button className="mt-1" size="sm">
                Revisi &amp; Ajukan Ulang
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {submission.status === "disetujui" && !submission.pdfUrl && appUser && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PDF pengajuan belum berhasil dibuat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}
            <Button type="button" size="sm" disabled={generatingPdf} onClick={handleGeneratePdf}>
              {generatingPdf ? "Memproses..." : "Coba Generate PDF"}
            </Button>
          </CardContent>
        </Card>
      )}

      {submission.status === "siap_dikirim" && appUser && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kirim ke GA lewat WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <a
              href={submission.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Lihat PDF
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Textarea
              readOnly
              rows={8}
              className="font-mono text-xs"
              value={buildWaTemplate(
                {
                  submissionNumber: submission.submissionNumber,
                  type: submission.type,
                  subType: submission.subType,
                  branch: submission.branch,
                  pdfUrl: submission.pdfUrl,
                },
                appUser.name
              )}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
                Salin Template
              </Button>
              {copyFeedback && (
                <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Disalin!
                </span>
              )}
            </div>
            {copyError && <p className="text-sm text-destructive">{copyError}</p>}
            {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
            <Button type="button" size="sm" disabled={confirming} onClick={handleConfirm}>
              {confirming ? "Memproses..." : "Konfirmasi Sudah Dikirim ke GA"}
            </Button>
          </CardContent>
        </Card>
      )}

      {submission.status === "on_proses_ga" && appUser && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Barang/layanan sudah diterima?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {markDoneError && <p className="text-sm text-destructive">{markDoneError}</p>}
            <Button type="button" size="sm" disabled={markingDone} onClick={handleMarkDone}>
              {markingDone ? "Memproses..." : "Tandai Selesai"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Status</CardTitle>
        </CardHeader>
        <CardContent>
          <SubmissionTimeline entries={history} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function PengajuanDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat...</div>}>
      <PengajuanDetailContent />
    </Suspense>
  );
}
