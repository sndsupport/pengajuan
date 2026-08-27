"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { computeStageDurations, formatDuration, StatusHistoryEntry } from "@/lib/monitoring";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { TableCell, TableRow } from "@/components/ui/table";

const requesterNameCache = new Map<string, string>();

export type MonitoringSubmission = {
  id: string;
  submissionNumber: string;
  type: string;
  branch: string;
  status: string;
  requesterId: string;
};

export function MonitoringRow({ submission }: { submission: MonitoringSubmission }) {
  const [entries, setEntries] = useState<StatusHistoryEntry[]>([]);
  const [requesterName, setRequesterName] = useState<string>(submission.requesterId);

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

  useEffect(() => {
    const cached = requesterNameCache.get(submission.requesterId);
    if (cached) {
      setRequesterName(cached);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", submission.requesterId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const name = (snap.data().name as string) ?? submission.requesterId;
      requesterNameCache.set(submission.requesterId, name);
      setRequesterName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [submission.requesterId]);

  const durations = computeStageDurations(entries, new Date());

  return (
    <TableRow>
      <TableCell>
        <Link href={`/pengajuan/${submission.id}`} className="underline">
          {submission.submissionNumber}
        </Link>
      </TableCell>
      <TableCell>{requesterName}</TableCell>
      <TableCell>{submission.branch}</TableCell>
      <TableCell>{submission.type}</TableCell>
      <TableCell>
        <StatusBadge status={submission.status} />
      </TableCell>
      <TableCell>{formatDuration(durations.diajukanToDisetujui)}</TableCell>
      <TableCell>{formatDuration(durations.disetujuiToSiapDikirim)}</TableCell>
      <TableCell>{formatDuration(durations.siapDikirimToOnProsesGa)}</TableCell>
      <TableCell>{formatDuration(durations.onProsesGaToSelesai)}</TableCell>
      <TableCell>{formatDuration(durations.total)}</TableCell>
    </TableRow>
  );
}
