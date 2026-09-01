import { describe, it, expect } from "vitest";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";

const baseData: SubmissionPdfData = {
  submissionNumber: "001/WHO/VIII/2026",
  type: "kendaraan",
  subType: "service_berkala",
  branch: "WHO",
  department: "Operasional",
  position: "Admin Cabang",
  requesterName: "Budi Santoso",
  requesterSignatureUrl: "https://drive.google.com/uc?export=view&id=req-sig",
  approverName: "Siti Aminah",
  approverRole: "spv",
  approverSignatureUrl: "https://drive.google.com/uc?export=view&id=approver-sig",
  submittedAt: new Date("2026-08-20T03:00:00Z"),
  approvedAt: new Date("2026-08-21T03:00:00Z"),
  items: [
    { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service 40rb km" },
  ],
};

describe("buildSubmissionPdfHtml", () => {
  it("includes the submission number", () => {
    expect(buildSubmissionPdfHtml(baseData)).toContain("001/WHO/VIII/2026");
  });

  it("includes each item's name and description", () => {
    const html = buildSubmissionPdfHtml(baseData);
    expect(html).toContain("Toyota Avanza");
    expect(html).toContain("Service 40rb km");
  });

  it("shows the KM column for kendaraan submissions", () => {
    const html = buildSubmissionPdfHtml(baseData);
    expect(html).toContain("<th>KM</th>");
    expect(html).toContain("45000");
  });

  it("hides the KM column for perlengkapan submissions", () => {
    const html = buildSubmissionPdfHtml({
      ...baseData,
      type: "perlengkapan",
      items: [{ itemName: "Kertas A4", brandType: "Sinar Dunia", km: null, quantity: 10, unit: "rim", description: "" }],
    });
    expect(html).not.toContain("<th>KM</th>");
  });

  it("renders a human-readable label for type gedung_fasilitas", () => {
    const html = buildSubmissionPdfHtml({
      ...baseData,
      type: "gedung_fasilitas",
      items: [{ itemName: "AC Ruang Meeting", brandType: "Daikin 1PK", km: null, quantity: 1, unit: "unit", description: "" }],
    });
    expect(html).toContain("Gedung & Fasilitas");
    expect(html).not.toContain("undefined");
  });

  it("includes both signature image URLs (HTML-escaped, since they're interpolated into an <img> attribute)", () => {
    const html = buildSubmissionPdfHtml(baseData);
    expect(html).toContain("https://drive.google.com/uc?export=view&amp;id=req-sig");
    expect(html).toContain("https://drive.google.com/uc?export=view&amp;id=approver-sig");
  });

  it("renders a human-readable label for approverRole spv", () => {
    const html = buildSubmissionPdfHtml(baseData);
    expect(html).toContain("AWS Supervisor");
  });

  it("renders a human-readable label for approverRole management", () => {
    const html = buildSubmissionPdfHtml({ ...baseData, approverRole: "management" });
    expect(html).toContain("Operational Manager");
  });

  it("escapes HTML special characters in user-provided text", () => {
    const html = buildSubmissionPdfHtml({
      ...baseData,
      items: [{ itemName: "<script>alert(1)</script>", brandType: "X", km: null, quantity: 1, unit: "unit", description: "" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the requester and approver names", () => {
    const html = buildSubmissionPdfHtml(baseData);
    expect(html).toContain("Budi Santoso");
    expect(html).toContain("Siti Aminah");
  });
});
