"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
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
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manajemen User</h1>
        <Button asChild>
          <Link href="/admin/new">Buat User</Link>
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Cabang</TableHead>
            <TableHead>Departemen</TableHead>
            <TableHead>Posisi</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.username}</TableCell>
              <TableCell>{row.role}</TableCell>
              <TableCell>{row.branch ?? "-"}</TableCell>
              <TableCell>{row.department}</TableCell>
              <TableCell>{row.position}</TableCell>
              <TableCell>
                <Link href={`/admin/${row.id}`} className="text-sm underline">
                  Edit
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {listError && <p className="text-sm text-red-600">Gagal memuat daftar user.</p>}
      {!listError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada user.</p>
      )}
    </main>
  );
}
