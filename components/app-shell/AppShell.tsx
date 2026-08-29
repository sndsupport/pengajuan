"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { AppUser } from "@/lib/hooks/useAuth";
import { loadGoogleIdentityServices } from "@/lib/drive-upload";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ appUser, children }: { appUser: AppUser; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const stored = window.localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    // Preload the Google Identity Services script ahead of time so that when
    // the user later clicks to upload a file, requestAccessToken() fires
    // synchronously within that click's user-activation window instead of
    // after an async script-load delay — Chrome silently blocks the OAuth
    // popup ("Failed to open popup window") once that window has expired.
    loadGoogleIdentityServices().catch(() => {});
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      window.localStorage.setItem("sidebar-collapsed", String(!prev));
      return !prev;
    });
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar
        appUser={appUser}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
