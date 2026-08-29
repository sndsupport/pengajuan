"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { AppShell } from "@/components/app-shell/AppShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !appUser) {
      router.replace("/login");
    }
  }, [loading, appUser, router]);

  if (loading || !appUser) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Memuat...
      </div>
    );
  }

  return <AppShell appUser={appUser}>{children}</AppShell>;
}
