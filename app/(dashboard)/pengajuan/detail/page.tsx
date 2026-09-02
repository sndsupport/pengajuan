"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { buildWaTemplate, buildPersonaliaWaTemplate } from "@/lib/wa-template";
import { TYPE_LABEL, PERSONALIA_SUBTYPE_LABEL } from "@/lib/schemas/submission";
import { confirmSentToGa } from "@/lib/submissions/confirmSentToGa";
import { markAsDone } from "@/lib/submissions/markAsDone";
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
import { StatusBadge, STATUS_STYLES } from "@/components/status-badge/StatusBadge";
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
  const [hcCopyFeedback, setHcCopyFeedback] = useState(false);
  const [hcCopyError, setHcCopyError] = useState<string | null>(null);
  const [personaliaAttachmentUrl, setPersonaliaAttachmentUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!id || !submission || submission.type !== "personalia") return;
    const unsub = onSnapshot(collection(db, "submissions", id, "attachments"), (snap) => {
      setPersonaliaAttachmentUrl(snap.docs[0]?.data().fileUrl ?? null);
    });
    return unsub;
  }, [id, submission?.type]);

  async function handleCopy() {
    if (!submission || !appUser) return;
    setCopyError(null);
    const text = buildWaTemplate(
      {
        submissionNumber: submission.submissionNumber,
        type: submission.type,
        subType: submission.subType,
        branch: submission.branch,
        employeeName: submission.employeeName,
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

  async function handleCopyToHc() {
    if (!submission || !appUser || !personaliaAttachmentUrl) return;
    setHcCopyError(null);
    const text = buildPersonaliaWaTemplate(
      {
        submissionNumber: submission.submissionNumber,
        subType: submission.subType,
        employeeName: submission.employeeName,
        branch: submission.branch,
        periodStart: submission.periodStart,
        periodEnd: submission.periodEnd,
        attachmentUrl: personaliaAttachmentUrl,
      },
      appUser.name
    );
    try {
      await navigator.clipboard.writeText(text);
      setHcCopyFeedback(true);
      setTimeout(() => setHcCopyFeedback(false), 2000);
    } catch {
      setHcCopyError("Gagal menyalin. Coba salin manual.");
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
        <div>
          <h2 className="font-mono text-xl font-bold tracking-tight">{submission.submissionNumber}</h2>
          <p className="text-sm text-muted-foreground">{TYPE_LABEL[submission.type] ?? submission.type}</p>
        </div>
        <StatusBadge status={submission.status} />
      </div>

      {submission.status === "perlu_revisi" && (
        <Card
          style={{
            borderColor: `${STATUS_STYLES.perlu_revisi.color}66`,
            backgroundColor: `${STATUS_STYLES.perlu_revisi.color}0D`,
          }}
        >
          <CardContent className="space-y-2 pt-6">
            <p
              className="flex items-center gap-2 font-medium"
              style={{ color: STATUS_STYLES.perlu_revisi.color }}
            >
              <FileWarning className="h-4 w-4" />
              Catatan revisi
            </p>
            <p className="text-sm text-foreground">{submission.rejectionNote}</p>
            <Link href={`/pengajuan/new?resubmit=${submission.id}`}>
              <Button className="mt-1" size="sm">
                Revisi &amp; Ajukan Ulang
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {submission.type !== "personalia" && (
        <>
          {submission.status === "disetujui" && !submission.pdfUrl && appUser && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">PDF pengajuan belum berhasil dibuat</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pdfError && (
                  <p role="alert" className="text-sm text-destructive">
                    {pdfError}
                  </p>
                )}
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
                      employeeName: submission.employeeName,
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
                  <span role="status" aria-live="polite">
                    {copyFeedback && (
                      <span
                        className="flex items-center gap-1 text-sm font-medium"
                        style={{ color: STATUS_STYLES.selesai.color }}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Disalin!
                      </span>
                    )}
                  </span>
                </div>
                {copyError && (
                  <p role="alert" className="text-sm text-destructive">
                    {copyError}
                  </p>
                )}
                {confirmError && (
                  <p role="alert" className="text-sm text-destructive">
                    {confirmError}
                  </p>
                )}
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
                {markDoneError && (
                  <p role="alert" className="text-sm text-destructive">
                    {markDoneError}
                  </p>
                )}
                <Button type="button" size="sm" disabled={markingDone} onClick={handleMarkDone}>
                  {markingDone ? "Memproses..." : "Tandai Selesai"}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {submission.type === "personalia" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Detail {PERSONALIA_SUBTYPE_LABEL[submission.subType as "lembur" | "cuti" | "izin"] ?? submission.subType}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Nama Karyawan</p>
                <p className="font-medium">{submission.employeeName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Periode</p>
                <p className="font-mono">
                  {submission.periodStart} s/d {submission.periodEnd}
                </p>
              </div>
            </div>
            {personaliaAttachmentUrl && (
              <a
                href={personaliaAttachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                Lihat Dokumen PDF
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {submission.status === "diajukan" && (
              <p className="text-muted-foreground">
                {submission.spvApproval &&
                  !submission.managerApproval &&
                  "Sudah disetujui AWS Supervisor, menunggu Operational Manager."}
                {submission.managerApproval &&
                  !submission.spvApproval &&
                  "Sudah disetujui Operational Manager, menunggu AWS Supervisor."}
                {!submission.spvApproval &&
                  !submission.managerApproval &&
                  "Menunggu approval AWS Supervisor dan Operational Manager."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {submission.type === "personalia" && submission.status === "selesai" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kirim ke HC lewat WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyToHc}
                disabled={!personaliaAttachmentUrl}
              >
                <Copy className="h-4 w-4" />
                Salin Template WA ke HC
              </Button>
              <span role="status" aria-live="polite">
                {hcCopyFeedback && (
                  <span
                    className="flex items-center gap-1 text-sm font-medium"
                    style={{ color: STATUS_STYLES.selesai.color }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Disalin!
                  </span>
                )}
              </span>
            </div>
            {hcCopyError && (
              <p role="alert" className="text-sm text-destructive">
                {hcCopyError}
              </p>
            )}
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
