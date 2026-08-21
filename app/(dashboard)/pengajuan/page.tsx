"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { Button } from "@/components/ui/button";

type SubmissionRow = { id: string; submissionNumber: string; type: string; status: string };

export default function PengajuanListPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<SubmissionRow[]>([]);

  useEffect(() => {
    if (!appUser) return;
    const q = query(
      collection(db, "submissions"),
      where("requesterId", "==", appUser.uid),
      orderBy("submittedAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setRows(
        snap.docs.map((d) => ({
          id: d.id,
          submissionNumber: d.data().submissionNumber,
          type: d.data().type,
          status: d.data().status,
        }))
      );
    });
  }, [appUser]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pengajuan Saya</h1>
        <Link href="/pengajuan/new">
          <Button>Buat Pengajuan</Button>
        </Link>
      </div>
      <ul className="divide-y rounded border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between p-3">
            <Link href={`/pengajuan/${row.id}`} className="hover:underline">
              {row.submissionNumber} — {row.type}
            </Link>
            <StatusBadge status={row.status} />
          </li>
        ))}
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">Belum ada pengajuan.</li>}
      </ul>
    </main>
  );
}
