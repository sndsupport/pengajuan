"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !appUser) {
      router.replace("/login");
    }
  }, [loading, appUser, router]);

  if (loading || !appUser) {
    return <div className="p-8 text-sm text-muted-foreground">Memuat...</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-3xl items-center gap-6 p-4">
          <span className="text-sm font-semibold">Pengajuan Kendaraan &amp; Perlengkapan</span>
          <div className="flex gap-4 text-sm">
            <Link href="/pengajuan" className="hover:underline">
              Pengajuan Saya
            </Link>
            <Link href="/monitoring" className="hover:underline">
              Monitoring
            </Link>
            {(appUser.role === "spv" || appUser.role === "management") && (
              <Link href="/persetujuan" className="hover:underline">
                Antrian Persetujuan
              </Link>
            )}
            {appUser.role === "superadmin" && (
              <Link href="/admin" className="hover:underline">
                Manajemen User
              </Link>
            )}
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
