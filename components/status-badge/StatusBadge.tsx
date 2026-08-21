import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  diajukan: { label: "Diajukan", color: "#64748B" },
  perlu_revisi: { label: "Perlu Revisi", color: "#D97706" },
  disetujui: { label: "Disetujui", color: "#0891B2" },
  siap_dikirim: { label: "Siap Dikirim", color: "#3454D1" },
  on_proses_ga: { label: "On Proses GA", color: "#7C3AED" },
  selesai: { label: "Selesai", color: "#16A34A" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { label: status, color: "#64748B" };
  return (
    <Badge style={{ backgroundColor: style.color, color: "white" }} className="border-0">
      {style.label}
    </Badge>
  );
}
