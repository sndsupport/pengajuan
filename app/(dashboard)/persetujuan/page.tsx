"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { httpsCallable, getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
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

type QueueRow = { id: string; submissionNumber: string; type: string; branch: string };

export default function PersetujuanPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [noteBySubmission, setNoteBySubmission] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionErrorBySubmission, setActionErrorBySubmission] = useState<Record<string, string>>({});

  useEffect(() => {
    // Per the brief's role table, superadmin can read/monitor but not approve/reject —
    // matches reviewSubmissionHandler's own role check, so this page's action buttons
    // are only ever shown to roles that can actually use them.
    if (!loading && appUser && !["spv", "management"].includes(appUser.role)) {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "submissions"), where("status", "==", "diajukan"), orderBy("submittedAt", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            branch: d.data().branch,
          }))
        );
      },
      (err) => {
        setListError(err.code);
      }
    );
  }, []);

  async function handleDecision(submissionId: string, decision: "approve" | "reject") {
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      const reviewSubmission = httpsCallable(functions, "reviewSubmission");
      await reviewSubmission({ submissionId, decision, rejectionNote: noteBySubmission[submissionId] });
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [submissionId]: err instanceof Error ? err.message : "Gagal memproses review.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Antrian Persetujuan</h1>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <span>
                {row.submissionNumber} — {row.type} ({row.branch})
              </span>
              <StatusBadge status="diajukan" />
            </div>
            <Textarea
              placeholder="Catatan (wajib jika reject)"
              value={noteBySubmission[row.id] ?? ""}
              onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
            />
            {actionErrorBySubmission[row.id] && (
              <p className="text-sm text-red-600">{actionErrorBySubmission[row.id]}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === row.id} onClick={() => handleDecision(row.id, "approve")}>
                Setujui
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busyId === row.id}
                onClick={() => handleDecision(row.id, "reject")}
              >
                Tolak
              </Button>
            </div>
          </li>
        ))}
        {listError && (
          <li className="text-sm text-red-600">Gagal memuat antrian. Coba muat ulang halaman.</li>
        )}
        {!listError && rows.length === 0 && (
          <li className="text-sm text-muted-foreground">Tidak ada pengajuan menunggu review.</li>
        )}
      </ul>
    </main>
  );
}
