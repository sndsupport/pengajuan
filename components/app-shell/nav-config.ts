import type { LucideIcon } from "lucide-react";
import { ClipboardCheck, FileStack, LayoutDashboard, Users } from "lucide-react";
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
    roles: ["admin_cabang", "snd"],
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
    roles: ["admin_cabang", "snd", "spv", "management", "superadmin"],
  },
  {
    href: "/admin",
    label: "Manajemen User",
    icon: Users,
    roles: ["superadmin"],
  },
];

export const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin_cabang: "Admin Cabang",
  snd: "SND",
  spv: "AWS Supervisor",
  management: "Management",
  superadmin: "Superadmin",
};

export function navItemsForRole(role: AppUser["role"]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function pageTitleForPath(pathname: string): string {
  const match = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  if (match) return match.label;
  if (pathname.startsWith("/admin/new")) return "Buat User";
  if (pathname.startsWith("/admin/edit")) return "Edit User";
  if (pathname.startsWith("/pengajuan/new")) return "Buat Pengajuan";
  if (pathname.startsWith("/pengajuan/detail")) return "Detail Pengajuan";
  return "Dashboard";
}
