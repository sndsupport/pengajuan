export const STATUS_STYLES: Record<string, { label: string; color: string }> = {
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
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `${style.color}1F`, color: style.color }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.color }} />
      {style.label}
    </span>
  );
}
