"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { buildWaTemplate } from "@/lib/wa-template";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (error) {
    // connectFunctionsEmulator throws if called again on an already-configured
    // instance (e.g. Next.js Fast Refresh re-evaluating this module).
    console.warn("[functions] Emulator connection skipped (already configured):", error);
  }
}

type SubmissionDoc = DocumentData & { id: string };

export default function PengajuanDetailPage({ params }: { params: { id: string } }) {
  const { appUser } = useAuth();
  const [submission, setSubmission] = useState<SubmissionDoc | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    const unsubSub = onSnapshot(
      doc(db, "submissions", params.id),
      (snap) => {
        setSubmission(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      (err) => {
        setError(err.code);
      }
    );
    const historyQuery = query(collection(db, "submissions", params.id, "statusHistory"), orderBy("timestamp", "asc"));
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
  }, [params.id]);

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
    if (!submission) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      const confirmSentToGa = httpsCallable(functions, "confirmSentToGa");
      await confirmSentToGa({ submissionId: submission.id });
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal konfirmasi.");
    } finally {
      setConfirming(false);
    }
  }

  if (error) {
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

      <div>
        <h2 className="mb-2 font-medium">Riwayat Status</h2>
        <SubmissionTimeline entries={history} />
      </div>
    </main>
  );
}
