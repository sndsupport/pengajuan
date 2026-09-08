"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { AlertCircle, Car, Pencil, Plus } from "lucide-react";

type VehicleRow = { id: string; plateNumber: string; vehicleType: string; branch: string; category: string };

export default function AdminVehiclesPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "vehicles"), orderBy("plateNumber", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            plateNumber: d.data().plateNumber,
            vehicleType: d.data().vehicleType,
            branch: d.data().branch,
            category: d.data().category,
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
        title="Data Kendaraan"
        description="Kelola data kendaraan yang bisa dipilih admin saat membuat pengajuan kendaraan."
        actions={
          <Button asChild>
            <Link href="/admin/kendaraan/new">
              <Plus className="h-4 w-4" />
              Tambah Kendaraan
            </Link>
          </Button>
        }
      />

      {listError ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat daftar kendaraan"
          description="Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Car}
          title="Belum ada data kendaraan"
          description="Klik &quot;Tambah Kendaraan&quot; untuk menambahkan data baru."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Plat Nomor</TableHead>
                <TableHead>Jenis Kendaraan</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono font-medium">{row.plateNumber}</TableCell>
                  <TableCell>{row.vehicleType}</TableCell>
                  <TableCell>{row.branch}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/kendaraan/edit?id=${row.id}`}
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Edit ${row.plateNumber}`}
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
