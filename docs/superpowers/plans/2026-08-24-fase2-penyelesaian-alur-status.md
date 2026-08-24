# Fase 2: Penyelesaian Alur Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the submission status pipeline so an approved submission automatically gets a generated PDF, can be marked as sent to GA, and can be marked done — closing the loop from `disetujui` through `siap_dikirim` → `on_proses_ga` → `selesai`.

**Architecture:** Three new Cloud Functions (`generateSubmissionPdf` as a Firestore `onDocumentUpdated` trigger, `confirmSentToGa` and `markAsDone` as callables, both following the existing `reviewSubmission.ts` pattern), plus a small extension to `reviewSubmission` so approvers capture their own signature (reusing the existing `SignaturePad`/`FileUpload` components), plus a fix to the submission-number format to match the real GA form. PDF rendering is isolated into a pure HTML-building function (fully unit-testable, no browser needed) and a thin Puppeteer wrapper (tested with a fully mocked Puppeteer/Chromium, matching how `googleDrive.ts` is tested by mocking `googleapis`).

**Tech Stack:** Firebase Cloud Functions (2nd gen, TypeScript), Firestore, Zod, `puppeteer-core` + `@sparticuz/chromium` (production) / `puppeteer` (local emulator only), Google Drive API (`googleapis`, already wired), Vitest + `@firebase/rules-unit-testing` + `firebase-functions-test`, Next.js App Router + React Hook Form.

**Spec:** `docs/superpowers/specs/2026-08-24-fase2-penyelesaian-alur-status-design.md`

---

## Task 1: Fix submission-number format

**Files:**
- Modify: `functions/src/counters.ts`
- Test: `functions/src/counters.test.ts`
- Modify: `functions/src/submitSubmission.test.ts:85`

- [ ] **Step 1: Update the failing tests to expect the new format**

Edit `functions/src/counters.test.ts` — replace the three `expect(...).toBe(...)` assertions:

```ts
  it("starts at 001 for a new branch-month key", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const number = await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    expect(number).toBe("L.001/TSI-OPR/WHO/VIII/2026");
  });

  it("increments on the second call for the same branch-month", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    const second = await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    expect(second).toBe("L.002/TSI-OPR/WHO/VIII/2026");
  });

  it("keeps separate counters per branch", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    const whp = await getNextSubmissionNumber(db as any, "WHP", 2026, 8);
    expect(whp).toBe("L.001/TSI-OPR/WHP/VIII/2026");
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run counters.test.ts`
Expected: FAIL — actual values still `"001/WHO/VIII/2026"` etc. (old format).

- [ ] **Step 3: Update `getNextSubmissionNumber`**

Edit `functions/src/counters.ts`, the `return` line at the end of the function:

```ts
  const counterPadded = String(nextNumber).padStart(3, "0");
  return `L.${counterPadded}/TSI-OPR/${branch}/${ROMAN_MONTHS[month - 1]}/${year}`;
```

(replaces the previous `return \`${counterPadded}/${branch}/${ROMAN_MONTHS[month - 1]}/${year}\`;`)

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run counters.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Fix the now-stale regex in `submitSubmission.test.ts`**

Edit `functions/src/submitSubmission.test.ts:85` — change:

```ts
    expect(result.submissionNumber).toMatch(/^001\/WHO\/[IVX]+\/\d{4}$/);
```
to:
```ts
    expect(result.submissionNumber).toMatch(/^L\.001\/TSI-OPR\/WHO\/[IVX]+\/\d{4}$/);
```

- [ ] **Step 6: Run the full functions test suite**

Run: `cd functions && npx vitest run`
Expected: PASS (all suites, including `submitSubmission.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add functions/src/counters.ts functions/src/counters.test.ts functions/src/submitSubmission.test.ts
git commit -m "fix: submission number format matches real GA form (L.xxx/TSI-OPR/branch/month/year)"
```

---

## Task 2: Add `approverSignatureUrl` to the review schema

**Files:**
- Modify: `lib/schemas/submission.ts`
- Modify: `functions/src/schemas.ts`
- Test: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Write the failing tests**

Edit `lib/schemas/submission.test.ts`, inside `describe("reviewSubmissionSchema", ...)`: update the two existing approve-case tests to include a signature, and add two new tests.

Replace:
```ts
  it("accepts approve without rejectionNote", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(true);
  });

  it("accepts approve with rejectionNote null (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve", rejectionNote: null });
    expect(result.success).toBe(true);
  });
```
with:
```ts
  it("accepts approve without rejectionNote, given an approverSignatureUrl", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      approverSignatureUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
  });

  it("accepts approve with rejectionNote null (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      rejectionNote: null,
      approverSignatureUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
  });

  it("rejects approve without approverSignatureUrl", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(false);
  });

  it("rejects approve with approverSignatureUrl null", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      approverSignatureUrl: null,
    });
    expect(result.success).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to confirm the new/changed ones fail**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL on the 4 approve-related tests (schema doesn't know about `approverSignatureUrl` yet, so the two "accepts" tests fail because the field is silently stripped but that doesn't matter here — the two "rejects" tests fail because there's currently nothing to reject).

- [ ] **Step 3: Update the schema in `lib/schemas/submission.ts`**

Replace the `reviewSubmissionSchema` export:

```ts
export const reviewSubmissionSchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    rejectionNote: z.string().nullish(),
    approverSignatureUrl: z.string().url().nullish(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  })
  .refine((data) => data.decision !== "approve" || !!data.approverSignatureUrl, {
    message: "Tanda tangan approver wajib diisi saat approve",
    path: ["approverSignatureUrl"],
  });
```

- [ ] **Step 4: Apply the identical change to `functions/src/schemas.ts`**

Replace the `reviewSubmissionSchema` export there with the same object shown in Step 3 (this file has no dedicated test — it's exercised indirectly via `reviewSubmission.test.ts` in Task 3).

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Verify the whole client build still compiles**

Run: `npm run build`
Expected: succeeds (this will currently still pass — `app/(dashboard)/persetujuan/page.tsx` doesn't call `reviewSubmission` with the new required field yet, but it also doesn't import `reviewSubmissionSchema` for client-side validation, so nothing breaks yet; that page is fixed in Task 5).

- [ ] **Step 7: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts functions/src/schemas.ts
git commit -m "feat: require approverSignatureUrl on approve in reviewSubmissionSchema"
```

---

## Task 3: Persist `approverSignatureUrl` in `reviewSubmission`

**Files:**
- Modify: `functions/src/reviewSubmission.ts`
- Test: `functions/src/reviewSubmission.test.ts`

- [ ] **Step 1: Update/add the failing tests**

Edit `functions/src/reviewSubmission.test.ts`. First, update the existing approve test (it will start failing once the schema requires a signature) — replace:

```ts
  it("approves and sets approverId/approverRole/status", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-3", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await reviewSubmissionHandler({ submissionId: "sub-3", decision: "approve" }, { auth: { uid: "uid-spv" } } as any);

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("disetujui");
    expect(updated.data()!.approverId).toBe("uid-spv");
    expect(updated.data()!.approverRole).toBe("spv");
  });
```
with:
```ts
  it("approves and sets approverId/approverRole/approverSignatureUrl/status", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-3", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await reviewSubmissionHandler(
      { submissionId: "sub-3", decision: "approve", approverSignatureUrl: "data:image/png;base64,aGVsbG8=" },
      { auth: { uid: "uid-spv" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("disetujui");
    expect(updated.data()!.approverId).toBe("uid-spv");
    expect(updated.data()!.approverRole).toBe("spv");
    expect(updated.data()!.approverSignatureUrl).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("rejects approve without approverSignatureUrl", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-3b", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-3b", decision: "approve" }, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run reviewSubmission.test.ts`
Expected: FAIL — `approverSignatureUrl` is `undefined` on the updated doc; the new rejection test throws a Zod parse error already (that part may already pass since Task 2 changed the shared schema), but the first test fails on the new assertion.

- [ ] **Step 3: Persist the field in the handler**

Edit `functions/src/reviewSubmission.ts`, inside the `if (input.decision === "approve")` branch — add `approverSignatureUrl` to the update:

```ts
  if (input.decision === "approve") {
    batch.update(submissionRef, {
      status: "disetujui",
      approverId: context.auth.uid,
      approverRole: caller.role,
      approverSignatureUrl: input.approverSignatureUrl,
      approvedAt: FieldValue.serverTimestamp(),
      reviewedAt: FieldValue.serverTimestamp(),
    });
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run reviewSubmission.test.ts`
Expected: PASS (7 tests: 5 original + 2 new/changed).

- [ ] **Step 5: Commit**

```bash
git add functions/src/reviewSubmission.ts functions/src/reviewSubmission.test.ts
git commit -m "feat: persist approverSignatureUrl when a submission is approved"
```

---

## Task 4: Let SPV/Management use `uploadFile`

Approvers need to upload a signature PNG the same way requesters do, but `uploadFileHandler` currently only allows `admin_cabang`/`snd`.

**Files:**
- Modify: `functions/src/uploadFile.ts`
- Test: `functions/src/uploadFile.test.ts`

- [ ] **Step 1: Update the failing test**

Edit `functions/src/uploadFile.test.ts` — the existing negative test currently proves `spv` is rejected, which will no longer be true. Replace:

```ts
  it("rejects when caller role is not admin_cabang/snd", async () => {
    await seedUser("uid-spv", "spv");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-spv" } } as any)).rejects.toThrow(HttpsError);
  });
```
with:
```ts
  it("rejects when caller role is not admin_cabang/snd/spv/management", async () => {
    await seedUser("uid-superadmin", "superadmin");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-superadmin" } } as any)).rejects.toThrow(
      HttpsError
    );
  });

  it("allows spv and management to upload (needed for approver signature capture)", async () => {
    await seedUser("uid-spv", "spv");
    uploadToDriveMock.mockResolvedValue({ fileId: "file-3", webViewLink: "https://drive.google.com/file/d/file-3/view" });
    const { uploadFileHandler } = await import("./uploadFile");
    const result = await uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-spv" } } as any);
    expect(result.fileId).toBe("file-3");
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run uploadFile.test.ts`
Expected: FAIL — the renamed test fails (spv is currently still accepted... wait, currently spv is rejected today, so actually re-check: today's code rejects spv, so the *new* "allows spv" test fails; the renamed "superadmin rejected" test currently passes already since superadmin was never allowed). Net: 1 failing test (the new "allows spv" one).

- [ ] **Step 3: Widen the role check**

Edit `functions/src/uploadFile.ts`:

```ts
  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["admin_cabang", "snd", "spv", "management"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya admin cabang, SND, SPV, atau Management yang bisa upload file.");
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run uploadFile.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/uploadFile.ts functions/src/uploadFile.test.ts
git commit -m "feat: allow spv/management to use uploadFile for approver signatures"
```

---

## Task 5: Approver signature capture UI on Antrian Persetujuan

**Files:**
- Modify: `app/(dashboard)/persetujuan/page.tsx`

No automated test for this task — pure client UI wiring a live Cloud Function, consistent with how `SignaturePad`/`FileUpload` were verified manually elsewhere in this project rather than unit tested. Step 3 below is a manual smoke test.

- [ ] **Step 1: Add signature state, imports, and wire it into `handleDecision`**

Edit `app/(dashboard)/persetujuan/page.tsx`:

Add to the imports:
```ts
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
import { Label } from "@/components/ui/label";
```

Add new state alongside the existing `noteBySubmission`/`busyId` state:
```ts
  const [signatureModeBySubmission, setSignatureModeBySubmission] = useState<Record<string, "gambar" | "upload">>({});
  const [signatureUrlBySubmission, setSignatureUrlBySubmission] = useState<Record<string, string>>({});
```

Replace `handleDecision` to include the signature on approve:
```ts
  async function handleDecision(submissionId: string, decision: "approve" | "reject") {
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      const reviewSubmission = httpsCallable(functions, "reviewSubmission");
      await reviewSubmission({
        submissionId,
        decision,
        rejectionNote: noteBySubmission[submissionId],
        approverSignatureUrl: decision === "approve" ? signatureUrlBySubmission[submissionId] : undefined,
      });
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [submissionId]: err instanceof Error ? err.message : "Gagal memproses review.",
      }));
    } finally {
      setBusyId(null);
    }
  }
```

- [ ] **Step 2: Render the signature capture UI per row and gate the "Setujui" button on it**

Edit `app/(dashboard)/persetujuan/page.tsx` — insert a new block between the `<Textarea>` and the action-error paragraph, and change the "Setujui" `<Button>`'s `disabled` prop:

```tsx
            <div className="space-y-2">
              <Label>Tanda Tangan Approver</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={(signatureModeBySubmission[row.id] ?? "gambar") === "gambar" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSignatureModeBySubmission((prev) => ({ ...prev, [row.id]: "gambar" }))}
                >
                  Gambar
                </Button>
                <Button
                  type="button"
                  variant={signatureModeBySubmission[row.id] === "upload" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSignatureModeBySubmission((prev) => ({ ...prev, [row.id]: "upload" }))}
                >
                  Upload File
                </Button>
              </div>
              {(signatureModeBySubmission[row.id] ?? "gambar") === "gambar" ? (
                <SignaturePad
                  onChange={(dataUrl) =>
                    setSignatureUrlBySubmission((prev) => ({ ...prev, [row.id]: dataUrl ?? "" }))
                  }
                />
              ) : (
                <FileUpload
                  purpose="signature"
                  onUploaded={(file) =>
                    setSignatureUrlBySubmission((prev) => ({ ...prev, [row.id]: file.fileUrl }))
                  }
                />
              )}
            </div>
```

And change:
```tsx
              <Button size="sm" disabled={busyId === row.id} onClick={() => handleDecision(row.id, "approve")}>
                Setujui
              </Button>
```
to:
```tsx
              <Button
                size="sm"
                disabled={busyId === row.id || !signatureUrlBySubmission[row.id]}
                onClick={() => handleDecision(row.id, "approve")}
              >
                Setujui
              </Button>
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 4: Manual smoke test**

With Auth+Firestore+Functions emulators running (`firebase emulators:start`) and seed data loaded (`npm run seed`):
1. Log in as `admin.who@example.com` / `password123`, create a submission at `/pengajuan/new` (any type), submit it.
2. Log out, log in as `spv@example.com` / `password123`, go to `/persetujuan`.
3. Confirm the "Setujui" button is disabled until a signature is drawn or uploaded.
4. Draw a signature, confirm the button becomes enabled, click "Setujui".
5. Confirm no error appears and the row disappears from the queue (status left `diajukan`).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/persetujuan/page.tsx"
git commit -m "feat: capture approver signature on Antrian Persetujuan before approve"
```

---

## Task 6: `buildSubmissionPdfHtml` — pure HTML template function

**Files:**
- Create: `functions/src/pdf/buildSubmissionPdfHtml.ts`
- Test: `functions/src/pdf/buildSubmissionPdfHtml.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/pdf/buildSubmissionPdfHtml.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run pdf/buildSubmissionPdfHtml.test.ts`
Expected: FAIL with "Cannot find module './buildSubmissionPdfHtml'".

- [ ] **Step 3: Implement `buildSubmissionPdfHtml`**

Create `functions/src/pdf/buildSubmissionPdfHtml.ts`:

```ts
export interface SubmissionPdfItem {
  itemName: string;
  brandType: string;
  km: number | null;
  quantity: number;
  unit: string;
  description: string;
}

export interface SubmissionPdfData {
  submissionNumber: string;
  submittedAt: Date;
  type: "kendaraan" | "perlengkapan";
  branch: string;
  department: string;
  position: string;
  requesterName: string;
  requesterSignatureUrl: string;
  approverName: string;
  approverPosition: string;
  approverSignatureUrl: string;
  items: SubmissionPdfItem[];
}

const TYPE_LABELS: Record<SubmissionPdfData["type"], string> = {
  kendaraan: "Kendaraan",
  perlengkapan: "Perlengkapan",
};

const TOTAL_ROWS = 14;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTanggal(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(date);
}

function buildItemRow(item: SubmissionPdfItem): string {
  return `<tr class="item-row">
    <td>${escapeHtml(item.itemName)}</td>
    <td>${escapeHtml(item.brandType)}</td>
    <td>${item.km ?? "-"}</td>
    <td>${item.quantity}</td>
    <td>${escapeHtml(item.unit)}</td>
    <td>${escapeHtml(item.description)}</td>
  </tr>`;
}

function buildBlankRow(): string {
  return `<tr class="blank-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`;
}

export function buildSubmissionPdfHtml(data: SubmissionPdfData): string {
  const itemRows = data.items.map(buildItemRow).join("");
  const blankRowCount = Math.max(0, TOTAL_ROWS - data.items.length);
  const blankRows = Array.from({ length: blankRowCount }, buildBlankRow).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 24px; }
  table { border-collapse: collapse; width: 100%; }
  .header-table td { vertical-align: top; padding: 4px; }
  .header-title { text-align: right; font-weight: bold; font-size: 16px; }
  .header-subtitle { text-align: right; font-size: 12px; }
  .info-table td { border: 1px solid #333; padding: 4px 8px; }
  .info-table td.label { width: 160px; background: #f3f3f3; }
  .items-table { margin-top: 12px; }
  .items-table th, .items-table td { border: 1px solid #333; padding: 4px 6px; text-align: left; }
  .items-table th { background: #f3f3f3; }
  .signature-table { margin-top: 32px; }
  .signature-table td { text-align: center; padding: 8px; width: 50%; }
  .signature-table img { height: 60px; margin: 8px 0; }
</style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td style="width: 60%;">
        Kepada Yth,<br>
        Departemen General Affair<br>
        PT TRIDAYA SINERGI INDONESIA
      </td>
      <td>
        <div class="header-title">FORMULIR PERMOHONAN</div>
        <div class="header-subtitle">DIVISI GENERAL AFFAIR</div>
        <table style="margin-top: 8px;">
          <tr><td>Nomor Permintaan</td><td style="border: 1px solid #333;">${escapeHtml(data.submissionNumber)}</td></tr>
          <tr><td>Tanggal</td><td style="border: 1px solid #333;">${formatTanggal(data.submittedAt)}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <table class="info-table" style="margin-top: 16px;">
    <tr><td class="label">Nama Pemohon</td><td>${escapeHtml(data.requesterName)}</td></tr>
    <tr><td class="label">Departemen</td><td>${escapeHtml(data.department)}</td></tr>
    <tr><td class="label">Warehouse</td><td>${escapeHtml(data.branch)}</td></tr>
    <tr><td class="label">Jabatan</td><td>${escapeHtml(data.position)}</td></tr>
    <tr><td class="label">Jenis Permohonan</td><td>${TYPE_LABELS[data.type]}</td></tr>
  </table>

  <table class="items-table">
    <thead>
      <tr>
        <th>Nama Barang</th>
        <th>Merk / Type</th>
        <th>KM</th>
        <th>Jumlah</th>
        <th>Satuan</th>
        <th>Deskripsi</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${blankRows}
    </tbody>
  </table>

  <table class="signature-table">
    <tr>
      <td>
        Dibuat Oleh,<br>
        <img src="${data.requesterSignatureUrl}" alt="Tanda tangan pemohon"><br>
        ${escapeHtml(data.requesterName)}<br>
        Pemohon
      </td>
      <td>
        Mengetahui,<br>
        <img src="${data.approverSignatureUrl}" alt="Tanda tangan approver"><br>
        ${escapeHtml(data.approverName)}<br>
        ${escapeHtml(data.approverPosition)}
      </td>
    </tr>
  </table>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run pdf/buildSubmissionPdfHtml.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/pdf/buildSubmissionPdfHtml.ts functions/src/pdf/buildSubmissionPdfHtml.test.ts
git commit -m "feat: add buildSubmissionPdfHtml, pure HTML template for the GA form PDF"
```

---

## Task 7: `renderPdfBuffer` — Puppeteer wrapper

**Files:**
- Create: `functions/src/pdf/renderPdfBuffer.ts`
- Test: `functions/src/pdf/renderPdfBuffer.test.ts`
- Modify: `functions/package.json` (via `npm install`)

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd functions
npm install puppeteer-core @sparticuz/chromium
npm install --save-dev puppeteer
cd ..
```
Expected: `functions/package.json` gains `puppeteer-core` and `@sparticuz/chromium` under `dependencies`, and `puppeteer` under `devDependencies`.

- [ ] **Step 2: Write the failing tests**

Create `functions/src/pdf/renderPdfBuffer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const newPage = vi.fn();
const pagePdf = vi.fn();
const pageSetContent = vi.fn();
const browserClose = vi.fn();
const puppeteerLaunch = vi.fn();
const puppeteerCoreLaunch = vi.fn();
const chromiumExecutablePath = vi.fn();

vi.mock("puppeteer", () => ({
  default: { launch: puppeteerLaunch },
}));
vi.mock("puppeteer-core", () => ({
  default: { launch: puppeteerCoreLaunch },
}));
vi.mock("@sparticuz/chromium", () => ({
  default: { args: ["--no-sandbox"], executablePath: chromiumExecutablePath },
}));

function makeBrowser() {
  pageSetContent.mockReset();
  pagePdf.mockReset().mockResolvedValue(new Uint8Array(Buffer.from("PDF-DATA")));
  newPage.mockReset().mockResolvedValue({ setContent: pageSetContent, pdf: pagePdf });
  browserClose.mockReset();
  return { newPage, close: browserClose };
}

describe("renderPdfBuffer", () => {
  beforeEach(() => {
    puppeteerLaunch.mockReset();
    puppeteerCoreLaunch.mockReset();
    chromiumExecutablePath.mockReset().mockResolvedValue("/opt/chromium/chromium");
    delete process.env.FUNCTIONS_EMULATOR;
  });

  it("uses the full puppeteer package (bundled Chromium) when running in the emulator", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    puppeteerLaunch.mockResolvedValue(makeBrowser());
    const { renderPdfBuffer } = await import("./renderPdfBuffer");
    await renderPdfBuffer("<html></html>");
    expect(puppeteerLaunch).toHaveBeenCalledWith({ headless: true });
    expect(puppeteerCoreLaunch).not.toHaveBeenCalled();
  });

  it("uses puppeteer-core + @sparticuz/chromium when not running in the emulator", async () => {
    puppeteerCoreLaunch.mockResolvedValue(makeBrowser());
    const { renderPdfBuffer } = await import("./renderPdfBuffer");
    await renderPdfBuffer("<html></html>");
    expect(puppeteerCoreLaunch).toHaveBeenCalledWith({
      args: ["--no-sandbox"],
      executablePath: "/opt/chromium/chromium",
      headless: true,
    });
    expect(puppeteerLaunch).not.toHaveBeenCalled();
  });

  it("renders the given HTML, returns a PDF buffer, and closes the browser", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    puppeteerLaunch.mockResolvedValue(makeBrowser());
    const { renderPdfBuffer } = await import("./renderPdfBuffer");
    const result = await renderPdfBuffer("<html><body>Hi</body></html>");
    expect(pageSetContent).toHaveBeenCalledWith("<html><body>Hi</body></html>", { waitUntil: "networkidle0" });
    expect(pagePdf).toHaveBeenCalledWith({ format: "a4", printBackground: true });
    expect(browserClose).toHaveBeenCalled();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe("PDF-DATA");
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run pdf/renderPdfBuffer.test.ts`
Expected: FAIL with "Cannot find module './renderPdfBuffer'".

- [ ] **Step 4: Implement `renderPdfBuffer`**

Create `functions/src/pdf/renderPdfBuffer.ts`:

```ts
// @sparticuz/chromium's bundled binary only runs on the Linux container Cloud
// Functions deploys to — it doesn't run on a developer's Windows/macOS machine.
// FUNCTIONS_EMULATOR is set automatically by the Firebase emulator, so locally
// we launch the full `puppeteer` package instead, which downloads its own
// Chromium that actually runs on the dev machine.
export async function renderPdfBuffer(html: string): Promise<Buffer> {
  const browser =
    process.env.FUNCTIONS_EMULATOR === "true" ? await launchLocalBrowser() : await launchProductionBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfData = await page.pdf({ format: "a4", printBackground: true });
    return Buffer.from(pdfData);
  } finally {
    await browser.close();
  }
}

async function launchLocalBrowser() {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({ headless: true });
}

async function launchProductionBrowser() {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run pdf/renderPdfBuffer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/pdf/renderPdfBuffer.ts functions/src/pdf/renderPdfBuffer.test.ts
git commit -m "feat: add renderPdfBuffer, Puppeteer wrapper with emulator/production browser switch"
```

---

## Task 8: `generateSubmissionPdf` — Firestore trigger

**Files:**
- Create: `functions/src/generateSubmissionPdf.ts`
- Test: `functions/src/generateSubmissionPdf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/generateSubmissionPdf.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-pdf-test";

const fft = functionsTest({ projectId: "demo-pengajuan-pdf-test" }, undefined);
let testEnv: RulesTestEnvironment;

const renderPdfBufferMock = vi.fn();
vi.mock("./pdf/renderPdfBuffer", () => ({ renderPdfBuffer: renderPdfBufferMock }));

const uploadToDriveMock = vi.fn();
vi.mock("./googleDrive", () => ({ uploadToDrive: uploadToDriveMock }));

async function seedUser(uid: string, overrides: Record<string, unknown> = {}) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "Default Name",
    email: "d@x.com",
    role: "admin_cabang",
    branch: "WHO",
    department: "Operasional",
    position: "Admin",
    createdAt: new Date(),
    ...overrides,
  });
}

async function seedItems(submissionId: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin
    .collection("submissions")
    .doc(submissionId)
    .collection("items")
    .add({ itemName: "Mobil", brandType: "Grandmax Box D 8706 FN", km: 151995, quantity: 1, unit: "Unit", description: "Service Berkala" });
}

const AFTER_DISETUJUI = {
  status: "disetujui",
  submissionNumber: "L.001/TSI-OPR/WHO/VIII/2026",
  type: "kendaraan",
  branch: "WHO",
  department: "Operasional",
  position: "Admin",
  requesterId: "uid-requester",
  requesterSignatureUrl: "data:image/png;base64,aGVsbG8=",
  approverId: "uid-approver",
  approverSignatureUrl: "data:image/png;base64,d29ybGQ=",
  submittedAt: { toDate: () => new Date("2026-08-21T00:00:00Z") },
};

describe("generateSubmissionPdfHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-pdf-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    renderPdfBufferMock.mockReset();
    uploadToDriveMock.mockReset();
  });

  afterAll(() => fft.cleanup());

  it("does nothing when status was already disetujui before the update", async () => {
    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    await generateSubmissionPdfHandler("sub-1", { status: "disetujui" }, { status: "disetujui" });
    expect(renderPdfBufferMock).not.toHaveBeenCalled();
  });

  it("does nothing when the new status isn't disetujui", async () => {
    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    await generateSubmissionPdfHandler("sub-2", { status: "diajukan" }, { status: "perlu_revisi" });
    expect(renderPdfBufferMock).not.toHaveBeenCalled();
  });

  it("generates a PDF, uploads it to Drive, and transitions status to siap_dikirim", async () => {
    await seedUser("uid-requester", { name: "Rahmat Agus Tiyan" });
    await seedUser("uid-approver", { name: "Rizki Trihatanto", position: "Kepala Departemen", role: "spv" });
    await seedItems("sub-3");
    renderPdfBufferMock.mockResolvedValue(Buffer.from("PDF-BYTES"));
    uploadToDriveMock.mockResolvedValue({
      fileId: "pdf-file-1",
      webViewLink: "https://drive.google.com/file/d/pdf-file-1/view",
    });

    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    await generateSubmissionPdfHandler("sub-3", { status: "diajukan" }, AFTER_DISETUJUI);

    expect(uploadToDriveMock).toHaveBeenCalledWith({
      fileName: "Formulir - L.001/TSI-OPR/WHO/VIII/2026.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("PDF-BYTES"),
    });

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("siap_dikirim");
    expect(updated.data()!.pdfUrl).toBe("https://drive.google.com/file/d/pdf-file-1/view");

    const history = await admin.collection("submissions").doc("sub-3").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "siap_dikirim" && d.data().actorId === "system")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run generateSubmissionPdf.test.ts`
Expected: FAIL with "Cannot find module './generateSubmissionPdf'".

- [ ] **Step 3: Implement the handler**

Create `functions/src/generateSubmissionPdf.ts`:

```ts
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdf/buildSubmissionPdfHtml";
import { renderPdfBuffer } from "./pdf/renderPdfBuffer";
import { uploadToDrive } from "./googleDrive";

export async function generateSubmissionPdfHandler(
  submissionId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  if (before.status === "disetujui" || after.status !== "disetujui") {
    return;
  }

  const submissionRef = db.collection("submissions").doc(submissionId);
  const [itemsSnap, requesterSnap, approverSnap] = await Promise.all([
    submissionRef.collection("items").get(),
    db.collection("users").doc(after.requesterId).get(),
    db.collection("users").doc(after.approverId).get(),
  ]);

  const requester = requesterSnap.data();
  const approver = approverSnap.data();
  const submittedAt: Date =
    after.submittedAt && typeof after.submittedAt.toDate === "function" ? after.submittedAt.toDate() : new Date();

  const pdfData: SubmissionPdfData = {
    submissionNumber: after.submissionNumber,
    submittedAt,
    type: after.type,
    branch: after.branch,
    department: after.department,
    position: after.position,
    requesterName: requester?.name ?? "-",
    requesterSignatureUrl: after.requesterSignatureUrl,
    approverName: approver?.name ?? "-",
    approverPosition: approver?.position ?? "-",
    approverSignatureUrl: after.approverSignatureUrl,
    items: itemsSnap.docs.map((docSnap) => {
      const item = docSnap.data();
      return {
        itemName: item.itemName,
        brandType: item.brandType,
        km: item.km ?? null,
        quantity: item.quantity,
        unit: item.unit,
        description: item.description,
      };
    }),
  };

  const html = buildSubmissionPdfHtml(pdfData);
  const pdfBuffer = await renderPdfBuffer(html);
  const { webViewLink } = await uploadToDrive({
    fileName: `Formulir - ${after.submissionNumber}.pdf`,
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const batch = db.batch();
  batch.update(submissionRef, { pdfUrl: webViewLink, status: "siap_dikirim" });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: "PDF digenerate otomatis",
    actorId: "system",
    actorRole: "system",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run generateSubmissionPdf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/generateSubmissionPdf.ts functions/src/generateSubmissionPdf.test.ts
git commit -m "feat: add generateSubmissionPdfHandler"
```

---

## Task 9: `confirmSentToGa` callable

**Files:**
- Modify: `functions/src/schemas.ts`
- Modify: `lib/schemas/submission.ts`
- Create: `functions/src/confirmSentToGa.ts`
- Test: `functions/src/confirmSentToGa.test.ts`

- [ ] **Step 1: Add the shared `submissionActionSchema`**

Edit `functions/src/schemas.ts` — add near the bottom, after `uploadFileSchema`:

```ts
export const submissionActionSchema = z.object({
  submissionId: z.string().min(1),
});

export type SubmissionActionInput = z.infer<typeof submissionActionSchema>;
```

Apply the identical addition to `lib/schemas/submission.ts` (used by the client for type inference; no dedicated client test needed since it's a trivial single-field object already implicitly covered by `createSubmissionSchema`'s pattern).

- [ ] **Step 2: Write the failing tests**

Create `functions/src/confirmSentToGa.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-confirm-test";

const fft = functionsTest({ projectId: "demo-pengajuan-confirm-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

async function seedSubmission(id: string, status: string, requesterId = "uid-requester") {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "L.001/TSI-OPR/WHO/VIII/2026",
    status,
    requesterId,
    branch: "WHO",
  });
}

describe("confirmSentToGaHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-confirm-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not authenticated", async () => {
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(confirmSentToGaHandler({ submissionId: "sub-1" }, { auth: undefined })).rejects.toThrow(HttpsError);
  });

  it("rejects when caller isn't the submission's requester", async () => {
    await seedUser("uid-other", "admin_cabang");
    await seedSubmission("sub-2", "siap_dikirim");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-other" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't siap_dikirim", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-3", "diajukan");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-requester" } } as any)
    ).rejects.toThrow(/siap_dikirim/);
  });

  it("sets status on_proses_ga and sentToGaAt when the requester confirms", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-4", "siap_dikirim");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await confirmSentToGaHandler({ submissionId: "sub-4" }, { auth: { uid: "uid-requester" } } as any);

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-4").get();
    expect(updated.data()!.status).toBe("on_proses_ga");
    expect(updated.data()!.sentToGaAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-4").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "on_proses_ga" && d.data().actorId === "uid-requester")).toBe(
      true
    );
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run confirmSentToGa.test.ts`
Expected: FAIL with "Cannot find module './confirmSentToGa'".

- [ ] **Step 4: Implement the handler**

Create `functions/src/confirmSentToGa.ts`:

```ts
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { submissionActionSchema } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function confirmSentToGaHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = submissionActionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { submissionId } = parsed.data;

  const submissionRef = db.collection("submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();
  if (!submission) {
    throw new HttpsError("not-found", "Pengajuan tidak ditemukan.");
  }
  if (submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Hanya pemilik pengajuan yang bisa mengonfirmasi ini.");
  }
  if (submission.status !== "siap_dikirim") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus siap_dikirim yang bisa dikonfirmasi.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, { status: "on_proses_ga", sentToGaAt: FieldValue.serverTimestamp() });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "on_proses_ga",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? "unknown",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId, status: "on_proses_ga" as const };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run confirmSentToGa.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add functions/src/schemas.ts lib/schemas/submission.ts functions/src/confirmSentToGa.ts functions/src/confirmSentToGa.test.ts
git commit -m "feat: add confirmSentToGa callable"
```

---

## Task 10: `markAsDone` callable

**Files:**
- Create: `functions/src/markAsDone.ts`
- Test: `functions/src/markAsDone.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/markAsDone.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-done-test";

const fft = functionsTest({ projectId: "demo-pengajuan-done-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

async function seedSubmission(id: string, status: string, requesterId = "uid-requester") {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "L.001/TSI-OPR/WHO/VIII/2026",
    status,
    requesterId,
    branch: "WHO",
  });
}

describe("markAsDoneHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-done-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not authenticated", async () => {
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(markAsDoneHandler({ submissionId: "sub-1" }, { auth: undefined })).rejects.toThrow(HttpsError);
  });

  it("rejects when caller isn't the submission's requester, even if superadmin", async () => {
    await seedUser("uid-superadmin", "superadmin");
    await seedSubmission("sub-2", "on_proses_ga");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-superadmin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't on_proses_ga", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-3", "siap_dikirim");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-requester" } } as any)
    ).rejects.toThrow(/on_proses_ga/);
  });

  it("sets status selesai and completedAt when the requester marks it done", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-4", "on_proses_ga");
    const { markAsDoneHandler } = await import("./markAsDone");
    await markAsDoneHandler({ submissionId: "sub-4" }, { auth: { uid: "uid-requester" } } as any);

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-4").get();
    expect(updated.data()!.status).toBe("selesai");
    expect(updated.data()!.completedAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-4").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "selesai" && d.data().actorId === "uid-requester")).toBe(
      true
    );
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd functions && npx vitest run markAsDone.test.ts`
Expected: FAIL with "Cannot find module './markAsDone'".

- [ ] **Step 3: Implement the handler**

Create `functions/src/markAsDone.ts`:

```ts
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { submissionActionSchema } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function markAsDoneHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = submissionActionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { submissionId } = parsed.data;

  const submissionRef = db.collection("submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();
  if (!submission) {
    throw new HttpsError("not-found", "Pengajuan tidak ditemukan.");
  }
  // Only the requester may mark a submission done — not spv/management/superadmin,
  // even though they can read/review it. This mirrors the rule in CLAUDE.md that
  // "selesai" hanya bisa di-set oleh pemilik pengajuan.
  if (submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Hanya pemilik pengajuan yang bisa menandai selesai.");
  }
  if (submission.status !== "on_proses_ga") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus on_proses_ga yang bisa ditandai selesai.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, { status: "selesai", completedAt: FieldValue.serverTimestamp() });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "selesai",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? "unknown",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId, status: "selesai" as const };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd functions && npx vitest run markAsDone.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/markAsDone.ts functions/src/markAsDone.test.ts
git commit -m "feat: add markAsDone callable"
```

---

## Task 11: Wire the three new functions into `index.ts`

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add the exports**

Edit `functions/src/index.ts` — add imports and three new exports:

```ts
import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { uploadFileHandler } from "./uploadFile";
import { confirmSentToGaHandler } from "./confirmSentToGa";
import { markAsDoneHandler } from "./markAsDone";
import { generateSubmissionPdfHandler } from "./generateSubmissionPdf";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Attachments/signatures arrive as base64 (a 10MB file is ~13MB of base64) and
// are held in memory as a decoded Buffer while being streamed to Drive, so this
// needs more headroom than the default 256MiB/60s callable limits.
//
// Runs as a dedicated service account (rather than the default compute SA)
// because it's the identity shared with the Google Drive folder that holds
// attachments/signatures — see docs/superpowers/specs/2026-08-22-attachments-signature-upload-gdrive-design.md.
export const uploadFile = onCall(
  { memory: "512MiB", timeoutSeconds: 120, serviceAccount: "drive-uploader-dev@sndsupportapps.iam.gserviceaccount.com" },
  (request) => uploadFileHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const confirmSentToGa = onCall((request) =>
  confirmSentToGaHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const markAsDone = onCall((request) =>
  markAsDoneHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Fires when a submission's status transitions to "disetujui", renders the GA
// form PDF, uploads it to the same Drive folder as attachments/signatures, and
// advances status to "siap_dikirim". Runs as the Drive-sharing service account
// (same as uploadFile) since it needs Drive write access.
export const generateSubmissionPdf = onDocumentUpdated(
  {
    document: "submissions/{submissionId}",
    memory: "1GiB",
    timeoutSeconds: 60,
    retry: true,
    serviceAccount: "drive-uploader-dev@sndsupportapps.iam.gserviceaccount.com",
  },
  async (event) => {
    if (!event.data) return;
    await generateSubmissionPdfHandler(
      event.params.submissionId,
      event.data.before.data() ?? {},
      event.data.after.data() ?? {}
    );
  }
);
```

(This replaces the entire previous file content — the `submitSubmission`, `reviewSubmission`, and `uploadFile` exports are unchanged from before, just carried forward alongside the three new ones.)

- [ ] **Step 2: Build the functions package**

Run: `cd functions && npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Run the full functions test suite**

Run: `cd functions && npx vitest run`
Expected: PASS — every suite (`counters`, `submitSubmission`, `reviewSubmission`, `uploadFile`, `googleDrive`, `pdf/buildSubmissionPdfHtml`, `pdf/renderPdfBuffer`, `generateSubmissionPdf`, `confirmSentToGa`, `markAsDone`).

- [ ] **Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: export confirmSentToGa, markAsDone, and generateSubmissionPdf"
```

---

## Task 12: Client UI — PDF link, WA template, confirm/tandai selesai

**Files:**
- Modify: `app/(dashboard)/pengajuan/[id]/page.tsx`

No automated test — pure client UI, consistent with Task 5. Step 3 is a manual smoke test.

- [ ] **Step 1: Add state, Functions wiring, and action handlers**

Edit `app/(dashboard)/pengajuan/[id]/page.tsx` — replace the top of the file (imports through the component's opening state declarations) with:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (error) {
    // connectFunctionsEmulator throws if called again on an already-configured
    // instance (e.g. Next.js Fast Refresh re-evaluating this module).
    console.warn("[functions] Emulator connection skipped (already configured):", error);
  }
}

type SubmissionDoc = DocumentData & { id: string };

export default function PengajuanDetailPage({ params }: { params: { id: string } }) {
  const { appUser } = useAuth();
  const [submission, setSubmission] = useState<SubmissionDoc | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
```

- [ ] **Step 2: Add the action handlers**

Insert these functions after the existing `useEffect` block (before the `if (error) { ... }` early return):

```tsx
  async function handleCopyTemplate() {
    if (!submission || !appUser) return;
    const text = `Yth. Tim GA, mohon diproses pengajuan ${submission.submissionNumber} a.n. ${appUser.name} (${submission.department}). Detail & tanda tangan terlampir di PDF: ${submission.pdfUrl}. Terima kasih.`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  async function handleConfirmSentToGa() {
    if (!submission) return;
    setBusy(true);
    setActionError(null);
    try {
      const confirmSentToGa = httpsCallable(functions, "confirmSentToGa");
      await confirmSentToGa({ submissionId: submission.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengonfirmasi.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkAsDone() {
    if (!submission) return;
    setBusy(true);
    setActionError(null);
    try {
      const markAsDone = httpsCallable(functions, "markAsDone");
      await markAsDone({ submissionId: submission.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menandai selesai.");
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 3: Render the new sections**

Insert this block right after the existing `{submission.status === "perlu_revisi" && (...)}` block, before `<div><h2 className="mb-2 font-medium">Riwayat Status</h2>...`:

```tsx
      {submission.status === "siap_dikirim" && appUser?.uid === submission.requesterId && (
        <div className="space-y-2 rounded border border-blue-300 bg-blue-50 p-3 text-sm">
          <p>PDF formulir sudah siap. Salin template pesan berikut, kirim manual ke GA lewat WhatsApp, lalu konfirmasi di sini.</p>
          <a href={submission.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
            Buka PDF
          </a>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopyTemplate}>
              {copied ? "Tersalin!" : "Copy Template WA"}
            </Button>
            <Button size="sm" disabled={busy} onClick={handleConfirmSentToGa}>
              Konfirmasi Sudah Dikirim
            </Button>
          </div>
        </div>
      )}

      {submission.status === "on_proses_ga" && appUser?.uid === submission.requesterId && (
        <div className="space-y-2 rounded border border-purple-300 bg-purple-50 p-3 text-sm">
          <p>Pengajuan sedang diproses GA. Setelah barang/layanan diterima, tandai selesai.</p>
          <Button size="sm" disabled={busy} onClick={handleMarkAsDone}>
            Tandai Selesai
          </Button>
        </div>
      )}

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 5: Manual smoke test**

With emulators running (`firebase emulators:start`) and seed data loaded (`npm run seed`):
1. As `admin.who@example.com`, create and submit a submission.
2. As `spv@example.com`, approve it with a drawn signature (per Task 5's smoke test).
3. Confirm the Firestore emulator UI (`http://127.0.0.1:4000/firestore`) shows the submission's status eventually become `siap_dikirim` with a non-empty `pdfUrl` (the `generateSubmissionPdf` trigger runs asynchronously — allow a few seconds).
4. Open the `pdfUrl` link from the Functions emulator logs or Firestore UI directly (or visit `/pengajuan/{id}` as `admin.who@example.com`) — confirm "Buka PDF" opens a real PDF that resembles the reference form layout (header, info table, one item row + blank padding rows, both signatures, approver's position label).
5. Click "Copy Template WA" — confirm the button changes to "Tersalin!". Paste the clipboard content somewhere to confirm the text looks right.
6. Click "Konfirmasi Sudah Dikirim" — confirm status becomes `on_proses_ga` and the UI now shows "Tandai Selesai" instead.
7. Click "Tandai Selesai" — confirm status becomes `selesai` and both action sections disappear.
8. Log in as `spv@example.com` and open the same submission — confirm neither the WA section nor "Tandai Selesai" appears (not the requester).

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/pengajuan/[id]/page.tsx"
git commit -m "feat: add PDF link, WA template copy, and confirm/tandai-selesai actions to submission detail"
```

---

## Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite (root + functions)**

Run:
```bash
npm run test
cd functions && npx vitest run && cd ..
```
Expected: PASS across both — root suite (`lib/schemas`, `tests/firestore-rules.test.ts`) and functions suite (all files from Tasks 1–10).

- [ ] **Step 2: Run both builds**

Run:
```bash
npm run build
cd functions && npm run build && cd ..
```
Expected: both succeed with no type errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable if any pre-existing ones aren't touched by this plan).

- [ ] **Step 4: Confirm the end-to-end manual walkthrough from Task 12 Step 5 was completed**

This is the single walkthrough that exercises every function built in this plan together (`reviewSubmission` with signature → `generateSubmissionPdf` trigger → `confirmSentToGa` → `markAsDone`). If it wasn't run yet, run it now.

- [ ] **Step 5: Report deploy-readiness blockers still open**

These are known from the earlier conversation and are **not** part of this plan's scope (infrastructure/account actions, not code) — just confirm they're still accurately tracked, don't attempt to resolve them here:
- Firebase Authentication not yet initialized in the `sndsupportapps` project (needs one manual "Get Started" click in Firebase Console).
- Billing (Blaze plan) not yet confirmed active — required for Cloud Functions 2nd gen deploy.
- `drive-uploader-dev@sndsupportapps.iam.gserviceaccount.com` needs the `roles/logging.logWriter` IAM role granted (Cloud Functions runtime identity needs to write logs).
- No `firebase.json` Hosting/App Hosting config yet for deploying the Next.js frontend itself.
