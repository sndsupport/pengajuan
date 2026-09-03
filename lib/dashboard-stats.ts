export type DashboardSubmission = {
  status: string;
  type: string;
  branch: string;
  submittedAt: Date | null;
  completedAt: Date | null;
};

const ACTIVE_STATUSES = ["diajukan", "perlu_revisi", "disetujui", "siap_dikirim", "on_proses_ga"];

function isSameMonth(date: Date, reference: Date): boolean {
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();
}

function submittedThisMonth(sub: DashboardSubmission, now: Date): boolean {
  return sub.submittedAt !== null && isSameMonth(sub.submittedAt, now);
}

export type DashboardKpis = {
  totalThisMonth: number;
  activeCount: number;
  completedThisMonth: number;
  avgCompletionMs: number | null;
};

export function computeKpis(submissions: DashboardSubmission[], now: Date): DashboardKpis {
  const thisMonth = submissions.filter((s) => submittedThisMonth(s, now));
  const completedThisMonth = thisMonth.filter((s) => s.status === "selesai");
  const durations = completedThisMonth
    .filter((s) => s.submittedAt !== null && s.completedAt !== null)
    .map((s) => s.completedAt!.getTime() - s.submittedAt!.getTime());

  return {
    totalThisMonth: thisMonth.length,
    activeCount: submissions.filter((s) => ACTIVE_STATUSES.includes(s.status)).length,
    completedThisMonth: completedThisMonth.length,
    avgCompletionMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

export type DailyTrendPoint = { day: number; count: number };

export function computeDailyTrend(submissions: DashboardSubmission[], now: Date): DailyTrendPoint[] {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const counts = new Array(daysInMonth).fill(0);
  for (const s of submissions) {
    if (!submittedThisMonth(s, now)) continue;
    counts[s.submittedAt!.getDate() - 1] += 1;
  }
  return counts.map((count, i) => ({ day: i + 1, count }));
}

export type BreakdownSlice = { key: string; count: number };

export function computeStatusBreakdown(submissions: DashboardSubmission[], now: Date): BreakdownSlice[] {
  return countBy(
    submissions.filter((s) => submittedThisMonth(s, now)),
    (s) => s.status
  );
}

export function computeTypeBreakdown(submissions: DashboardSubmission[], now: Date): BreakdownSlice[] {
  return countBy(
    submissions.filter((s) => submittedThisMonth(s, now)),
    (s) => s.type
  );
}

export function computeBranchBreakdown(submissions: DashboardSubmission[], now: Date): BreakdownSlice[] {
  return countBy(
    submissions.filter((s) => submittedThisMonth(s, now)),
    (s) => s.branch
  );
}

function countBy(submissions: DashboardSubmission[], keyOf: (s: DashboardSubmission) => string): BreakdownSlice[] {
  const counts = new Map<string, number>();
  for (const s of submissions) {
    const key = keyOf(s);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, count]) => ({ key, count }));
}
