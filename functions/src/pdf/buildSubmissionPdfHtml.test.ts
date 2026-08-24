import { describe, it, expect } from "vitest";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./buildSubmissionPdfHtml";

const BASE_DATA: SubmissionPdfData = {
  submissionNumber: "L.002/TSI-OPR/WHO/VIII/2026",
  submittedAt: new Date("2026-08-21T00:00:00Z"),
  type: "kendaraan",
  branch: "WHO",
  department: "Operasional",
  position: "Admin",
  requesterName: "Rahmat Agus Tiyan",
  requesterSignatureUrl: "data:image/png;base64,aGVsbG8=",
  approverName: "Rizki Trihatanto",
  approverPosition: "Kepala Departemen",
  approverSignatureUrl: "https://drive.google.com/uc?export=view&id=file-2",
  items: [
    { itemName: "Mobil", brandType: "Grandmax Box D 8706 FN", km: 151995, quantity: 1, unit: "Unit", description: "Service Berkala" },
  ],
};

describe("buildSubmissionPdfHtml", () => {
  it("includes the submission number and a long-form Indonesian date", () => {
    const html = buildSubmissionPdfHtml(BASE_DATA);
    expect(html).toContain("L.002/TSI-OPR/WHO/VIII/2026");
    expect(html).toContain("21 Agustus 2026");
  });

  it("formats the date in Asia/Jakarta time, not server-local/UTC time", () => {
    const html = buildSubmissionPdfHtml({ ...BASE_DATA, submittedAt: new Date("2026-08-21T18:00:00Z") });
    expect(html).toContain("22 Agustus 2026");
  });

  it("includes requester and branch/department/position info", () => {
    const html = buildSubmissionPdfHtml(BASE_DATA);
    expect(html).toContain("Rahmat Agus Tiyan");
    expect(html).toContain("Operasional");
    expect(html).toContain("WHO");
    expect(html).toContain("Admin");
  });

  it("maps type to an Indonesian label", () => {
    const html = buildSubmissionPdfHtml(BASE_DATA);
    expect(html).toContain("Kendaraan");
    const perlengkapanHtml = buildSubmissionPdfHtml({ ...BASE_DATA, type: "perlengkapan" });
    expect(perlengkapanHtml).toContain("Perlengkapan");
  });

  it("renders one item-row per item and pads with blank rows up to 14 total", () => {
    const html = buildSubmissionPdfHtml(BASE_DATA);
    expect((html.match(/class="item-row"/g) ?? []).length).toBe(1);
    expect((html.match(/class="blank-row"/g) ?? []).length).toBe(13);
  });

  it("does not pad or truncate when items exceed 14", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      itemName: `Item ${i}`,
      brandType: "Type",
      km: null,
      quantity: 1,
      unit: "unit",
      description: "",
    }));
    const html = buildSubmissionPdfHtml({ ...BASE_DATA, items });
    expect((html.match(/class="item-row"/g) ?? []).length).toBe(15);
    expect((html.match(/class="blank-row"/g) ?? []).length).toBe(0);
  });

  it("shows a dash for a null km", () => {
    const html = buildSubmissionPdfHtml({
      ...BASE_DATA,
      items: [{ itemName: "Kertas A4", brandType: "Sinar Dunia", km: null, quantity: 10, unit: "rim", description: "" }],
    });
    expect(html).toContain("<td>-</td>");
  });

  it("escapes HTML special characters in free-text item fields", () => {
    const html = buildSubmissionPdfHtml({
      ...BASE_DATA,
      items: [{ itemName: "<script>alert(1)</script>", brandType: "X", km: null, quantity: 1, unit: "unit", description: "" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("uses the approver's personal position, not a generic role label", () => {
    const html = buildSubmissionPdfHtml(BASE_DATA);
    expect(html).toContain("Kepala Departemen");
  });

  it("embeds both signature URLs as img src", () => {
    const html = buildSubmissionPdfHtml(BASE_DATA);
    expect(html).toContain('<img src="data:image/png;base64,aGVsbG8="');
    expect(html).toContain('<img src="https://drive.google.com/uc?export=view&id=file-2"');
  });
});
