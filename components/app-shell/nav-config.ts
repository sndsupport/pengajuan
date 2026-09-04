import type { LucideIcon } from "lucide-react";
import { ClipboardCheck, Contact, DatabaseBackup, FileStack, LayoutDashboard, Users } from "lucide-react";
import type { AppUser } from "@/lib/hooks/useAuth";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: AppUser["role"][];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/pengajuan",
    label: "Pengajuan Saya",
    icon: FileStack,
    roles: ["admin", "spv"],
  },
  {
    href: "/persetujuan",
    label: "Antrian Persetujuan",
    icon: ClipboardCheck,
    roles: ["spv", "management"],
  },
  {
    href: "/monitoring",
    label: "Monitoring",
    icon: LayoutDashboard,
    roles: ["admin", "spv", "management", "superadmin"],
  },
  {
    href: "/admin",
    label: "Manajemen User",
    icon: Users,
    roles: ["superadmin"],
  },
  {
    href: "/admin/pegawai",
    label: "Data Pegawai",
    icon: Contact,
    roles: ["superadmin"],
  },
  {
    href: "/admin/data",
    label: "Manajemen Data",
    icon: DatabaseBackup,
    roles: ["superadmin"],
  },
];

export const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin: "Admin",
  spv: "AWS Supervisor",
  management: "Operational Manager",
  superadmin: "Superadmin",
};

export function navItemsForRole(role: AppUser["role"]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function pageTitleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  ).sort((a, b) => b.href.length - a.href.length)[0];
  if (match) return match.label;
  if (pathname.startsWith("/admin/new")) return "Buat User";
  if (pathname.startsWith("/admin/edit")) return "Edit User";
  if (pathname.startsWith("/pengajuan/new")) return "Buat Pengajuan";
  if (pathname.startsWith("/pengajuan/detail")) return "Detail Pengajuan";
  return "Dashboard";
}
