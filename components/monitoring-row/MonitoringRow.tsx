"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { computeStageDurations, formatDuration, StatusHistoryEntry } from "@/lib/monitoring";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { TableCell, TableRow } from "@/components/ui/table";
import { TYPE_LABEL } from "@/lib/schemas/submission";

export type MonitoringSubmission = {
  id: string;
  submissionNumber: string;
  type: string;
  branch: string;
  status: string;
  employeeName: string;
  submittedAt: Date | null;
};

function formatSubmittedAt(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function MonitoringRow({ submission }: { submission: MonitoringSubmission }) {
  const [entries, setEntries] = useState<StatusHistoryEntry[]>([]);

  useEffect(() => {
    const q = query(collection(db, "submissions", submission.id, "statusHistory"), orderBy("timestamp", "asc"));
    return onSnapshot(q, (snap) => {
      setEntries(
        snap.docs.map((d) => ({
          status: d.data().status as string,
          timestamp: d.data().timestamp?.toDate() ?? new Date(),
        }))
      );
    });
  }, [submission.id]);

  const durations = computeStageDurations(entries, new Date());

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/pengajuan/detail?id=${submission.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {submission.submissionNumber}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-sm">{formatSubmittedAt(submission.submittedAt)}</TableCell>
      <TableCell>{submission.employeeName || "-"}</TableCell>
      <TableCell>{submission.branch}</TableCell>
      <TableCell>{TYPE_LABEL[submission.type] ?? submission.type}</TableCell>
      <TableCell>
        <StatusBadge status={submission.status} />
      </TableCell>
      <TableCell className="font-tabular font-mono text-sm">{formatDuration(durations.diajukanToDisetujui)}</TableCell>
      <TableCell className="font-tabular font-mono text-sm">{formatDuration(durations.disetujuiToSiapDikirim)}</TableCell>
      <TableCell className="font-tabular font-mono text-sm">{formatDuration(durations.siapDikirimToOnProsesGa)}</TableCell>
      <TableCell className="font-tabular font-mono text-sm">{formatDuration(durations.onProsesGaToSelesai)}</TableCell>
      <TableCell className="font-tabular font-mono text-sm font-semibold">{formatDuration(durations.total)}</TableCell>
    </TableRow>
  );
}
