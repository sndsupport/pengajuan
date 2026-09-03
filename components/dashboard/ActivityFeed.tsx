"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collectionGroup, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_STYLES } from "@/components/status-badge/StatusBadge";
import { ROLE_LABEL } from "@/components/app-shell/nav-config";
import { History } from "lucide-react";

type ActivityEntry = {
  id: string;
  submissionId: string;
  submissionNumber: string | null;
  employeeName: string | null;
  status: string;
  actorRole: string;
  timestamp: Date;
};

function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

export function ActivityFeed() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const q = query(collectionGroup(db, "statusHistory"), orderBy("timestamp", "desc"), limit(15));
    return onSnapshot(q, (snap) => {
      setEntries(
        snap.docs.map((d) => ({
          id: d.id,
          submissionId: d.ref.parent.parent!.id,
          submissionNumber: d.data().submissionNumber ?? null,
          employeeName: d.data().employeeName ?? null,
          status: d.data().status,
          actorRole: d.data().actorRole,
          timestamp: d.data().timestamp?.toDate() ?? new Date(),
        }))
      );
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aktivitas Terbaru</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => {
              const statusStyle = STATUS_STYLES[entry.status] ?? { label: entry.status, color: "#64748B" };
              return (
                <li key={entry.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${statusStyle.color}1F`, color: statusStyle.color }}
                  >
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/pengajuan/detail?id=${entry.submissionId}`}
                      className="truncate font-mono text-sm font-medium hover:underline"
                    >
                      {entry.submissionNumber ?? "Pengajuan"}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.employeeName ? `${entry.employeeName} — ` : ""}
                      <span style={{ color: statusStyle.color }}>{statusStyle.label}</span>
                      {" oleh "}
                      {ROLE_LABEL[entry.actorRole as keyof typeof ROLE_LABEL] ?? entry.actorRole}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(entry.timestamp, now)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
