# Generate PDF di Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PDF generation for approved submissions from the Cloud Function `generateSubmissionPdf` (Puppeteer) to the client (jsPDF + html2canvas), and add the `firestore.rules` branch for the last remaining status transition, `disetujui → siap_dikirim`. Sub-project 3 of 5 in the Spark-plan architecture migration.

**Architecture:** `lib/pdf/pdfTemplate.ts` is a near-verbatim port of the existing HTML template builder (pure string function, no changes needed). `lib/pdf/generateSubmissionPdfClient.ts` renders that HTML into an off-screen DOM container, captures it with `html2canvas`, slices the resulting canvas into A4-height pages for `jsPDF`, and uploads the result via the existing `uploadToDriveClient`. `lib/pdf/generateAndAttachSubmissionPdf.ts` orchestrates the Firestore side: fetch submission + items + requester + approver, build the PDF, then write `pdfUrl` + `status: siap_dikirim` + a `statusHistory` entry. This orchestrator is called from two places: `lib/submissions/reviewSubmission.ts` (fire-and-forget, right after a successful approve) and a new retry button on the submission detail page (in case the fire-and-forget attempt failed).

**Tech Stack:** TypeScript, `jspdf`, `html2canvas`, Firestore client SDK, Vitest.

**Environment note:** Same constraints as prior plans — no Java, so `@firebase/rules-unit-testing`/emulator-backed tests cannot run on this machine, and no real browser is available either, so anything depending on `html2canvas`/DOM/`document.fonts` cannot be run or verified here. Every such piece is written per TDD where testable, and written-but-unverified where not (matching the precedent set by `lib/drive-upload.ts` in sub-project 1) — verify via `npx tsc --noEmit` instead. The one genuinely new, fully-testable piece in this plan is `computePdfPageSlices` (pure math, no DOM), which gets real tests that run.

---

## File Structure

```
/lib
  /pdf
    pdfTemplate.ts                        # new — ported verbatim from functions/src/pdfTemplate.ts
    pdfTemplate.test.ts                     # new — ported verbatim from functions/src/pdfTemplate.test.ts
    generateSubmissionPdfClient.ts            # new — DOM render + html2canvas + jsPDF + Drive upload; also exports computePdfPageSlices
    generateSubmissionPdfClient.test.ts         # new — tests for computePdfPageSlices only (the only testable piece)
    generateAndAttachSubmissionPdf.ts             # new — Firestore orchestration: fetch data, call generateSubmissionPdfClient, write pdfUrl+status+statusHistory
  /submissions
    reviewSubmission.ts                             # modify — call generateAndAttachSubmissionPdf after a successful approve
/app
  /(dashboard)
    /pengajuan/[id]/page.tsx                          # modify — add retry UI when status is disetujui but pdfUrl is still empty
firestore.rules                                         # modify — add disetujui -> siap_dikirim branch
/tests
  firestore-rules.test.ts                                # modify — add tests for the new branch
/functions
  /src
    generateSubmissionPdf.ts, .test.ts                       # delete
    pdfTemplate.ts, .test.ts                                   # delete (server-side version)
    googleDrive.ts, .test.ts                                     # delete (used only by generateSubmissionPdf.ts)
    index.ts                                                       # modify — remove generateSubmissionPdf trigger and its imports
package.json                                                        # modify — add jspdf, html2canvas dependencies
```

---

## Task 1: Port `pdfTemplate.ts` to the client

**Files:**
- Create: `lib/pdf/pdfTemplate.ts`
- Create: `lib/pdf/pdfTemplate.test.ts`

- [ ] **Step 1: Write `lib/pdf/pdfTemplate.ts`**

This is a verbatim copy of `functions/src/pdfTemplate.ts` — it's already a pure HTML-string-building function with no Node.js-specific APIs (`Intl.DateTimeFormat` works identically in both environments), so nothing changes:

```typescript
const TYPE_LABEL: Record<"kendaraan" | "perlengkapan", string> = {
  kendaraan: "Kendaraan",
  perlengkapan: "Perlengkapan",
};

const APPROVER_ROLE_LABEL: Record<"spv" | "management", string> = {
  spv: "AWS Supervisor",
  management: "Management",
};

export type SubmissionPdfItem = {
  itemName: string;
  brandType: string;
  km: number | null;
  quantity: number;
  unit: string;
  description: string;
};

export type SubmissionPdfData = {
  submissionNumber: string;
  type: "kendaraan" | "perlengkapan";
  subType: string;
  branch: string;
  department: string;
  position: string;
  requesterName: string;
  requesterSignatureUrl: string;
  approverName: string;
  approverRole: "spv" | "management";
  approverSignatureUrl: string;
  submittedAt: Date;
  approvedAt: Date;
  items: SubmissionPdfItem[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildSubmissionPdfHtml(data: SubmissionPdfData): string {
  const showKm = data.type === "kendaraan";

  const itemsRows = data.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.itemName)}</td>
          <td>${escapeHtml(item.brandType)}</td>
          ${showKm ? `<td class="mono">${item.km ?? "-"}</td>` : ""}
          <td class="mono">${item.quantity}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.description)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Public Sans', Arial, sans-serif; color: #1f2937; margin: 0; padding: 32px; font-size: 12px; }
  h1 { font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 16px; margin: 0 0 4px; }
  .header { border-bottom: 3px solid #0891B2; padding-bottom: 12px; margin-bottom: 16px; }
  .mono { font-family: 'IBM Plex Mono', monospace; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; font-size: 11px; }
  th { background: #f3f4f6; font-family: 'Plus Jakarta Sans', Arial, sans-serif; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
  .signature-block { width: 45%; text-align: center; }
  .signature-block img { max-height: 60px; margin: 8px 0; }
  .signature-line { border-top: 1px solid #1f2937; margin-top: 4px; padding-top: 4px; }
  .footer { margin-top: 32px; font-size: 9px; color: #6b7280; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>PT TRIDAYA SINERGI INDONESIA</h1>
    <div>FORMULIR PENGAJUAN KENDARAAN/PERLENGKAPAN</div>
    <div class="mono">${escapeHtml(data.submissionNumber)}</div>
  </div>
  <div class="info-grid">
    <div>
      <div><strong>Cabang:</strong> ${escapeHtml(data.branch)}</div>
      <div><strong>Departemen:</strong> ${escapeHtml(data.department)}</div>
      <div><strong>Posisi:</strong> ${escapeHtml(data.position)}</div>
      <div><strong>Nama Pengaju:</strong> ${escapeHtml(data.requesterName)}</div>
    </div>
    <div>
      <div><strong>Jenis Pengajuan:</strong> ${TYPE_LABEL[data.type]}</div>
      <div><strong>Sub Jenis:</strong> ${escapeHtml(data.subType)}</div>
      <div><strong>Tanggal Diajukan:</strong> <span class="mono">${formatDate(data.submittedAt)}</span></div>
      <div><strong>Tanggal Disetujui:</strong> <span class="mono">${formatDate(data.approvedAt)}</span></div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Nama Item</th>
        <th>Merk/Tipe</th>
        ${showKm ? "<th>KM</th>" : ""}
        <th>Jumlah</th>
        <th>Satuan</th>
        <th>Deskripsi</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>
  <div class="signatures">
    <div class="signature-block">
      <div>Pemohon</div>
      <img src="${escapeHtml(data.requesterSignatureUrl)}" alt="Tanda tangan pemohon" />
      <div class="signature-line">${escapeHtml(data.requesterName)}</div>
    </div>
    <div class="signature-block">
      <div>Mengetahui</div>
      <img src="${escapeHtml(data.approverSignatureUrl)}" alt="Tanda tangan approver" />
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
  </div>
  <div class="footer">Dokumen digenerate otomatis oleh sistem pada ${formatDateTime(new Date())}.</div>
</body>
</html>`;
}
```

- [ ] **Step 2: Write `lib/pdf/pdfTemplate.test.ts`**

Also a verbatim copy of `functions/src/pdfTemplate.test.ts`, just importing from the new location:

```typescript
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
    expect(html).toContain("Management");
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
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run lib/pdf/pdfTemplate.test.ts`
Expected: 9/9 tests pass (this file has no DOM/browser dependency, so unlike most of this plan, it genuinely can and must be run).

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/pdfTemplate.ts lib/pdf/pdfTemplate.test.ts
git commit -m "feat: port PDF HTML template to the client"
```

---

## Task 2: `lib/pdf/generateSubmissionPdfClient.ts`

**Files:**
- Create: `lib/pdf/generateSubmissionPdfClient.ts`
- Create: `lib/pdf/generateSubmissionPdfClient.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `jspdf` and `html2canvas` dependencies**

Run:
```bash
npm install jspdf html2canvas
```
Expected: `package.json`'s `dependencies` gains `"jspdf": "^<version>"` and `"html2canvas": "^<version>"`, `package-lock.json` updates.

- [ ] **Step 2: Write the failing test for `computePdfPageSlices`**

```typescript
// lib/pdf/generateSubmissionPdfClient.test.ts
import { describe, it, expect } from "vitest";
import { computePdfPageSlices } from "./generateSubmissionPdfClient";

describe("computePdfPageSlices", () => {
  it("returns a single slice when content fits on one page", () => {
    const slices = computePdfPageSlices(1000, 500, 210, 297);
    expect(slices).toEqual([{ sourceYPx: 0, sliceHeightPx: 500 }]);
  });

  it("splits content taller than one page into multiple slices", () => {
    const slices = computePdfPageSlices(1588, 3000, 210, 297);
    expect(slices).toHaveLength(2);
    expect(slices[0].sourceYPx).toBe(0);
    expect(slices[0].sliceHeightPx).toBeCloseTo(2245.9, 0);
    expect(slices[1].sourceYPx).toBeCloseTo(2245.9, 0);
    expect(slices[1].sliceHeightPx).toBeCloseTo(754.1, 0);
  });

  it("slices sum to the total canvas height", () => {
    const slices = computePdfPageSlices(1588, 5000, 210, 297);
    const totalHeight = slices.reduce((sum, s) => sum + s.sliceHeightPx, 0);
    expect(totalHeight).toBeCloseTo(5000, 5);
  });

  it("uses default A4 dimensions when page size is omitted", () => {
    const slices = computePdfPageSlices(1000, 100);
    expect(slices).toEqual([{ sourceYPx: 0, sliceHeightPx: 100 }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/pdf/generateSubmissionPdfClient.test.ts`
Expected: FAIL with "generateSubmissionPdfClient.ts not found" or "computePdfPageSlices is not a function"

- [ ] **Step 4: Write `lib/pdf/generateSubmissionPdfClient.ts`**

```typescript
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";
import { uploadToDriveClient } from "@/lib/drive-upload";

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap";
const GOOGLE_FONTS_LINK_ID = "pdf-google-fonts-link";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RENDER_WIDTH_PX = 794; // ~210mm at 96dpi, so the captured canvas maps cleanly onto an A4-width page

async function ensureGoogleFontsLoaded(): Promise<void> {
  if (!document.getElementById(GOOGLE_FONTS_LINK_ID)) {
    const link = document.createElement("link");
    link.id = GOOGLE_FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
  }
  await document.fonts.ready;
}

function waitForImagesToLoad(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
}

export function computePdfPageSlices(
  canvasWidthPx: number,
  canvasHeightPx: number,
  pageWidthMm: number = A4_WIDTH_MM,
  pageHeightMm: number = A4_HEIGHT_MM
): Array<{ sourceYPx: number; sliceHeightPx: number }> {
  const pxPerMm = canvasWidthPx / pageWidthMm;
  const pageHeightPx = pageHeightMm * pxPerMm;

  const slices: Array<{ sourceYPx: number; sliceHeightPx: number }> = [];
  let remainingHeightPx = canvasHeightPx;
  let sourceYPx = 0;
  while (remainingHeightPx > 0) {
    const sliceHeightPx = Math.min(pageHeightPx, remainingHeightPx);
    slices.push({ sourceYPx, sliceHeightPx });
    sourceYPx += sliceHeightPx;
    remainingHeightPx -= sliceHeightPx;
  }
  return slices;
}

export type GenerateSubmissionPdfResult = { pdfUrl: string };

export async function generateSubmissionPdfClient(data: SubmissionPdfData): Promise<GenerateSubmissionPdfResult> {
  await ensureGoogleFontsLoaded();

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${RENDER_WIDTH_PX}px`;
  container.innerHTML = buildSubmissionPdfHtml(data);
  document.body.appendChild(container);

  try {
    await waitForImagesToLoad(container);

    const canvas = await html2canvas(container, { useCORS: true, scale: 2 });

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const slices = computePdfPageSlices(canvas.width, canvas.height, A4_WIDTH_MM, A4_HEIGHT_MM);

    slices.forEach((slice, index) => {
      if (index > 0) {
        pdf.addPage();
      }
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = slice.sliceHeightPx;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, slice.sourceYPx, canvas.width, slice.sliceHeightPx, 0, 0, canvas.width, slice.sliceHeightPx);
      const sliceImageData = sliceCanvas.toDataURL("image/png");
      const sliceHeightMm = (slice.sliceHeightPx / canvas.width) * A4_WIDTH_MM;
      pdf.addImage(sliceImageData, "PNG", 0, 0, A4_WIDTH_MM, sliceHeightMm);
    });

    const pdfBlob = pdf.output("blob");
    const pdfFile = new File([pdfBlob], `${data.submissionNumber.replace(/\//g, "-")}.pdf`, {
      type: "application/pdf",
    });
    const { fileUrl } = await uploadToDriveClient(pdfFile, "attachment");
    return { pdfUrl: fileUrl };
  } finally {
    document.body.removeChild(container);
  }
}
```

`generateSubmissionPdfClient` itself (everything except `computePdfPageSlices`) depends on `document`, `html2canvas`, and `jsPDF` — it cannot run or be verified on this machine (no browser). It's written to spec and will need manual verification once deployed, matching how `uploadToDriveClient` (sub-project 1) was handled. `computePdfPageSlices` is pure math with no DOM dependency and is fully tested by Step 2's test file.

- [ ] **Step 5: Run the `computePdfPageSlices` tests to verify they pass**

Run: `npx vitest run lib/pdf/generateSubmissionPdfClient.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 6: Verify the whole project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/pdf/generateSubmissionPdfClient.ts lib/pdf/generateSubmissionPdfClient.test.ts package.json package-lock.json
git commit -m "feat: add client-side PDF rendering via html2canvas + jsPDF"
```

---

## Task 3: `lib/pdf/generateAndAttachSubmissionPdf.ts`

**Files:**
- Create: `lib/pdf/generateAndAttachSubmissionPdf.ts`

- [ ] **Step 1: Write `lib/pdf/generateAndAttachSubmissionPdf.ts`**

```typescript
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { generateSubmissionPdfClient } from "./generateSubmissionPdfClient";
import type { SubmissionPdfData, SubmissionPdfItem } from "./pdfTemplate";
import type { AppUser } from "@/lib/hooks/useAuth";

const APPROVER_ROLE_VALUES = ["spv", "management"];

export type GenerateAndAttachSubmissionPdfResult = { pdfUrl: string };

export async function generateAndAttachSubmissionPdf(
  submissionId: string,
  caller: AppUser
): Promise<GenerateAndAttachSubmissionPdfResult> {
  const submissionRef = doc(db, "submissions", submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.status !== "disetujui") {
    throw new Error("Hanya pengajuan berstatus disetujui yang bisa dibuatkan PDF.");
  }
  if (!APPROVER_ROLE_VALUES.includes(submission.approverRole)) {
    throw new Error("Role approver pada pengajuan ini tidak valid.");
  }

  const [itemsSnap, requesterSnap, approverSnap] = await Promise.all([
    getDocs(collection(submissionRef, "items")),
    getDoc(doc(db, "users", submission.requesterId)),
    getDoc(doc(db, "users", submission.approverId)),
  ]);
  const requester = requesterSnap.data();
  const approver = approverSnap.data();
  if (!requester || !approver) {
    throw new Error("Data pengaju atau approver tidak ditemukan.");
  }

  const items: SubmissionPdfItem[] = itemsSnap.docs.map((d) => {
    const item = d.data();
    return {
      itemName: item.itemName as string,
      brandType: item.brandType as string,
      km: (item.km as number | null) ?? null,
      quantity: item.quantity as number,
      unit: item.unit as string,
      description: item.description as string,
    };
  });

  const pdfData: SubmissionPdfData = {
    submissionNumber: submission.submissionNumber,
    type: submission.type,
    subType: submission.subType,
    branch: submission.branch,
    department: submission.department,
    position: submission.position,
    requesterName: requester.name,
    requesterSignatureUrl: submission.requesterSignatureUrl,
    approverName: approver.name,
    approverRole: submission.approverRole,
    approverSignatureUrl: submission.approverSignatureUrl,
    submittedAt: submission.submittedAt?.toDate() ?? new Date(),
    approvedAt: submission.approvedAt?.toDate() ?? new Date(),
    items,
  };

  const { pdfUrl } = await generateSubmissionPdfClient(pdfData);

  const batch = writeBatch(db);
  batch.update(submissionRef, {
    status: "siap_dikirim",
    pdfUrl,
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { pdfUrl };
}
```

This function depends on `generateSubmissionPdfClient` (DOM-dependent, cannot run here) so it cannot be tested end-to-end on this machine either — written to spec, no test file for this task.

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/generateAndAttachSubmissionPdf.ts
git commit -m "feat: add Firestore orchestration for client-side PDF generation"
```

---

## Task 4: Add `disetujui → siap_dikirim` to `firestore.rules`

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Replace the `allow update` block on `submissions/{submissionId}` in `firestore.rules`**

Current block (5 branches) becomes this (6 branches — the new one inserted between reject and confirm-sent-to-GA, matching the state machine's logical order):

```
      allow update: if isSignedIn()
        && request.resource.data.requesterId == resource.data.requesterId
        && (
        // Resubmit setelah revisi: pemilik, status lama perlu_revisi -> diajukan
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'perlu_revisi'
          && request.resource.data.status == 'diajukan'
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['type', 'subType', 'requesterSignatureUrl', 'status', 'rejectionNote']))
        ||
        // Review - approve: spv/management, status lama diajukan -> disetujui
        (userRole() in ['spv', 'management']
          && resource.data.status == 'diajukan'
          && request.resource.data.status == 'disetujui'
          && request.resource.data.approverId == request.auth.uid
          && request.resource.data.approverRole == userRole()
          && request.resource.data.approverSignatureUrl is string
          && request.resource.data.approverSignatureUrl.size() > 0
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'approverId', 'approverRole', 'approverSignatureUrl', 'approvedAt', 'reviewedAt']))
        ||
        // Review - reject: spv/management, status lama diajukan -> perlu_revisi
        (userRole() in ['spv', 'management']
          && resource.data.status == 'diajukan'
          && request.resource.data.status == 'perlu_revisi'
          && request.resource.data.rejectionNote is string
          && request.resource.data.rejectionNote.size() > 0
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'rejectionNote', 'reviewedAt']))
        ||
        // Generate PDF setelah disetujui: approver ATAU pemilik (jalur retry), status lama disetujui -> siap_dikirim
        ((resource.data.approverId == request.auth.uid || resource.data.requesterId == request.auth.uid)
          && resource.data.status == 'disetujui'
          && request.resource.data.status == 'siap_dikirim'
          && request.resource.data.pdfUrl is string
          && request.resource.data.pdfUrl.size() > 0
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'pdfUrl']))
        ||
        // Konfirmasi sudah dikirim ke GA: pemilik, status lama siap_dikirim -> on_proses_ga
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'siap_dikirim'
          && request.resource.data.status == 'on_proses_ga'
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'sentToGaAt']))
        ||
        // Tandai selesai: pemilik, status lama on_proses_ga -> selesai
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'on_proses_ga'
          && request.resource.data.status == 'selesai'
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status', 'completedAt']))
      );
```

Nothing else in `firestore.rules` changes — the `statusHistory` create rule already handles this transition correctly without modification (it checks owner-or-reviewer on the parent submission via `get()`, which is satisfied by both the approver, who is a reviewer, and the requester, on the retry path).

- [ ] **Step 2: Add the new test cases to `tests/firestore-rules.test.ts`**

Add this new `describe` block inside the top-level `describe("firestore.rules", ...)`, after the existing `describe("submissions update rule — status transitions", ...)` block:

```typescript
  describe("submissions update rule — disetujui to siap_dikirim (PDF generation)", () => {
    it("allows the approver to advance to siap_dikirim with a pdfUrl", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-disetujui").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-1/view",
        })
      );
    });

    it("allows the requester to advance to siap_dikirim with a pdfUrl (retry path)", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui2").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-disetujui2").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-2/view",
        })
      );
    });

    it("denies an unrelated user from advancing to siap_dikirim", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui3").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui3").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-3/view",
        })
      );
    });

    it("denies advancing to siap_dikirim without a pdfUrl", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui4").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui4").update({
          status: "siap_dikirim",
          pdfUrl: "",
        })
      );
    });

    it("denies advancing to siap_dikirim while also modifying an unrelated field", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui5").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
          branch: "WHO",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui5").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-5/view",
          branch: "WHP",
        })
      );
    });
  });
```

- [ ] **Step 3 (SKIP — needs emulator, no Java on this machine):** would normally run `npx vitest run tests/firestore-rules.test.ts` here to verify all tests pass, including the 5 new ones and the pre-existing ones (unaffected by this change since they don't touch `disetujui`/`siap_dikirim`/`pdfUrl`).

- [ ] **Step 4: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: add disetujui to siap_dikirim transition to Firestore Rules"
```

---

## Task 5: Wire PDF generation into `reviewSubmission.ts`

**Files:**
- Modify: `lib/submissions/reviewSubmission.ts`

- [ ] **Step 1: Add the import**

Add to the top of `lib/submissions/reviewSubmission.ts`:
```typescript
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
```

- [ ] **Step 2: Call it after a successful approve**

Current end of the function:
```typescript
  await batch.commit();
  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
```

Replace with:
```typescript
  await batch.commit();

  if (input.decision === "approve") {
    try {
      await generateAndAttachSubmissionPdf(input.submissionId, caller);
    } catch (error) {
      console.error(`reviewSubmission: PDF generation failed for submission ${input.submissionId}`, error);
    }
  }

  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
```

The PDF-generation failure is deliberately swallowed (logged, not thrown) — the approve action itself already succeeded (the batch commit above completed), and re-throwing here would incorrectly tell the reviewer their approval failed when it didn't. Recovery for a failed PDF happens via the retry button added in Task 6, on the requester's own detail page.

Nothing else in this file changes.

- [ ] **Step 3: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/submissions/reviewSubmission.ts
git commit -m "feat: generate and attach PDF automatically after approving a submission"
```

---

## Task 6: Add PDF-retry UI to the submission detail page

**Files:**
- Modify: `app/(dashboard)/pengajuan/[id]/page.tsx`

- [ ] **Step 1: Add the import**

Add alongside the existing `confirmSentToGa`/`markAsDone` imports:
```typescript
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
```

- [ ] **Step 2: Add state and a handler**

Add alongside the existing `useState` declarations (after `markDoneError`):
```typescript
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
```

Add a new handler function, alongside `handleConfirm`/`handleMarkDone`:
```typescript
  async function handleGeneratePdf() {
    if (!submission || !appUser) return;
    setPdfError(null);
    setGeneratingPdf(true);
    try {
      await generateAndAttachSubmissionPdf(submission.id, appUser);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Gagal generate PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  }
```

- [ ] **Step 3: Add the JSX block**

Insert this new block right after the `perlu_revisi` block and before the `siap_dikirim` block (matching the state machine's logical order — this covers the `disetujui` status, which currently has no UI at all):

```tsx
      {submission.status === "disetujui" && !submission.pdfUrl && appUser && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-medium">PDF pengajuan belum berhasil dibuat.</p>
          {pdfError && <p className="text-sm text-red-600">{pdfError}</p>}
          <Button type="button" size="sm" disabled={generatingPdf} onClick={handleGeneratePdf}>
            {generatingPdf ? "Memproses..." : "Coba Generate PDF"}
          </Button>
        </div>
      )}
```

Everything else in the file (both `onSnapshot` listeners, `handleCopy`, `handleConfirm`, `handleMarkDone`, the `perlu_revisi`/`siap_dikirim`/`on_proses_ga` blocks) is unchanged.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if it fails at the prerender stage with a missing-Firebase-config error, rerun, then delete `.env.local` again afterward and confirm `git status` shows it untracked).
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/pengajuan/[id]/page.tsx"
git commit -m "feat: add PDF retry button for submissions stuck at disetujui"
```

---

## Task 7: Remove the now-dead Cloud Function and its dependencies

**Files:**
- Delete: `functions/src/generateSubmissionPdf.ts`, `functions/src/generateSubmissionPdf.test.ts`
- Delete: `functions/src/pdfTemplate.ts`, `functions/src/pdfTemplate.test.ts`
- Delete: `functions/src/googleDrive.ts`, `functions/src/googleDrive.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Delete the 6 files**

```bash
git rm functions/src/generateSubmissionPdf.ts functions/src/generateSubmissionPdf.test.ts
git rm functions/src/pdfTemplate.ts functions/src/pdfTemplate.test.ts
git rm functions/src/googleDrive.ts functions/src/googleDrive.test.ts
```

`functions/src/googleDrive.ts` is safe to delete in full here — it was used only by `functions/src/generateSubmissionPdf.ts` (confirmed by grep during this plan's research), so once that's gone, nothing in `functions/src/` references it.

- [ ] **Step 2: Replace `functions/src/index.ts` with only the surviving callables**

```typescript
import { onCall } from "firebase-functions/v2/https";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";

export const createUser = onCall((request) =>
  createUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const updateUser = onCall((request) =>
  updateUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const resetUserPassword = onCall((request) =>
  resetUserPasswordHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
```

Do NOT touch `functions/src/createUser.ts`, `functions/src/updateUser.ts`, `functions/src/resetUserPassword.ts`, or `functions/src/userSchemas.ts` — user management is sub-project 4, out of scope here.

- [ ] **Step 3: Verify the functions project still type-checks**

Run: `npm --prefix functions run build`.
Expected: succeeds, no type errors.

- [ ] **Step 4: Verify the whole repo type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "chore: remove Cloud Function now replaced by client-side PDF generation"
```

---

## Task 8: Manual end-to-end verification (needs browser + emulator — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Once a real browser and Java/emulator are available, verify manually**

Approve a submission as spv/management and confirm: the PDF is generated in the approver's browser, uploaded to Drive, `pdfUrl` and `status: siap_dikirim` land on the submission, and a `statusHistory` entry is created. Open the resulting PDF and visually compare it against a PDF generated by the old Puppeteer-based Cloud Function for the same data — check font rendering (Plus Jakarta Sans / Public Sans / IBM Plex Mono actually load in time), whether the two signature images (both hosted on Google Drive) render correctly inside the captured canvas (this is the specific untested CORS/tainted-canvas risk flagged in the design spec — if `useCORS: true` doesn't work, the images may render blank or the whole capture may throw), and whether a submission with a long item list correctly spans multiple PDF pages instead of being cut off. Separately, test the retry path: manually set a submission to `status: "disetujui"` with `pdfUrl: null` via the Firestore console, open it as the requester, click "Coba Generate PDF", and confirm the same result.

---

## Self-Review Notes

- Spec coverage: library choice (jsPDF+html2canvas, reusing the existing template), trigger (approver on approve + requester retry), file structure (`lib/pdf/pdfTemplate.ts`, `generateSubmissionPdfClient.ts`, `generateAndAttachSubmissionPdf.ts`), the new `disetujui → siap_dikirim` rules branch (approver-or-requester, `pdfUrl` required, field-restricted via `hasOnly`), full deletion of the 3 now-dead Cloud-Function files, testing approach (port existing template tests as-is, add real tests for `computePdfPageSlices`, everything DOM-dependent written-but-unverified) — all covered.
- Type consistency: `SubmissionPdfData`/`SubmissionPdfItem` (from Task 1) are imported and used identically in Task 2 (`generateSubmissionPdfClient`) and Task 3 (`generateAndAttachSubmissionPdf`). `GenerateSubmissionPdfResult`'s `{ pdfUrl: string }` shape (Task 2) matches how Task 3 destructures it (`const { pdfUrl } = await generateSubmissionPdfClient(...)`). `generateAndAttachSubmissionPdf`'s `(submissionId: string, caller: AppUser)` signature (Task 3) matches both call sites exactly: Task 5's `generateAndAttachSubmissionPdf(input.submissionId, caller)` and Task 6's `generateAndAttachSubmissionPdf(submission.id, appUser)`.
- The `firestore.rules` field written by `generateAndAttachSubmissionPdf`'s `batch.update` (Task 3: exactly `{status, pdfUrl}`) matches the new rule branch's `hasOnly(['status', 'pdfUrl'])` (Task 4) exactly — no legitimate write path is blocked by the new restriction.
- The one thing this plan cannot verify at all — the actual visual/technical correctness of `html2canvas` capturing Drive-hosted signature images and Google-Fonts-rendered text — is explicitly flagged (in the design spec, in Task 2's code comment, and in Task 8's manual verification instructions) rather than silently assumed to work.
