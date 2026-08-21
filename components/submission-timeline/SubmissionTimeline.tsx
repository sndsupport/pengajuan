import { StatusBadge } from "@/components/status-badge/StatusBadge";

export type StatusHistoryEntry = {
  id: string;
  status: string;
  note: string | null;
  actorRole: string;
  timestamp: Date;
};

export function SubmissionTimeline({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat status.</p>;
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3 text-sm">
          <StatusBadge status={entry.status} />
          <div>
            <p className="text-muted-foreground">
              {entry.actorRole} — {entry.timestamp.toLocaleString("id-ID")}
            </p>
            {entry.note && <p>{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
