"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { ROLE_LABEL } from "@/components/app-shell/nav-config";
import type { AppUser } from "@/lib/hooks/useAuth";
import { AlertCircle, Pencil, Plus, Users } from "lucide-react";

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: AppUser["role"];
  branch: string | null;
  department: string;
  position: string;
};

export default function AdminUsersPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            username: d.data().username,
            role: d.data().role,
            branch: d.data().branch ?? null,
            department: d.data().department,
            position: d.data().position,
          }))
        );
      },
      (err) => {
        setListError(err.code);
      }
    );
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Manajemen User"
        description="Kelola akun pengguna aplikasi: admin cabang, SND, supervisor, Operational Manager, dan superadmin."
        actions={
          <Button asChild>
            <Link href="/admin/new">
              <Plus className="h-4 w-4" />
              Buat User
            </Link>
          </Button>
        }
      />

      {listError ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat daftar user"
          description="Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="Belum ada user" description="Klik &quot;Buat User&quot; untuk menambahkan akun baru." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nama</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead>Posisi</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{row.username}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-medium">
                      {ROLE_LABEL[row.role] ?? row.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.branch ?? "-"}</TableCell>
                  <TableCell>{row.department}</TableCell>
                  <TableCell>{row.position}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/edit?uid=${row.id}`}
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Edit ${row.name}`}
                    >
                      <Pencil className="h-4 w-4" />
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
