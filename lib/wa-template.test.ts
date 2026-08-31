import { describe, it, expect } from "vitest";
import { buildWaTemplate, buildPersonaliaWaTemplate } from "./wa-template";

describe("buildWaTemplate", () => {
  const submission = {
    submissionNumber: "001/WHO/VIII/2026",
    type: "kendaraan",
    subType: "service_berkala",
    branch: "WHO",
    pdfUrl: "https://drive.google.com/file/d/pdf-1/view",
  };

  it("includes the submission number", () => {
    expect(buildWaTemplate(submission, "Budi Santoso")).toContain("001/WHO/VIII/2026");
  });

  it("includes type and subType", () => {
    const text = buildWaTemplate(submission, "Budi Santoso");
    expect(text).toContain("kendaraan");
    expect(text).toContain("service_berkala");
  });

  it("includes the branch", () => {
    expect(buildWaTemplate(submission, "Budi Santoso")).toContain("WHO");
  });

  it("includes the requester name", () => {
    expect(buildWaTemplate(submission, "Budi Santoso")).toContain("Budi Santoso");
  });

  it("includes the pdf link", () => {
    expect(buildWaTemplate(submission, "Budi Santoso")).toContain("https://drive.google.com/file/d/pdf-1/view");
  });

  it("starts with a greeting to GA", () => {
    expect(buildWaTemplate(submission, "Budi Santoso").startsWith("Halo GA")).toBe(true);
  });
});

describe("buildPersonaliaWaTemplate", () => {
  const submission = {
    submissionNumber: "001/WHO/IX/2026",
    subType: "cuti",
    employeeName: "Rahmat Hidayat",
    branch: "WHO",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-03",
    attachmentUrl: "https://drive.google.com/file/d/cuti1/view",
  };

  it("includes the submission number", () => {
    expect(buildPersonaliaWaTemplate(submission, "Budi Santoso")).toContain("001/WHO/IX/2026");
  });

  it("includes the employee name and subType", () => {
    const text = buildPersonaliaWaTemplate(submission, "Budi Santoso");
    expect(text).toContain("Rahmat Hidayat");
    expect(text).toContain("cuti");
  });

  it("includes the period", () => {
    const text = buildPersonaliaWaTemplate(submission, "Budi Santoso");
    expect(text).toContain("2026-09-01");
    expect(text).toContain("2026-09-03");
  });

  it("includes the attachment link", () => {
    expect(buildPersonaliaWaTemplate(submission, "Budi Santoso")).toContain(
      "https://drive.google.com/file/d/cuti1/view"
    );
  });

  it("starts with a greeting to HC", () => {
    expect(buildPersonaliaWaTemplate(submission, "Budi Santoso").startsWith("Halo HC")).toBe(true);
  });
});
