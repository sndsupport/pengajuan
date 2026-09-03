import { ClipboardList, Clock, Hourglass, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardKpis } from "@/lib/dashboard-stats";
import { formatDuration } from "@/lib/monitoring";

const KPI_DEFS = [
  { key: "totalThisMonth", label: "Total Pengajuan Bulan Ini", icon: ClipboardList },
  { key: "activeCount", label: "Sedang Diproses", icon: Hourglass },
  { key: "completedThisMonth", label: "Selesai Bulan Ini", icon: TrendingUp },
] as const;

export function KpiCards({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {KPI_DEFS.map(({ key, label, icon: Icon }) => (
        <Card key={key}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-mono text-2xl font-semibold leading-none">{kpis[key]}</p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="font-mono text-2xl font-semibold leading-none">
              {formatDuration(kpis.avgCompletionMs)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Rata-rata Durasi Penyelesaian</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
