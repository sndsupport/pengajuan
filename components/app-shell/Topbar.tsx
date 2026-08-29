"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { pageTitleForPath } from "./nav-config";

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobile}
        className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Buka menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      <h1 className="truncate font-heading text-base font-semibold sm:text-lg">
        {pageTitleForPath(pathname)}
      </h1>
    </header>
  );
}
