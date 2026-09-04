import { describe, it, expect } from "vitest";
import { buildSubmissionsWorkbookData } from "./buildSubmissionsWorkbookData";

function fakeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe("buildSubmissionsWorkbookData", () => {
  it("shapes an operasional submission (kendaraan) with its items and history", () => {
    const result = buildSubmissionsWorkbookData(
      [
        {
          id: "sub-1",
          data: {
            submissionNumber: "L.001/TSI-OPR/JB3-TNG/IX/2026",
            type: "kendaraan",
            subType: "service_berkala",
            status: "selesai",
            employeeName: "Budi Santoso",
            branch: "WHO",
            department: "Operasional",
            position: "Driver",
            requesterId: "uid-admin",
            approverName: "Siti Aminah",
            approverRole: "spv",
            rejectionNote: null,
            pdfUrl: "https://drive.google.com/file/d/abc/view",
            periodStart: null,
            periodEnd: null,
            submittedAt: fakeTimestamp("2026-09-01T08:00:00Z"),
            reviewedAt: fakeTimestamp("2026-09-01T09:00:00Z"),
            approvedAt: fakeTimestamp("2026-09-01T09:00:00Z"),
            sentToGaAt: fakeTimestamp("2026-09-01T10:00:00Z"),
            completedAt: fakeTimestamp("2026-09-02T08:00:00Z"),
          },
        },
      ],
      new Map([
        [
          "sub-1",
          [{ itemName: "Toyota Avanza", brandType: "Avanza 2020", km: 45000, quantity: 1, unit: "unit", description: "Service rutin" }],
        ],
      ]),
      new Map([["sub-1", [{ status: "diajukan", note: null, actorRole: "admin", timestamp: fakeTimestamp("2026-09-01T08:00:00Z") }]]])
    );

    expect(result.submissions).toHaveLength(1);
    expect(result.submissions[0].submissionNumber).toBe("L.001/TSI-OPR/JB3-TNG/IX/2026");
    expect(result.submissions[0].periodStart).toBeNull();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ submissionNumber: "L.001/TSI-OPR/JB3-TNG/IX/2026", itemName: "Toyota Avanza", km: 45000 });

    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ submissionNumber: "L.001/TSI-OPR/JB3-TNG/IX/2026", status: "diajukan" });
  });

  it("shapes a personalia submission with no items but with periodStart/periodEnd", () => {
    const result = buildSubmissionsWorkbookData(
      [
        {
          id: "sub-2",
          data: {
            submissionNumber: "P.001/TSI-HC/IX/2026",
            type: "personalia",
            subType: "cuti",
            status: "selesai",
            employeeName: "Siti Aminah",
            branch: null,
            department: "AWS",
            position: "Supervisor",
            requesterId: "uid-spv",
            approverName: null,
            approverRole: null,
            rejectionNote: null,
            pdfUrl: null,
            periodStart: "2026-09-10",
            periodEnd: "2026-09-12",
            submittedAt: fakeTimestamp("2026-09-01T08:00:00Z"),
            reviewedAt: null,
            approvedAt: null,
            sentToGaAt: null,
            completedAt: fakeTimestamp("2026-09-02T08:00:00Z"),
          },
        },
      ],
      new Map(),
      new Map()
    );

    expect(result.submissions[0].periodStart).toBe("2026-09-10");
    expect(result.submissions[0].periodEnd).toBe("2026-09-12");
    expect(result.items).toHaveLength(0);
    expect(result.history).toHaveLength(0);
  });

  it("returns null for missing timestamps instead of throwing", () => {
    const result = buildSubmissionsWorkbookData(
      [
        {
          id: "sub-3",
          data: {
            submissionNumber: "L.002/TSI-OPR/JB3-TNG/IX/2026",
            type: "kendaraan",
            subType: "service_berkala",
            status: "diajukan",
            employeeName: "Budi Santoso",
            branch: "WHO",
            department: "Operasional",
            position: "Driver",
            requesterId: "uid-admin",
            approverName: null,
            approverRole: null,
            rejectionNote: null,
            pdfUrl: null,
            periodStart: null,
            periodEnd: null,
            submittedAt: fakeTimestamp("2026-09-01T08:00:00Z"),
            reviewedAt: null,
            approvedAt: null,
            sentToGaAt: null,
            completedAt: null,
          },
        },
      ],
      new Map(),
      new Map()
    );

    expect(result.submissions[0].reviewedAt).toBeNull();
    expect(result.submissions[0].completedAt).toBeNull();
  });
});
