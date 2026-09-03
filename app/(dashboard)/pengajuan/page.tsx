"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ChevronRight, FileStack, Plus } from "lucide-react";
import { TYPE_LABEL } from "@/lib/schemas/submission";

type SubmissionRow = {
  id: string;
  submissionNumber: string;
  type: string;
  status: string;
  employeeName: string;
  submittedAt: Date | null;
};

function formatSubmittedAt(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function PengajuanListPage() {
  const router = useRouter();
  const { appUser } = useAuth();
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser) return;
    const q = query(
      collection(db, "submissions"),
      where("requesterId", "==", appUser.uid),
      orderBy("submittedAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            status: d.data().status,
            employeeName: d.data().employeeName,
            submittedAt: d.data().submittedAt?.toDate() ?? null,
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
  }, [appUser]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Pengajuan Saya"
        description="Daftar seluruh pengajuan kendaraan & perlengkapan yang pernah Anda ajukan."
        actions={
          <Button asChild>
            <Link href="/pengajuan/new">
              <Plus className="h-4 w-4" />
              Buat Pengajuan
            </Link>
          </Button>
        }
      />

      {error ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat data"
          description="Terjadi kesalahan saat memuat daftar pengajuan. Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="Belum ada pengajuan"
          description="Klik &quot;Buat Pengajuan&quot; untuk mengajukan kendaraan atau perlengkapan baru."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No. Pengajuan</TableHead>
                <TableHead>Diajukan</TableHead>
                <TableHead>Untuk</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/pengajuan/detail?id=${row.id}`)}
                >
                  <TableCell className="p-0">
                    <Link
                      href={`/pengajuan/detail?id=${row.id}`}
                      className="flex items-center py-2.5 pl-2 font-mono text-sm font-medium"
                    >
                      {row.submissionNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{formatSubmittedAt(row.submittedAt)}</TableCell>
                  <TableCell>{row.employeeName || "-"}</TableCell>
                  <TableCell>{TYPE_LABEL[row.type] ?? row.type}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/pengajuan/detail?id=${row.id}`}>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
