"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function handleCopyTemplate() {
    if (!submission || !appUser) return;
    const text = `Yth. Tim GA, mohon diproses pengajuan ${submission.submissionNumber} a.n. ${appUser.name} (${submission.department}). Detail & tanda tangan terlampir di PDF: ${submission.pdfUrl}. Terima kasih.`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  async function handleConfirmSentToGa() {
    if (!submission) return;
    setBusy(true);
    setActionError(null);
    try {
      const confirmSentToGa = httpsCallable(functions, "confirmSentToGa");
      await confirmSentToGa({ submissionId: submission.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengonfirmasi.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkAsDone() {
    if (!submission) return;
    setBusy(true);
    setActionError(null);
    try {
      const markAsDone = httpsCallable(functions, "markAsDone");
      await markAsDone({ submissionId: submission.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menandai selesai.");
    } finally {
      setBusy(false);
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

      {submission.status === "siap_dikirim" && appUser?.uid === submission.requesterId && (
        <div className="space-y-2 rounded border border-blue-300 bg-blue-50 p-3 text-sm">
          <p>PDF formulir sudah siap. Salin template pesan berikut, kirim manual ke GA lewat WhatsApp, lalu konfirmasi di sini.</p>
          <a href={submission.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
            Buka PDF
          </a>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopyTemplate}>
              {copied ? "Tersalin!" : "Copy Template WA"}
            </Button>
            <Button size="sm" disabled={busy} onClick={handleConfirmSentToGa}>
              Konfirmasi Sudah Dikirim
            </Button>
          </div>
        </div>
      )}

      {submission.status === "on_proses_ga" && appUser?.uid === submission.requesterId && (
        <div className="space-y-2 rounded border border-purple-300 bg-purple-50 p-3 text-sm">
          <p>Pengajuan sedang diproses GA. Setelah barang/layanan diterima, tandai selesai.</p>
          <Button size="sm" disabled={busy} onClick={handleMarkAsDone}>
            Tandai Selesai
          </Button>
        </div>
      )}

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <div>
        <h2 className="mb-2 font-medium">Riwayat Status</h2>
        <SubmissionTimeline entries={history} />
      </div>
    </main>
  );
}
