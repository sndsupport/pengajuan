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
      <main className="p-6 text-sm text-red-600">
        Pengajuan tidak ditemukan atau Anda tidak punya akses.
      </main>
    );
  }

  if (!submission) {
    return <main className="p-6 text-sm text-muted-foreground">Memuat...</main>;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{submission.submissionNumber}</h1>
        <StatusBadge status={submission.status} />
      </div>

      {submission.status === "perlu_revisi" && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Catatan revisi:</p>
          <p>{submission.rejectionNote}</p>
          <Link href={`/pengajuan/new?resubmit=${submission.id}`}>
            <Button className="mt-2" size="sm">
              Revisi & Ajukan Ulang
            </Button>
          </Link>
        </div>
      )}

      {submission.status === "disetujui" && !submission.pdfUrl && appUser && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-medium">PDF pengajuan belum berhasil dibuat.</p>
          {pdfError && <p className="text-sm text-red-600">{pdfError}</p>}
          <Button type="button" size="sm" disabled={generatingPdf} onClick={handleGeneratePdf}>
            {generatingPdf ? "Memproses..." : "Coba Generate PDF"}
          </Button>
        </div>
      )}

      {submission.status === "siap_dikirim" && appUser && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-medium">Kirim ke GA lewat WhatsApp</p>
          <a href={submission.pdfUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            Lihat PDF
          </a>
          <Textarea
            readOnly
            rows={8}
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
              Salin Template
            </Button>
            {copyFeedback && <span className="text-sm text-green-600">Disalin!</span>}
          </div>
          {copyError && <p className="text-sm text-red-600">{copyError}</p>}
          {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
          <Button type="button" size="sm" disabled={confirming} onClick={handleConfirm}>
            {confirming ? "Memproses..." : "Konfirmasi Sudah Dikirim ke GA"}
          </Button>
        </div>
      )}

      {submission.status === "on_proses_ga" && appUser && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-medium">Barang/layanan sudah diterima?</p>
          {markDoneError && <p className="text-sm text-red-600">{markDoneError}</p>}
          <Button type="button" size="sm" disabled={markingDone} onClick={handleMarkDone}>
            {markingDone ? "Memproses..." : "Tandai Selesai"}
          </Button>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-medium">Riwayat Status</h2>
        <SubmissionTimeline entries={history} />
      </div>
    </main>
  );
}

export default function PengajuanDetailPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-muted-foreground">Memuat...</main>}>
      <PengajuanDetailContent />
    </Suspense>
  );
}
