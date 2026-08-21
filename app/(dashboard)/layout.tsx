"use client";

import { useEffect } from "react";
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

  return <div className="min-h-screen">{children}</div>;
}
