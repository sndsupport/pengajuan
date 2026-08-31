import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  variant = "default",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  variant?: "default" | "error";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center",
        variant === "error" && "border-destructive/30 bg-destructive/5",
        className
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full",
          variant === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className={cn("text-sm font-medium", variant === "error" && "text-destructive")}>{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
