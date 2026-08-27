// lib/monitoring.test.ts
import { describe, it, expect } from "vitest";
import { computeStageDurations, formatDuration, StatusHistoryEntry } from "./monitoring";

describe("computeStageDurations", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("returns all nulls for an empty history", () => {
    const result = computeStageDurations([], now);
    expect(result).toEqual({
      diajukanToDisetujui: null,
      disetujuiToSiapDikirim: null,
      siapDikirimToOnProsesGa: null,
      onProsesGaToSelesai: null,
      total: null,
    });
  });

  it("computes total as elapsed-so-far when only diajukan exists", () => {
    const entries: StatusHistoryEntry[] = [{ status: "diajukan", timestamp: new Date("2026-08-28T10:00:00Z") }];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBeNull();
    expect(result.total).toBe(2 * 60 * 60 * 1000);
  });

  it("computes diajukanToDisetujui from the earliest entry, including a revision cycle", () => {
    const entries: StatusHistoryEntry[] = [
      { status: "diajukan", timestamp: new Date("2026-08-20T00:00:00Z") },
      { status: "perlu_revisi", timestamp: new Date("2026-08-21T00:00:00Z") },
      { status: "diajukan", timestamp: new Date("2026-08-22T00:00:00Z") },
      { status: "disetujui", timestamp: new Date("2026-08-23T00:00:00Z") },
    ];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("computes each subsequent stage duration and a final total when selesai", () => {
    const entries: StatusHistoryEntry[] = [
      { status: "diajukan", timestamp: new Date("2026-08-01T00:00:00Z") },
      { status: "disetujui", timestamp: new Date("2026-08-02T00:00:00Z") },
      { status: "siap_dikirim", timestamp: new Date("2026-08-02T01:00:00Z") },
      { status: "on_proses_ga", timestamp: new Date("2026-08-03T00:00:00Z") },
      { status: "selesai", timestamp: new Date("2026-08-05T00:00:00Z") },
    ];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBe(24 * 60 * 60 * 1000);
    expect(result.disetujuiToSiapDikirim).toBe(60 * 60 * 1000);
    expect(result.siapDikirimToOnProsesGa).toBe(23 * 60 * 60 * 1000);
    expect(result.onProsesGaToSelesai).toBe(2 * 24 * 60 * 60 * 1000);
    expect(result.total).toBe(4 * 24 * 60 * 60 * 1000);
  });

  it("does not assume entries are pre-sorted", () => {
    const entries: StatusHistoryEntry[] = [
      { status: "disetujui", timestamp: new Date("2026-08-02T00:00:00Z") },
      { status: "diajukan", timestamp: new Date("2026-08-01T00:00:00Z") },
    ];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBe(24 * 60 * 60 * 1000);
  });
});

describe("formatDuration", () => {
  it("returns a dash for null", () => {
    expect(formatDuration(null)).toBe("-");
  });

  it("formats minutes only under an hour", () => {
    expect(formatDuration(45 * 60 * 1000)).toBe("45m");
  });

  it("formats hours and minutes under a day", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe("2j 30m");
  });

  it("formats days and hours at a day or more", () => {
    expect(formatDuration(2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)).toBe("2h 3j");
  });
});
