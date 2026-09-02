"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { Car, ChevronsLeft, ChevronsRight, LogOut, X } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/hooks/useAuth";
import { navItemsForRole, ROLE_LABEL } from "./nav-config";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Sidebar({
  appUser,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  appUser: AppUser;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navItemsForRole(appUser.role);
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => {
    if (!mobileOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseMobile();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] transition-all duration-200 ease-out md:sticky md:top-0 md:translate-x-0",
          collapsed ? "md:w-[76px]" : "md:w-64",
          "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-[var(--sidebar-border)] px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Car className="h-5 w-5" strokeWidth={2.25} />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-sm font-bold leading-tight">Pengajuan</p>
              <p className="truncate text-[11px] leading-tight text-[var(--sidebar-foreground)]/60">
                Kendaraan &amp; Perlengkapan
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] md:hidden"
            aria-label="Tutup menu"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)] shadow-sm"
                    : "text-[var(--sidebar-foreground)]/75 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]"
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onToggleCollapsed}
          className="mx-3 mb-2 hidden min-h-11 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-[var(--sidebar-foreground)]/60 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] md:flex"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : (
            <>
              <ChevronsLeft className="h-4 w-4" /> Ciutkan
            </>
          )}
        </button>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className={cn("flex items-center gap-2.5 rounded-lg p-2", collapsed && "justify-center")}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-semibold">
              {initialsFor(appUser.name)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">{appUser.name}</p>
                <p className="truncate text-[11px] leading-tight text-[var(--sidebar-foreground)]/60">
                  {ROLE_LABEL[appUser.role]}
                  {appUser.branch ? ` · ${appUser.branch}` : ""}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={handleLogout}
              title="Keluar"
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-foreground)]/60 hover:bg-[var(--sidebar-accent)] hover:text-red-300"
              aria-label="Keluar"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
