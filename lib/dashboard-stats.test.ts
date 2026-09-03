import { describe, it, expect } from "vitest";
import {
  computeKpis,
  computeDailyTrend,
  computeStatusBreakdown,
  computeTypeBreakdown,
  computeBranchBreakdown,
  DashboardSubmission,
} from "./dashboard-stats";

const now = new Date(2026, 8, 4); // 4 Sep 2026

function sub(overrides: Partial<DashboardSubmission>): DashboardSubmission {
  return {
    status: "diajukan",
    type: "kendaraan",
    branch: "WHO",
    submittedAt: new Date(2026, 8, 1),
    completedAt: null,
    ...overrides,
  };
}

describe("computeKpis", () => {
  it("counts only this month's submissions for totalThisMonth", () => {
    const subs = [sub({ submittedAt: new Date(2026, 8, 1) }), sub({ submittedAt: new Date(2026, 7, 30) })];
    expect(computeKpis(subs, now).totalThisMonth).toBe(1);
  });

  it("counts active statuses regardless of month", () => {
    const subs = [
      sub({ status: "diajukan", submittedAt: new Date(2026, 6, 1) }),
      sub({ status: "selesai", submittedAt: new Date(2026, 8, 1) }),
      sub({ status: "on_proses_ga", submittedAt: new Date(2026, 8, 1) }),
    ];
    expect(computeKpis(subs, now).activeCount).toBe(2);
  });

  it("counts completed submissions this month", () => {
    const subs = [
      sub({ status: "selesai", submittedAt: new Date(2026, 8, 1), completedAt: new Date(2026, 8, 3) }),
      sub({ status: "selesai", submittedAt: new Date(2026, 7, 1), completedAt: new Date(2026, 7, 3) }),
    ];
    expect(computeKpis(subs, now).completedThisMonth).toBe(1);
  });

  it("averages completion duration for this month's completed submissions", () => {
    const subs = [
      sub({
        status: "selesai",
        submittedAt: new Date(2026, 8, 1, 0, 0, 0),
        completedAt: new Date(2026, 8, 2, 0, 0, 0), // 1 day
      }),
      sub({
        status: "selesai",
        submittedAt: new Date(2026, 8, 1, 0, 0, 0),
        completedAt: new Date(2026, 8, 4, 0, 0, 0), // 3 days
      }),
    ];
    expect(computeKpis(subs, now).avgCompletionMs).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it("returns null avgCompletionMs when nothing completed this month", () => {
    const subs = [sub({ status: "diajukan" })];
    expect(computeKpis(subs, now).avgCompletionMs).toBeNull();
  });
});

describe("computeDailyTrend", () => {
  it("buckets submissions by day of the current month", () => {
    const subs = [
      sub({ submittedAt: new Date(2026, 8, 1) }),
      sub({ submittedAt: new Date(2026, 8, 1) }),
      sub({ submittedAt: new Date(2026, 8, 3) }),
      sub({ submittedAt: new Date(2026, 7, 15) }), // different month, excluded
    ];
    const trend = computeDailyTrend(subs, now);
    expect(trend.length).toBe(30); // September has 30 days
    expect(trend[0]).toEqual({ day: 1, count: 2 });
    expect(trend[2]).toEqual({ day: 3, count: 1 });
    expect(trend[1]).toEqual({ day: 2, count: 0 });
  });
});

describe("breakdown functions", () => {
  it("computeStatusBreakdown counts by status, this month only", () => {
    const subs = [
      sub({ status: "diajukan", submittedAt: new Date(2026, 8, 1) }),
      sub({ status: "diajukan", submittedAt: new Date(2026, 8, 2) }),
      sub({ status: "selesai", submittedAt: new Date(2026, 8, 2) }),
      sub({ status: "selesai", submittedAt: new Date(2026, 7, 2) }),
    ];
    const result = computeStatusBreakdown(subs, now);
    expect(result).toEqual(
      expect.arrayContaining([
        { key: "diajukan", count: 2 },
        { key: "selesai", count: 1 },
      ])
    );
    expect(result.length).toBe(2);
  });

  it("computeTypeBreakdown counts by type, this month only", () => {
    const subs = [
      sub({ type: "kendaraan", submittedAt: new Date(2026, 8, 1) }),
      sub({ type: "personalia", submittedAt: new Date(2026, 8, 2) }),
    ];
    expect(computeTypeBreakdown(subs, now)).toEqual(
      expect.arrayContaining([
        { key: "kendaraan", count: 1 },
        { key: "personalia", count: 1 },
      ])
    );
  });

  it("computeBranchBreakdown counts by branch, this month only", () => {
    const subs = [
      sub({ branch: "WHO", submittedAt: new Date(2026, 8, 1) }),
      sub({ branch: "WHP", submittedAt: new Date(2026, 8, 2) }),
      sub({ branch: "WHO", submittedAt: new Date(2026, 8, 3) }),
    ];
    expect(computeBranchBreakdown(subs, now)).toEqual(
      expect.arrayContaining([
        { key: "WHO", count: 2 },
        { key: "WHP", count: 1 },
      ])
    );
  });
});
