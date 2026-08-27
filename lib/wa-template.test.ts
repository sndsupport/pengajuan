import { describe, it, expect } from "vitest";
import { buildWaTemplate } from "./wa-template";

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
