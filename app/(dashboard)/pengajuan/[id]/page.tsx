"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";

type SubmissionDoc = DocumentData & { id: string };

export default function PengajuanDetailPage({ params }: { params: { id: string } }) {
  const [submission, setSubmission] = useState<SubmissionDoc | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);

  useEffect(() => {
    const unsubSub = onSnapshot(doc(db, "submissions", params.id), (snap) => {
      setSubmission(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    const historyQuery = query(collection(db, "submissions", params.id, "statusHistory"), orderBy("timestamp", "asc"));
    const unsubHistory = onSnapshot(historyQuery, (snap) => {
      setHistory(
        snap.docs.map((d) => ({
          id: d.id,
          status: d.data().status,
          note: d.data().note,
          actorRole: d.data().actorRole,
          timestamp: d.data().timestamp?.toDate() ?? new Date(),
        }))
      );
    });
    return () => {
      unsubSub();
      unsubHistory();
    };
  }, [params.id]);

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

      <div>
        <h2 className="mb-2 font-medium">Riwayat Status</h2>
        <SubmissionTimeline entries={history} />
      </div>
    </main>
  );
}
