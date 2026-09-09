# Lampiran Antrian, Semua Pengajuan, & Posisi TTD Bebas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Show lampiran/attachment links on Antrian Persetujuan cards, (2) rename "Pengajuan Saya" to "Semua Pengajuan" and show every submission to every admin/spv with owner-gated action buttons, (3) let the approver drag their signature to any position on the generated PDF before it's finalized, replacing the old fixed-template placement.

**Architecture:** Parts A and B are small, independent UI/query changes. Part C is the big one: split the existing single-shot `generateSubmissionPdfClient` into a "render base canvas" step (template rendered WITHOUT the approver signature) and a "composite signature + build PDF" step (draws the signature onto the canvas at caller-supplied pixel coordinates, then slices/assembles the PDF exactly as before). A new `SignaturePlacementModal` component renders the base canvas as a draggable preview and hands the chosen position to both the approve flow (Antrian Persetujuan) and the existing PDF-retry button (detail page) — one code path for both. Approve becomes a two-step UI flow (write approve → open modal → on confirm, generate PDF with the chosen position) instead of today's fire-and-forget background generation.

**Tech Stack:** Same as the rest of the app — Next.js client components, Firestore client SDK, `html2canvas` + `jsPDF` (already dependencies), plain React pointer events for drag (no new dependency).

**Before starting:** while researching this plan we found a **live production bug** unrelated to the three requests but in a file this plan touches anyway: `lib/pdf/generateAndAttachSubmissionPdf.ts`'s `statusHistory` write omits `submissionNumber`/`employeeName`, which `firestore.rules` (deployed in commit `b074a2c`) now requires on every `statusHistory` create — every other module that writes `statusHistory` already includes these fields; this one file doesn't. This means the automatic PDF generation that's supposed to fire right after every approve has likely been silently failing in production (submission stuck at `disetujui`, never reaching `siap_dikirim`) since that rules deploy. Task 1 fixes this on its own, first, so it can ship independently of the rest of this plan if needed.

---

### Task 1: Fix missing `submissionNumber`/`employeeName` in `generateAndAttachSubmissionPdf`'s statusHistory write

**Files:**
- Modify: `lib/pdf/generateAndAttachSubmissionPdf.ts:72-79`

- [ ] **Step 1: Apply the fix**

In `lib/pdf/generateAndAttachSubmissionPdf.ts`, find:

```ts
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
```

Replace with:

```ts
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
    submissionNumber: submission.submissionNumber,
    employeeName: submission.employeeName,
  });
```

- [ ] **Step 2: Verify against the emulator**

This module talks directly to `db` from `@/lib/firebase/client` (like every other file in `lib/submissions/` and `lib/pdf/`), so per this codebase's existing convention there's no unit test for it — verification is manual against the emulator, same as for `lib/admin/resetAllSubmissions.ts` earlier in this project's history. Start the emulator and run the existing suite to make sure nothing regressed:

Run: `npx firebase emulators:exec --only firestore,auth "npm run test"`
Expected: all tests pass (this file has no direct test, but `tests/firestore-rules.test.ts` exercises the same `statusHistory` create rule this fix satisfies).

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/generateAndAttachSubmissionPdf.ts
git commit -m "$(cat <<'EOF'
fix: include submissionNumber/employeeName on siap_dikirim statusHistory write

Every other module writing statusHistory already includes these fields;
this one didn't, so the anti-spoof rule added in b074a2c has been silently
rejecting this write in production — approve's automatic PDF generation
gets stuck at disetujui and never advances to siap_dikirim.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `AttachmentsList` component (Part A)

**Files:**
- Create: `components/attachments-list/AttachmentsList.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { ExternalLink, Paperclip } from "lucide-react";

type Attachment = { id: string; fileName: string; fileUrl: string };

export function AttachmentsList({ submissionId }: { submissionId: string }) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, "submissions", submissionId, "attachments"))
      .then((snap) => {
        if (cancelled) return;
        setAttachments(
          snap.docs.map((d) => ({
            id: d.id,
            fileName: d.data().fileName as string,
            fileUrl: d.data().fileUrl as string,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  if (error) {
    return <p className="text-sm text-destructive">Gagal memuat lampiran.</p>;
  }
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Paperclip className="h-3.5 w-3.5" />
        Lampiran
      </p>
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li key={a.id}>
            <a
              href={a.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              {a.fileName}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

This fetches once per mount via plain `getDocs` (not `onSnapshot`) because attachments are immutable while a submission sits in the `diajukan` status this queue only ever shows (see `firestore.rules`'s `attachments` `update: if false`).

- [ ] **Step 2: Wire it into the Antrian Persetujuan card**

In `app/(dashboard)/persetujuan/page.tsx`, add the import:

```ts
import { AttachmentsList } from "@/components/attachments-list/AttachmentsList";
```

Then in the non-personalia card's `CardContent` (the `return` block starting around line 224, right after the `<CardHeader>...</CardHeader>` closes and before the note `<div className="space-y-1.5">`), insert:

```tsx
                <CardContent className="space-y-4 pt-6">
                  <AttachmentsList submissionId={row.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor={`note-${row.id}`}>Catatan (wajib jika tolak)</Label>
```

(i.e. add the `<AttachmentsList submissionId={row.id} />` line as the first child of that `CardContent`, leaving everything after it unchanged.)

Do **not** add this to the personalia card branch — personalia's single required document is already handled separately (out of scope per the design doc).

- [ ] **Step 3: Manual verification**

Run the dev server against the emulator (`npm run dev` with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`), seed a submission with at least one attachment (e.g. via `npm run seed`), log in as `spv`, open Antrian Persetujuan, and confirm the lampiran link appears on the card and opens the file URL in a new tab. Confirm a submission with zero attachments renders no "Lampiran" block (not an empty one).

- [ ] **Step 4: Commit**

```bash
git add components/attachments-list/AttachmentsList.tsx "app/(dashboard)/persetujuan/page.tsx"
git commit -m "$(cat <<'EOF'
feat: show attachment links on Antrian Persetujuan cards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rename "Pengajuan Saya" to "Semua Pengajuan" and widen the query (Part B)

**Files:**
- Modify: `components/app-shell/nav-config.ts`
- Modify: `app/(dashboard)/pengajuan/page.tsx`

- [ ] **Step 1: Rename the nav label**

In `components/app-shell/nav-config.ts`, find:

```ts
  {
    href: "/pengajuan",
    label: "Pengajuan Saya",
    icon: FileStack,
    roles: ["admin", "spv"],
  },
```

Change `label` to `"Semua Pengajuan"`. Roles stay `["admin", "spv"]` — `management`/`superadmin` already have Monitoring for the same visibility.

- [ ] **Step 2: Widen the query and update page copy**

In `app/(dashboard)/pengajuan/page.tsx`, find:

```ts
  useEffect(() => {
    if (!appUser) return;
    const q = query(
      collection(db, "submissions"),
      where("requesterId", "==", appUser.uid),
      orderBy("submittedAt", "desc")
    );
```

Replace with:

```ts
  useEffect(() => {
    if (!appUser) return;
    const q = query(collection(db, "submissions"), orderBy("submittedAt", "desc"));
```

`where` is no longer used in this file — remove it from the import too. Find:

```ts
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
```

Replace with:

```ts
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
```

Then update the header copy. Find:

```tsx
      <PageHeader
        title="Pengajuan Saya"
        description="Daftar seluruh pengajuan kendaraan & perlengkapan yang pernah Anda ajukan."
```

Replace with:

```tsx
      <PageHeader
        title="Semua Pengajuan"
        description="Daftar seluruh pengajuan kendaraan & perlengkapan dari semua admin/AWS Supervisor."
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds with no new errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add components/app-shell/nav-config.ts "app/(dashboard)/pengajuan/page.tsx"
git commit -m "$(cat <<'EOF'
feat: rename Pengajuan Saya to Semua Pengajuan, show all submissions

firestore.rules already allows any signed-in user to read any submission;
this page's requesterId filter was the only thing hiding that. Detail-page
action buttons get ownership guards in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Gate detail-page action cards by ownership (Part B, continued)

**Files:**
- Modify: `app/(dashboard)/pengajuan/detail/page.tsx`

Now that "Semua Pengajuan" links to every submission's detail page (not just the viewer's own), a non-owner who clicks through will hit action buttons that only ever succeed for the real owner (per `firestore.rules`) — today they render unconditionally and just fail with a confusing permission error if clicked. Gate each one:

- [ ] **Step 1: Gate the "Revisi & Ajukan Ulang" resubmit link**

Find (around line 200):

```tsx
      {submission.status === "perlu_revisi" && (
```

Replace with:

```tsx
      {submission.status === "perlu_revisi" && submission.requesterId === appUser?.uid && (
```

- [ ] **Step 2: Gate the "Coba Generate PDF" retry card**

The rule allows either the approver or the requester to advance `disetujui` → `siap_dikirim`, so gate on either. Find (around line 227):

```tsx
          {submission.status === "disetujui" && !submission.pdfUrl && appUser && (
```

Replace with:

```tsx
          {submission.status === "disetujui" &&
            !submission.pdfUrl &&
            appUser &&
            (submission.requesterId === appUser.uid || submission.approverId === appUser.uid) && (
```

This adds one extra closing `)` needed at the end of that JSX block — find the matching close (it currently ends at line 243 with `)}`) and change it to `)}` → stays the same text but now closes one extra level; concretely, the block currently is:

```tsx
          {submission.status === "disetujui" && !submission.pdfUrl && appUser && (
            <Card>
              ...
            </Card>
          )}
```

and must become:

```tsx
          {submission.status === "disetujui" &&
            !submission.pdfUrl &&
            appUser &&
            (submission.requesterId === appUser.uid || submission.approverId === appUser.uid) && (
              <Card>
                ...
              </Card>
            )}
```

(the `<Card>...</Card>` body's indentation shifts two spaces deeper; keep its contents identical, only re-indent).

- [ ] **Step 3: Split the "siap_dikirim" card — keep "Lihat PDF" visible to everyone, gate the send-to-GA action**

Non-owners still benefit from seeing the finished PDF; only the WA-copy-template + "Konfirmasi Sudah Dikirim ke GA" action needs gating. Find the whole block (around lines 245-308):

```tsx
          {submission.status === "siap_dikirim" && appUser && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Kirim ke GA lewat WhatsApp</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <a
                  href={submission.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  Lihat PDF
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <Textarea
                  readOnly
                  rows={8}
                  className="font-mono text-xs"
                  value={buildWaTemplate(
                    {
                      submissionNumber: submission.submissionNumber,
                      type: submission.type,
                      subType: submission.subType,
                      branch: submission.branch,
                      employeeName: submission.employeeName,
                      pdfUrl: submission.pdfUrl,
                    },
                    appUser.name
                  )}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                    <Copy className="h-4 w-4" />
                    Salin Template
                  </Button>
                  <span role="status" aria-live="polite">
                    {copyFeedback && (
                      <span
                        className="flex items-center gap-1 text-sm font-medium"
                        style={{ color: STATUS_STYLES.selesai.color }}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Disalin!
                      </span>
                    )}
                  </span>
                </div>
                {copyError && (
                  <p role="alert" className="text-sm text-destructive">
                    {copyError}
                  </p>
                )}
                {confirmError && (
                  <p role="alert" className="text-sm text-destructive">
                    {confirmError}
                  </p>
                )}
                <Button type="button" size="sm" disabled={confirming} onClick={handleConfirm}>
                  {confirming ? "Memproses..." : "Konfirmasi Sudah Dikirim ke GA"}
                </Button>
              </CardContent>
            </Card>
          )}
```

Replace with:

```tsx
          {submission.status === "siap_dikirim" && appUser && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {submission.requesterId === appUser.uid ? "Kirim ke GA lewat WhatsApp" : "PDF Pengajuan"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <a
                  href={submission.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  Lihat PDF
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {submission.requesterId === appUser.uid && (
                  <>
                    <Textarea
                      readOnly
                      rows={8}
                      className="font-mono text-xs"
                      value={buildWaTemplate(
                        {
                          submissionNumber: submission.submissionNumber,
                          type: submission.type,
                          subType: submission.subType,
                          branch: submission.branch,
                          employeeName: submission.employeeName,
                          pdfUrl: submission.pdfUrl,
                        },
                        appUser.name
                      )}
                    />
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                        <Copy className="h-4 w-4" />
                        Salin Template
                      </Button>
                      <span role="status" aria-live="polite">
                        {copyFeedback && (
                          <span
                            className="flex items-center gap-1 text-sm font-medium"
                            style={{ color: STATUS_STYLES.selesai.color }}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Disalin!
                          </span>
                        )}
                      </span>
                    </div>
                    {copyError && (
                      <p role="alert" className="text-sm text-destructive">
                        {copyError}
                      </p>
                    )}
                    {confirmError && (
                      <p role="alert" className="text-sm text-destructive">
                        {confirmError}
                      </p>
                    )}
                    <Button type="button" size="sm" disabled={confirming} onClick={handleConfirm}>
                      {confirming ? "Memproses..." : "Konfirmasi Sudah Dikirim ke GA"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
```

- [ ] **Step 4: Gate the "Tandai Selesai" card**

Find (around line 310):

```tsx
          {submission.status === "on_proses_ga" && appUser && (
```

Replace with:

```tsx
          {submission.status === "on_proses_ga" && appUser && submission.requesterId === appUser.uid && (
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds, no new errors/warnings.

- [ ] **Step 6: Manual verification**

Against the emulator/dev server: log in as an `admin` who is NOT the owner of some `disetujui`/`siap_dikirim`/`on_proses_ga`/`perlu_revisi` submission (create two admin test users if needed), navigate to that submission's detail page via "Semua Pengajuan", and confirm no action buttons render for the non-owner — only read-only info (status, timeline, and — for `siap_dikirim` — the "Lihat PDF" link). Then confirm the actual owner still sees and can use every action as before.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/pengajuan/detail/page.tsx"
git commit -m "$(cat <<'EOF'
feat: gate detail-page action buttons by ownership

Now that Semua Pengajuan links to every submission (not just the
viewer's own), a non-owner could already reach these action cards and
have them fail with a confusing permission error on click. Gate each
one so non-owners see read-only info instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `lib/pdf/signaturePosition.ts` — pure position/clamp helper (TDD)

**Files:**
- Create: `lib/pdf/signaturePosition.ts`
- Test: `lib/pdf/signaturePosition.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { clampSignaturePosition } from "./signaturePosition";

describe("clampSignaturePosition", () => {
  it("leaves an in-bounds position unchanged", () => {
    const result = clampSignaturePosition({ x: 100, y: 200, width: 180, height: 60 }, 1000, 1000);
    expect(result).toEqual({ x: 100, y: 200, width: 180, height: 60 });
  });

  it("clamps negative x/y up to 0", () => {
    const result = clampSignaturePosition({ x: -50, y: -10, width: 180, height: 60 }, 1000, 1000);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("clamps x/y that would push the box past the right/bottom edge", () => {
    const result = clampSignaturePosition({ x: 950, y: 980, width: 180, height: 60 }, 1000, 1000);
    expect(result.x).toBe(820); // 1000 - 180
    expect(result.y).toBe(940); // 1000 - 60
  });

  it("keeps width/height unchanged", () => {
    const result = clampSignaturePosition({ x: -999, y: -999, width: 180, height: 60 }, 1000, 1000);
    expect(result.width).toBe(180);
    expect(result.height).toBe(60);
  });

  it("does not produce a negative x/y when the box is wider/taller than the canvas", () => {
    const result = clampSignaturePosition({ x: 500, y: 500, width: 1200, height: 1200 }, 1000, 1000);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/pdf/signaturePosition.test.ts`
Expected: FAIL — `Cannot find module './signaturePosition'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
export type SignaturePositionPx = { x: number; y: number; width: number; height: number };

export function clampSignaturePosition(
  position: SignaturePositionPx,
  canvasWidthPx: number,
  canvasHeightPx: number
): SignaturePositionPx {
  const maxX = Math.max(0, canvasWidthPx - position.width);
  const maxY = Math.max(0, canvasHeightPx - position.height);
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY),
    width: position.width,
    height: position.height,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pdf/signaturePosition.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/signaturePosition.ts lib/pdf/signaturePosition.test.ts
git commit -m "$(cat <<'EOF'
feat: add clampSignaturePosition helper for draggable TTD placement

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `pdfTemplate.ts` — nullable approver signature + position marker

**Files:**
- Modify: `lib/pdf/pdfTemplate.ts`
- Modify: `lib/pdf/pdfTemplate.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/pdf/pdfTemplate.test.ts` (append inside the existing `describe("buildSubmissionPdfHtml", ...)` block, before its closing `});`):

```ts
  it("renders an empty signature box (no <img>) when approverSignatureUrl is null", () => {
    const html = buildSubmissionPdfHtml({ ...baseData, approverSignatureUrl: null });
    expect(html).not.toContain('alt="Tanda tangan approver"');
    expect(html).toContain("data-approver-signature-box");
  });

  it("still renders the requester's signature when approverSignatureUrl is null", () => {
    const html = buildSubmissionPdfHtml({ ...baseData, approverSignatureUrl: null });
    expect(html).toContain("https://drive.google.com/uc?export=view&amp;id=req-sig");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/pdf/pdfTemplate.test.ts`
Expected: FAIL — TypeScript error (`approverSignatureUrl: null` not assignable to `string`) or, if it compiles, the first new test fails because the box currently always renders the `<img>` and has no `data-approver-signature-box` attribute.

- [ ] **Step 3: Update the type and template**

In `lib/pdf/pdfTemplate.ts`, find:

```ts
export type SubmissionPdfData = {
  submissionNumber: string;
  type: "kendaraan" | "perlengkapan" | "gedung_fasilitas";
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
```

Replace with:

```ts
export type SubmissionPdfData = {
  submissionNumber: string;
  type: "kendaraan" | "perlengkapan" | "gedung_fasilitas";
  subType: string;
  branch: string;
  department: string;
  position: string;
  requesterName: string;
  requesterSignatureUrl: string;
  approverName: string;
  approverRole: "spv" | "management";
  // null while rendering the base canvas for interactive TTD placement — the
  // signature is composited onto the canvas afterwards instead of baked into
  // this HTML/CSS layout. See lib/pdf/generateSubmissionPdfClient.ts.
  approverSignatureUrl: string | null;
  submittedAt: Date;
  approvedAt: Date;
  items: SubmissionPdfItem[];
};
```

Then find:

```html
    <div class="signature-block">
      <div>Mengetahui</div>
      <div class="signature-img-box"><img src="${escapeHtml(data.approverSignatureUrl)}" alt="Tanda tangan approver" /></div>
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
```

Replace with:

```html
    <div class="signature-block">
      <div>Mengetahui</div>
      <div class="signature-img-box" data-approver-signature-box>${
        data.approverSignatureUrl
          ? `<img src="${escapeHtml(data.approverSignatureUrl)}" alt="Tanda tangan approver" />`
          : ""
      }</div>
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/pdf/pdfTemplate.test.ts`
Expected: PASS (all tests including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/pdfTemplate.ts lib/pdf/pdfTemplate.test.ts
git commit -m "$(cat <<'EOF'
feat: let pdfTemplate render without an approver signature

Prep for draggable TTD placement — the approver signature is now always
composited onto the rendered canvas afterward instead of baked into the
HTML/CSS layout.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Split `generateSubmissionPdfClient.ts` into render + composite

**Files:**
- Modify: `lib/pdf/generateSubmissionPdfClient.ts`

`computePdfPageSlices` and its test (`lib/pdf/generateSubmissionPdfClient.test.ts`) are untouched by this task — keep both exactly as they are.

- [ ] **Step 1: Replace the file's post-`computePdfPageSlices` content**

In `lib/pdf/generateSubmissionPdfClient.ts`, keep everything from the top of the file down through the end of `computePdfPageSlices` (lines 1–63) exactly as-is. Replace everything from `export type GenerateSubmissionPdfResult` (line 65) to the end of the file with:

```ts
import type { SignaturePositionPx } from "./signaturePosition";

export type GenerateSubmissionPdfResult = { pdfUrl: string };

export type BaseCanvasResult = {
  canvas: HTMLCanvasElement;
  defaultSignaturePositionPx: SignaturePositionPx;
};

// Renders the template WITHOUT the approver signature into one tall canvas,
// and reports where the (now-empty) approver signature box landed on that
// canvas — this becomes the default drag position in SignaturePlacementModal,
// so an approver who doesn't care can just confirm without dragging anything.
export async function renderSubmissionBaseCanvas(
  data: Omit<SubmissionPdfData, "approverSignatureUrl">
): Promise<BaseCanvasResult> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${RENDER_WIDTH_PX}px`;
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    throw new Error("Gagal menyiapkan dokumen render PDF.");
  }
  iframeDoc.open();
  iframeDoc.write(buildSubmissionPdfHtml({ ...data, approverSignatureUrl: null }));
  iframeDoc.close();

  try {
    await iframeDoc.fonts.ready;
    await waitForImagesToLoad(iframeDoc);
    iframe.style.height = `${iframeDoc.body.scrollHeight}px`;

    const box = iframeDoc.querySelector("[data-approver-signature-box]") as HTMLElement | null;
    if (!box) {
      throw new Error("Template tidak punya blok tanda tangan approver.");
    }
    const rect = box.getBoundingClientRect();
    // scale:2 below means the rendered canvas is exactly 2x RENDER_WIDTH_PX —
    // computed from the same constant html2canvas is told to scale from,
    // rather than re-derived from layout, so it can't drift from reality.
    const scale = 2;

    const canvas = await html2canvas(iframeDoc.body, { useCORS: true, scale, backgroundColor: "#ffffff" });

    return {
      canvas,
      defaultSignaturePositionPx: {
        x: rect.left * scale,
        y: rect.top * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      },
    };
  } finally {
    document.body.removeChild(iframe);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat gambar tanda tangan: ${src}`));
    img.src = src;
  });
}

// Draws the approver signature onto a COPY of the base canvas (the original
// is left untouched so a modal preview can composite a signature multiple
// times as the approver drags it around), then runs the same page-slicing +
// jsPDF assembly the old single-shot generateSubmissionPdfClient used to do.
export async function compositeSignatureAndBuildPdf(
  baseCanvas: HTMLCanvasElement,
  signatureImageUrl: string,
  positionPx: SignaturePositionPx,
  submissionNumber: string
): Promise<GenerateSubmissionPdfResult> {
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = baseCanvas.width;
  compositeCanvas.height = baseCanvas.height;
  const ctx = compositeCanvas.getContext("2d")!;
  ctx.drawImage(baseCanvas, 0, 0);

  const signatureImage = await loadImage(signatureImageUrl);
  ctx.drawImage(signatureImage, positionPx.x, positionPx.y, positionPx.width, positionPx.height);

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const slices = computePdfPageSlices(compositeCanvas.width, compositeCanvas.height, A4_WIDTH_MM, A4_HEIGHT_MM);

  slices.forEach((slice, index) => {
    if (index > 0) {
      pdf.addPage();
    }
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = compositeCanvas.width;
    sliceCanvas.height = slice.sliceHeightPx;
    const sliceCtx = sliceCanvas.getContext("2d")!;
    sliceCtx.drawImage(
      compositeCanvas,
      0,
      slice.sourceYPx,
      compositeCanvas.width,
      slice.sliceHeightPx,
      0,
      0,
      compositeCanvas.width,
      slice.sliceHeightPx
    );
    const sliceImageData = sliceCanvas.toDataURL("image/png");
    const sliceHeightMm = (slice.sliceHeightPx / compositeCanvas.width) * A4_WIDTH_MM;
    pdf.addImage(sliceImageData, "PNG", 0, 0, A4_WIDTH_MM, sliceHeightMm);
  });

  const pdfBlob = pdf.output("blob");
  const pdfFile = new File([pdfBlob], `${submissionNumber.replace(/\//g, "-")}.pdf`, {
    type: "application/pdf",
  });
  const { fileUrl } = await uploadToDriveClient(pdfFile, "attachment");
  return { pdfUrl: fileUrl };
}
```

The old combined `generateSubmissionPdfClient` function is gone entirely — its two halves now live in `renderSubmissionBaseCanvas` and `compositeSignatureAndBuildPdf`, both used exclusively via `SignaturePlacementModal` (Task 9) and `generateAndAttachSubmissionPdf` (Task 10).

- [ ] **Step 2: Verify types and existing tests**

Run: `npx vitest run lib/pdf/generateSubmissionPdfClient.test.ts`
Expected: PASS — this file only imports `computePdfPageSlices`, untouched by this task.

Run: `npm run build`
Expected: FAILS at this point — `generateAndAttachSubmissionPdf.ts` (Task 10) and any other caller still reference the now-deleted `generateSubmissionPdfClient` export. This is expected and gets fixed in Task 10; do not treat it as a blocker for this task's commit.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/generateSubmissionPdfClient.ts
git commit -m "$(cat <<'EOF'
refactor: split generateSubmissionPdfClient into render + composite steps

renderSubmissionBaseCanvas renders the template without the approver
signature and reports the signature box's on-canvas position (the default
drag position). compositeSignatureAndBuildPdf draws a signature onto a
copy of that canvas at caller-supplied coordinates and assembles the PDF
exactly as the old single-shot function did. Callers updated in the next
few commits.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `generateAndAttachSubmissionPdf.ts` — accept a signature position

**Files:**
- Modify: `lib/pdf/generateAndAttachSubmissionPdf.ts`

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `lib/pdf/generateAndAttachSubmissionPdf.ts` with:

```ts
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { renderSubmissionBaseCanvas, compositeSignatureAndBuildPdf } from "./generateSubmissionPdfClient";
import type { SignaturePositionPx } from "./signaturePosition";
import type { SubmissionPdfData, SubmissionPdfItem } from "./pdfTemplate";
import type { AppUser } from "@/lib/hooks/useAuth";

const APPROVER_ROLE_VALUES = ["spv", "management"];

export type GenerateAndAttachSubmissionPdfResult = { pdfUrl: string };

export async function generateAndAttachSubmissionPdf(
  submissionId: string,
  caller: AppUser,
  signaturePositionPx: SignaturePositionPx
): Promise<GenerateAndAttachSubmissionPdfResult> {
  const submissionRef = doc(db, "submissions", submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.approverId !== caller.uid && submission.requesterId !== caller.uid) {
    throw new Error("Anda tidak memiliki akses untuk membuat PDF pengajuan ini.");
  }
  if (submission.status !== "disetujui") {
    throw new Error("Hanya pengajuan berstatus disetujui yang bisa dibuatkan PDF.");
  }
  if (!APPROVER_ROLE_VALUES.includes(submission.approverRole)) {
    throw new Error("Role approver pada pengajuan ini tidak valid.");
  }

  const itemsSnap = await getDocs(collection(submissionRef, "items"));
  if (!submission.employeeName) {
    throw new Error("Data pengaju tidak ditemukan.");
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

  const pdfData: Omit<SubmissionPdfData, "approverSignatureUrl"> = {
    submissionNumber: submission.submissionNumber,
    type: submission.type,
    subType: submission.subType,
    branch: submission.branch,
    department: submission.department,
    position: submission.position,
    requesterName: submission.employeeName,
    requesterSignatureUrl: submission.requesterSignatureUrl,
    approverName: submission.approverName,
    approverRole: submission.approverRole,
    submittedAt: submission.submittedAt?.toDate() ?? new Date(),
    approvedAt: submission.approvedAt?.toDate() ?? new Date(),
    items,
  };

  const { canvas } = await renderSubmissionBaseCanvas(pdfData);
  const { pdfUrl } = await compositeSignatureAndBuildPdf(
    canvas,
    submission.approverSignatureUrl,
    signaturePositionPx,
    submission.submissionNumber
  );

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
    submissionNumber: submission.submissionNumber,
    employeeName: submission.employeeName,
  });

  try {
    await batch.commit();
  } catch (error) {
    const freshSnap = await getDoc(submissionRef);
    const fresh = freshSnap.data();
    if (fresh?.status === "siap_dikirim" && fresh.pdfUrl) {
      return { pdfUrl: fresh.pdfUrl as string };
    }
    throw error;
  }

  return { pdfUrl };
}
```

Callers must now pass a third argument (`signaturePositionPx`) — Tasks 11 and 12 update the only two call sites.

- [ ] **Step 2: Commit**

```bash
git add lib/pdf/generateAndAttachSubmissionPdf.ts
git commit -m "$(cat <<'EOF'
refactor: generateAndAttachSubmissionPdf takes an explicit signature position

Uses the render+composite split from the previous commit instead of the
deleted single-shot generateSubmissionPdfClient.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(`npm run build` will still fail until Task 11 removes the last outdated call site in `reviewSubmission.ts` — that's expected, fixed in the next task.)

---

### Task 9: Remove the fire-and-forget PDF call from `reviewSubmission.ts`

**Files:**
- Modify: `lib/submissions/reviewSubmission.ts`

- [ ] **Step 1: Remove the auto-generate call**

In `lib/submissions/reviewSubmission.ts`, remove the import:

```ts
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
```

And remove this block from the end of the function body (currently right before the final `return`):

```ts
  if (input.decision === "approve") {
    void generateAndAttachSubmissionPdf(input.submissionId, caller).catch((error) => {
      console.error(`reviewSubmission: PDF generation failed for submission ${input.submissionId}`, error);
    });
  }

```

`reviewSubmission` goes back to doing exactly one thing: writing the approve/reject status transition. PDF generation is now an explicit, separate call the UI makes after showing `SignaturePlacementModal` (Task 12).

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds now — this was the last stale call site from the old single-shot API.

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/reviewSubmission.ts
git commit -m "$(cat <<'EOF'
refactor: reviewSubmission no longer auto-generates the PDF

PDF generation (with the approver's chosen signature position) is now
triggered explicitly by the UI via SignaturePlacementModal, right after
a successful approve — see the Antrian Persetujuan changes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `SignaturePlacementModal` component

**Files:**
- Create: `components/pdf/SignaturePlacementModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { renderSubmissionBaseCanvas } from "@/lib/pdf/generateSubmissionPdfClient";
import { clampSignaturePosition, SignaturePositionPx } from "@/lib/pdf/signaturePosition";
import type { SubmissionPdfData } from "@/lib/pdf/pdfTemplate";
import { computePdfPageSlices } from "@/lib/pdf/generateSubmissionPdfClient";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const DISPLAY_WIDTH_PX = 600;

export function SignaturePlacementModal({
  data,
  signatureImageUrl,
  onConfirm,
  onCancel,
}: {
  data: Omit<SubmissionPdfData, "approverSignatureUrl">;
  signatureImageUrl: string;
  onConfirm: (position: SignaturePositionPx) => Promise<void>;
  onCancel: () => void;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [position, setPosition] = useState<SignaturePositionPx | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const dragState = useRef<{ startClientX: number; startClientY: number; startPosition: SignaturePositionPx } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    renderSubmissionBaseCanvas(data)
      .then(({ canvas: baseCanvas, defaultSignaturePositionPx }) => {
        if (cancelled) return;
        setCanvas(baseCanvas);
        setImageDataUrl(baseCanvas.toDataURL("image/png"));
        setPosition(defaultSignaturePositionPx);
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : "Gagal me-render preview PDF.");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayScale = canvas ? DISPLAY_WIDTH_PX / canvas.width : 1;

  function handlePointerDown(e: React.PointerEvent) {
    if (!position) return;
    e.preventDefault();
    dragState.current = { startClientX: e.clientX, startClientY: e.clientY, startPosition: position };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragState.current || !canvas) return;
    const dxCanvasPx = (e.clientX - dragState.current.startClientX) / displayScale;
    const dyCanvasPx = (e.clientY - dragState.current.startClientY) / displayScale;
    const next = clampSignaturePosition(
      {
        ...dragState.current.startPosition,
        x: dragState.current.startPosition.x + dxCanvasPx,
        y: dragState.current.startPosition.y + dyCanvasPx,
      },
      canvas.width,
      canvas.height
    );
    setPosition(next);
  }

  function handlePointerUp() {
    dragState.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }

  async function handleConfirmClick() {
    if (!position) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      await onConfirm(position);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal menyelesaikan approve/generate PDF.");
    } finally {
      setConfirming(false);
    }
  }

  const pageBreaksPx = canvas ? computePdfPageSlices(canvas.width, canvas.height) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl">
        <h2 className="mb-3 text-base font-semibold">Posisikan Tanda Tangan</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Geser tanda tangan ke posisi yang diinginkan, atau langsung Konfirmasi untuk pakai posisi default. Garis
          putus-putus menandai batas potong halaman — hindari menaruh tanda tangan tepat di garis itu.
        </p>

        {renderError && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{renderError}</span>
          </div>
        )}

        {!renderError && !canvas && <p className="py-8 text-center text-sm text-muted-foreground">Menyiapkan preview...</p>}

        {canvas && imageDataUrl && position && (
          <div
            className="relative mx-auto select-none"
            style={{ width: DISPLAY_WIDTH_PX, height: canvas.height * displayScale }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageDataUrl} alt="Preview dokumen" className="pointer-events-none w-full" />
            {pageBreaksPx.slice(0, -1).map((slice, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t-2 border-dashed border-red-400"
                style={{ top: (slice.sourceYPx + slice.sliceHeightPx) * displayScale }}
              />
            ))}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signatureImageUrl}
              alt="Tanda tangan approver"
              onPointerDown={handlePointerDown}
              className="absolute touch-none border border-dashed border-primary bg-white/60"
              style={{
                left: position.x * displayScale,
                top: position.y * displayScale,
                width: position.width * displayScale,
                height: position.height * displayScale,
                cursor: "grab",
              }}
            />
          </div>
        )}

        {confirmError && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{confirmError}</span>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            Batal
          </Button>
          <Button type="button" onClick={handleConfirmClick} disabled={!position || confirming}>
            {confirming ? "Memproses..." : "Konfirmasi"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds (this component isn't wired into any page yet, but must compile standalone).

- [ ] **Step 3: Commit**

```bash
git add components/pdf/SignaturePlacementModal.tsx
git commit -m "$(cat <<'EOF'
feat: add SignaturePlacementModal for draggable TTD placement

Renders the base PDF canvas (no approver signature baked in) as a preview,
overlays the approver's signature image at a sensible default position
(the old template's fixed spot), and lets them drag it anywhere before
confirming. Not wired into any page yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wire the modal into Antrian Persetujuan's approve flow

**Files:**
- Modify: `app/(dashboard)/persetujuan/page.tsx`

- [ ] **Step 1: Extend `QueueRow` and the query mapping**

Find:

```ts
type QueueRow = {
  id: string;
  submissionNumber: string;
  type: string;
  subType: string;
  branch: string;
  employeeName: string;
  spvApproval: ApprovalRecord;
  managerApproval: ApprovalRecord;
  submittedAt: Date | null;
};
```

Replace with:

```ts
type QueueRow = {
  id: string;
  submissionNumber: string;
  type: string;
  subType: string;
  branch: string;
  department: string;
  position: string;
  employeeName: string;
  requesterSignatureUrl: string;
  spvApproval: ApprovalRecord;
  managerApproval: ApprovalRecord;
  submittedAt: Date | null;
};
```

Find the `onSnapshot` row-mapping (inside the second `useEffect`):

```ts
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            subType: d.data().subType,
            branch: d.data().branch,
            employeeName: d.data().employeeName,
            spvApproval: d.data().spvApproval ?? null,
            managerApproval: d.data().managerApproval ?? null,
            submittedAt: d.data().submittedAt?.toDate() ?? null,
          }))
        );
```

Replace with:

```ts
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            subType: d.data().subType,
            branch: d.data().branch,
            department: d.data().department,
            position: d.data().position,
            employeeName: d.data().employeeName,
            requesterSignatureUrl: d.data().requesterSignatureUrl,
            spvApproval: d.data().spvApproval ?? null,
            managerApproval: d.data().managerApproval ?? null,
            submittedAt: d.data().submittedAt?.toDate() ?? null,
          }))
        );
```

- [ ] **Step 2: Add imports and placement state**

Find:

```ts
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
```

Replace with:

```ts
import { collection, getDocs, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
import { SignaturePlacementModal } from "@/components/pdf/SignaturePlacementModal";
import type { SubmissionPdfData, SubmissionPdfItem } from "@/lib/pdf/pdfTemplate";
import type { SignaturePositionPx } from "@/lib/pdf/signaturePosition";
```

Add new state near the other `useState` calls:

```ts
  const [placement, setPlacement] = useState<{
    row: QueueRow;
    data: Omit<SubmissionPdfData, "approverSignatureUrl">;
    signatureImageUrl: string;
  } | null>(null);
```

- [ ] **Step 3: Replace `handleDecision`'s approve path with a two-step flow**

Find the whole `handleDecision` function:

```ts
  async function handleDecision(submissionId: string, decision: "approve" | "reject") {
    if (!appUser) return;
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      await reviewSubmission(
        {
          submissionId,
          decision,
          rejectionNote: noteBySubmission[submissionId],
          approverSignatureUrl: decision === "approve" ? signatureBySubmission[submissionId] : undefined,
        },
        appUser
      );
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

Replace with:

```ts
  async function handleReject(submissionId: string) {
    if (!appUser) return;
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      await reviewSubmission(
        { submissionId, decision: "reject", rejectionNote: noteBySubmission[submissionId] },
        appUser
      );
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [submissionId]: err instanceof Error ? err.message : "Gagal memproses review.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveClick(row: QueueRow) {
    if (!appUser) return;
    const signatureUrl = signatureBySubmission[row.id];
    if (!signatureUrl) return;
    setActionErrorBySubmission((prev) => ({ ...prev, [row.id]: "" }));
    try {
      const itemsSnap = await getDocs(collection(db, "submissions", row.id, "items"));
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
      setPlacement({
        row,
        signatureImageUrl: signatureUrl,
        data: {
          submissionNumber: row.submissionNumber,
          type: row.type as "kendaraan" | "perlengkapan" | "gedung_fasilitas",
          subType: row.subType,
          branch: row.branch,
          department: row.department,
          position: row.position,
          requesterName: row.employeeName,
          requesterSignatureUrl: row.requesterSignatureUrl,
          approverName: appUser.name,
          approverRole: appUser.role as "spv" | "management",
          submittedAt: row.submittedAt ?? new Date(),
          approvedAt: new Date(),
          items,
        },
      });
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : "Gagal menyiapkan preview PDF.",
      }));
    }
  }

  async function handleConfirmPlacement(position: SignaturePositionPx) {
    if (!placement || !appUser) return;
    const { row } = placement;
    setBusyId(row.id);
    try {
      await reviewSubmission(
        { submissionId: row.id, decision: "approve", approverSignatureUrl: signatureBySubmission[row.id] },
        appUser
      );
      await generateAndAttachSubmissionPdf(row.id, appUser, position);
      setPlacement(null);
    } finally {
      setBusyId(null);
    }
  }
```

(`handleConfirmPlacement` deliberately re-throws by not catching — `SignaturePlacementModal` catches it itself and shows `confirmError`, per Task 10's implementation. If approve succeeds but PDF generation fails, the submission is left `disetujui` without a PDF, same as any interrupted flow — the existing "Coba Generate PDF" retry on the detail page, updated in Task 12, is the recovery path.)

- [ ] **Step 4: Update the "Setujui" button and render the modal**

Find, in the non-personalia card:

```tsx
                    <Button
                      size="lg"
                      disabled={busyId === row.id || !hasSignature || !appUser}
                      onClick={() => handleDecision(row.id, "approve")}
                    >
                      <Check className="h-4 w-4" />
                      Setujui
                    </Button>
                    <Button
                      size="lg"
                      variant="destructive"
                      disabled={busyId === row.id || !appUser || !noteBySubmission[row.id]?.trim()}
                      onClick={() => handleDecision(row.id, "reject")}
                    >
```

Replace with:

```tsx
                    <Button
                      size="lg"
                      disabled={busyId === row.id || !hasSignature || !appUser}
                      onClick={() => handleApproveClick(row)}
                    >
                      <Check className="h-4 w-4" />
                      Setujui
                    </Button>
                    <Button
                      size="lg"
                      variant="destructive"
                      disabled={busyId === row.id || !appUser || !noteBySubmission[row.id]?.trim()}
                      onClick={() => handleReject(row.id)}
                    >
```

Finally, add the modal render right before the component's closing `</div>` (i.e. just before the final `</div>\n  );\n}`):

```tsx
      {placement && (
        <SignaturePlacementModal
          data={placement.data}
          signatureImageUrl={placement.signatureImageUrl}
          onConfirm={handleConfirmPlacement}
          onCancel={() => setPlacement(null)}
        />
      )}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds, no new errors/warnings.

- [ ] **Step 6: Manual verification**

Against the emulator/dev server: log in as `spv`, approve a `kendaraan`/`perlengkapan`/`gedung_fasilitas` submission, confirm the placement modal opens showing a live preview with the signature at its default spot, drag it somewhere else, click Konfirmasi, and confirm the submission ends up `siap_dikirim` with a `pdfUrl` — open that PDF and confirm the signature landed where it was dropped.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/persetujuan/page.tsx"
git commit -m "$(cat <<'EOF'
feat: open SignaturePlacementModal on approve in Antrian Persetujuan

Approve is now: write approve -> show draggable PDF preview -> on
Confirm, generate the final PDF with the chosen signature position.
Replaces the old fire-and-forget default-position generation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Wire the modal into the detail page's PDF retry button

**Files:**
- Modify: `app/(dashboard)/pengajuan/detail/page.tsx`

- [ ] **Step 1: Add imports and placement state**

Find:

```ts
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
```

Replace with:

```ts
import { doc, onSnapshot, collection, orderBy, query, getDocs, DocumentData } from "firebase/firestore";
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
import { SignaturePlacementModal } from "@/components/pdf/SignaturePlacementModal";
import type { SubmissionPdfData, SubmissionPdfItem } from "@/lib/pdf/pdfTemplate";
import type { SignaturePositionPx } from "@/lib/pdf/signaturePosition";
```

Note: `generateAndAttachSubmissionPdf` is already imported near the top of this file (`import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";`) — don't add it twice; the import above is only needed if that line isn't already present.

Add state next to the other `useState` calls in `PengajuanDetailContent`:

```ts
  const [placement, setPlacement] = useState<{
    data: Omit<SubmissionPdfData, "approverSignatureUrl">;
    signatureImageUrl: string;
  } | null>(null);
```

- [ ] **Step 2: Replace `handleGeneratePdf`**

Find:

```ts
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

Replace with:

```ts
  async function handleOpenGeneratePdf() {
    if (!submission || !appUser) return;
    setPdfError(null);
    try {
      const itemsSnap = await getDocs(collection(db, "submissions", submission.id, "items"));
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
      setPlacement({
        signatureImageUrl: submission.approverSignatureUrl,
        data: {
          submissionNumber: submission.submissionNumber,
          type: submission.type,
          subType: submission.subType,
          branch: submission.branch,
          department: submission.department,
          position: submission.position,
          requesterName: submission.employeeName,
          requesterSignatureUrl: submission.requesterSignatureUrl,
          approverName: submission.approverName,
          approverRole: submission.approverRole,
          submittedAt: submission.submittedAt?.toDate() ?? new Date(),
          approvedAt: submission.approvedAt?.toDate() ?? new Date(),
          items,
        },
      });
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Gagal menyiapkan preview PDF.");
    }
  }

  async function handleConfirmPlacement(position: SignaturePositionPx) {
    if (!submission || !appUser) return;
    setGeneratingPdf(true);
    try {
      await generateAndAttachSubmissionPdf(submission.id, appUser, position);
      setPlacement(null);
    } finally {
      setGeneratingPdf(false);
    }
  }
```

(same pattern as Task 11: `handleConfirmPlacement` doesn't catch — the modal shows the error itself and stays open so the approver can retry Konfirmasi without re-dragging.)

- [ ] **Step 3: Update the retry button and render the modal**

Find:

```tsx
                <Button type="button" size="sm" disabled={generatingPdf} onClick={handleGeneratePdf}>
                  {generatingPdf ? "Memproses..." : "Coba Generate PDF"}
                </Button>
```

Replace with:

```tsx
                <Button type="button" size="sm" disabled={generatingPdf} onClick={handleOpenGeneratePdf}>
                  {generatingPdf ? "Memproses..." : "Coba Generate PDF"}
                </Button>
```

Add the modal render right before `PengajuanDetailContent`'s closing `</div>` (just before its final `</div>\n  );\n}`):

```tsx
      {placement && (
        <SignaturePlacementModal
          data={placement.data}
          signatureImageUrl={placement.signatureImageUrl}
          onConfirm={handleConfirmPlacement}
          onCancel={() => setPlacement(null)}
        />
      )}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds, no new errors/warnings.

- [ ] **Step 5: Manual verification**

Against the emulator/dev server: get a submission into `disetujui` without a `pdfUrl` (e.g. interrupt Task 11's flow by closing the modal before confirming, or seed one directly), open its detail page, click "Coba Generate PDF", confirm the same draggable modal opens and completes the `siap_dikirim` transition the same way as the Antrian Persetujuan path.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/pengajuan/detail/page.tsx"
git commit -m "$(cat <<'EOF'
feat: reuse SignaturePlacementModal for the detail-page PDF retry button

One code path for generating this PDF regardless of whether it's
triggered right after approve or via the manual retry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full test suite against the emulator**

Run: `npx firebase emulators:exec --only firestore,auth "npm run test"`
Expected: all tests pass, including the new `lib/pdf/signaturePosition.test.ts` and the updated `lib/pdf/pdfTemplate.test.ts`.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: succeeds with no new errors/warnings beyond the two pre-existing `react-hooks/exhaustive-deps` warnings already present before this plan (Monitoring's `now`, detail page's `submission` dependency).

- [ ] **Step 3: Update CLAUDE.md**

In the "Modul Client-side (`/lib`)" table, find the row:

```
| `lib/pdf/generateAndAttachSubmissionPdf.ts` + `lib/pdf/generateSubmissionPdfClient.ts` | Halaman detail pengajuan, setelah `disetujui` | Render PDF di browser (jsPDF + html2canvas), upload ke Google Drive, update `pdfUrl` + status `siap_dikirim` |
```

Replace with:

```
| `lib/pdf/generateAndAttachSubmissionPdf.ts` + `lib/pdf/generateSubmissionPdfClient.ts` (`renderSubmissionBaseCanvas`/`compositeSignatureAndBuildPdf`) + `components/pdf/SignaturePlacementModal.tsx` | Antrian Persetujuan (saat approve) & halaman detail pengajuan (retry) | Render template tanpa TTD approver ke satu kanvas, tampilkan sebagai preview yang bisa di-drag lewat `SignaturePlacementModal` supaya approver bisa taruh TTD-nya di posisi manapun, lalu composite ke kanvas + slice per halaman + jsPDF, upload ke Google Drive, update `pdfUrl` + status `siap_dikirim`. Approve tidak lagi auto-generate PDF di background — modal ini jadi satu-satunya jalur, dipakai baik langsung setelah approve maupun lewat retry manual |
```

Add a short new subsection right after "Ekspansi One Gate" (before "Restrukturisasi Role Admin"):

```markdown
## Lampiran di Antrian & Visibilitas Semua Pengajuan (2026-09-09)

- Antrian Persetujuan (`/persetujuan`) menampilkan lampiran submission (link ke Drive) lewat `components/attachments-list/AttachmentsList.tsx`, supaya approver bisa cek dokumen pendukung sebelum approve/reject.
- Halaman `/pengajuan` di-rename jadi "Semua Pengajuan" dan tidak lagi memfilter `requesterId` — menampilkan semua submission (rules-nya memang sudah terbuka sejak "Visibilitas Semua User" di atas, cuma UI-nya yang baru menyusul). Tombol aksi di halaman detail (`/pengajuan/detail`) sekarang digerbangi kepemilikan (`requesterId`/`approverId` cocok dengan `appUser.uid`) supaya non-pemilik tidak melihat tombol yang bakal gagal kalau diklik.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md for lampiran antrian, semua pengajuan, TTD posisi

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan note for whoever executes this

Do **not** run `firebase deploy` as part of any task above — this plan only commits locally. Deploying (hosting + firestore rules if they changed, though this plan doesn't touch `firestore.rules` at all) is a separate, explicit step the user asked for after the last two features and should be confirmed the same way here.
