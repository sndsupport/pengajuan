import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { History } from "lucide-react";

export type StatusHistoryEntry = {
  id: string;
  status: string;
  note: string | null;
  actorRole: string;
  timestamp: Date;
};

export function SubmissionTimeline({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState icon={History} title="Belum ada riwayat status." />;
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
          {index !== entries.length - 1 && (
            <span className="absolute left-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />
          )}
          <span className="relative z-10 mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-background bg-primary shadow-sm" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={entry.status} />
              <span className="text-xs font-medium text-muted-foreground">{entry.actorRole}</span>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {entry.timestamp.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            {entry.note && <p className="text-sm text-foreground">{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
