export type StatusHistoryEntry = {
  status: string;
  timestamp: Date;
};

export type StageDurations = {
  diajukanToDisetujui: number | null;
  disetujuiToSiapDikirim: number | null;
  siapDikirimToOnProsesGa: number | null;
  onProsesGaToSelesai: number | null;
  total: number | null;
};

export function computeStageDurations(entries: StatusHistoryEntry[], now: Date): StageDurations {
  if (entries.length === 0) {
    return {
      diajukanToDisetujui: null,
      disetujuiToSiapDikirim: null,
      siapDikirimToOnProsesGa: null,
      onProsesGaToSelesai: null,
      total: null,
    };
  }

  const sorted = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const first = sorted[0].timestamp;
  const findFirst = (status: string) => sorted.find((e) => e.status === status)?.timestamp ?? null;

  const disetujuiAt = findFirst("disetujui");
  const siapDikirimAt = findFirst("siap_dikirim");
  const onProsesGaAt = findFirst("on_proses_ga");
  const selesaiAt = findFirst("selesai");

  return {
    diajukanToDisetujui: disetujuiAt ? disetujuiAt.getTime() - first.getTime() : null,
    disetujuiToSiapDikirim: disetujuiAt && siapDikirimAt ? siapDikirimAt.getTime() - disetujuiAt.getTime() : null,
    siapDikirimToOnProsesGa: siapDikirimAt && onProsesGaAt ? onProsesGaAt.getTime() - siapDikirimAt.getTime() : null,
    onProsesGaToSelesai: onProsesGaAt && selesaiAt ? selesaiAt.getTime() - onProsesGaAt.getTime() : null,
    total: selesaiAt ? selesaiAt.getTime() - first.getTime() : now.getTime() - first.getTime(),
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}
