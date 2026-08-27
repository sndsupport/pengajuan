# Generate Submission PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the approver's digital signature at approve time, then auto-generate a PDF (mimicking the GA form) and advance the submission to `siap_dikirim`, per `docs/superpowers/specs/2026-08-27-generate-submission-pdf-design.md`.

**Architecture:** `reviewSubmission` gains a required `approverSignatureUrl` on approve (persisted, not yet used for PDF generation itself). A separate Firestore trigger (`onDocumentUpdated` on `submissions/{submissionId}`) detects the `disetujui` transition, renders an HTML template to PDF via `puppeteer-core` + `@sparticuz/chromium`, uploads it to Google Drive (reusing the existing `uploadToDrive` helper), and advances the submission to `siap_dikirim`. This keeps `reviewSubmission` fast — the approver's UI action doesn't wait on Puppeteer.

**Tech Stack:** TypeScript, Zod, React Hook Form (no new form here, reusing existing components), Firebase Functions v2 (`onCall` + `onDocumentUpdated`), `puppeteer-core`, `@sparticuz/chromium`, Vitest.

**Environment note:** Same constraints as prior plans — no Java on this machine, so Firestore/Auth Emulator-backed tests cannot run. Additionally, `@sparticuz/chromium` bundles a Linux-only Chromium binary, so even Puppeteer-dependent test code cannot run at all on this Windows machine (with or without Java). Every step that needs the emulator or a real Chromium binary is marked; write the file exactly as specified regardless, verify via `npm --prefix functions run build` (type-check) instead of running it, and do not report BLOCKED for this known, accepted limitation. The one exception is `functions/src/pdfTemplate.ts` (a pure function with no Firestore/Puppeteer dependency) and the `shouldGeneratePdf` half of `functions/src/generateSubmissionPdf.ts` — both are fully runnable here and MUST be run and verified.

---

## File Structure

```
/lib
  /schemas
    submission.ts          # modify — reviewSubmissionSchema gains approverSignatureUrl
    submission.test.ts      # modify — update/add reviewSubmissionSchema tests
/functions
  /src
    schemas.ts               # modify — duplicate the same reviewSubmissionSchema change
    reviewSubmission.ts       # modify — persist approverSignatureUrl on approve
    reviewSubmission.test.ts   # modify — update existing tests, add new one
    uploadFile.ts                # modify — widen signature-purpose upload to spv/management
    uploadFile.test.ts            # modify — add one new test
    pdfTemplate.ts                  # new — pure HTML-building function (fully testable)
    pdfTemplate.test.ts              # new
    generateSubmissionPdf.ts          # new — Firestore trigger handler
    generateSubmissionPdf.test.ts      # new
    index.ts                            # modify — wire the new trigger
    package.json                         # modify — add puppeteer-core, @sparticuz/chromium
/app
  /(dashboard)
    /persetujuan
      page.tsx                          # modify — approver signature capture UI
```

---

## Task 1: `reviewSubmissionSchema` gains `approverSignatureUrl`

**Files:**
- Modify: `lib/schemas/submission.ts`
- Modify: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Update the failing tests**

In `lib/schemas/submission.test.ts`, replace the entire `describe("reviewSubmissionSchema", ...)` block with:

```typescript
describe("reviewSubmissionSchema", () => {
  it("requires rejectionNote when decision is reject", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "" });
    expect(result.success).toBe(false);
  });

  it("accepts reject with a non-empty rejectionNote", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "Data KM tidak sesuai" });
    expect(result.success).toBe(true);
  });

  it("accepts approve with approverSignatureUrl", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=abc",
    });
    expect(result.success).toBe(true);
  });

  it("accepts approve with rejectionNote null and a valid approverSignatureUrl (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      rejectionNote: null,
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=abc",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects reject with rejectionNote null", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: null });
    expect(result.success).toBe(false);
  });

  it("rejects approve without approverSignatureUrl", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(false);
  });

  it("rejects approve with approverSignatureUrl null", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve", approverSignatureUrl: null });
    expect(result.success).toBe(false);
  });

  it("accepts a data URL as approverSignatureUrl (drawn signature, not uploaded)", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      approverSignatureUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL — the tests expecting `approverSignatureUrl` to be required (or accepted) don't match current schema behavior yet.

- [ ] **Step 3: Update `lib/schemas/submission.ts`**

Replace the `reviewSubmissionSchema` and its type export (leave everything else in the file unchanged):

```typescript
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
  .refine(
    (data) => data.decision !== "approve" || (data.approverSignatureUrl && data.approverSignatureUrl.trim().length > 0),
    {
      message: "Tanda tangan approver wajib diisi saat approve",
      path: ["approverSignatureUrl"],
    }
  );

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS — 20 tests passing (9 in `createSubmissionSchema`, 8 in `reviewSubmissionSchema`, 3 in `uploadFileSchema`).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: require approverSignatureUrl on approve in reviewSubmissionSchema"
```

---

## Task 2: `reviewSubmission.ts` persists `approverSignatureUrl`

**Files:**
- Modify: `functions/src/schemas.ts`
- Modify: `functions/src/reviewSubmission.ts`
- Modify: `functions/src/reviewSubmission.test.ts` (needs emulator to actually run — see Environment note)

- [ ] **Step 1: Update the failing tests**

In `functions/src/reviewSubmission.test.ts`, make these three changes:

Replace the `"rejects reviewing a submission that isn't in diajukan"` test:

```typescript
  it("rejects reviewing a submission that isn't in diajukan", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-2", "disetujui");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler(
        { submissionId: "sub-2", decision: "approve", approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig" },
        { auth: { uid: "uid-spv" } } as any
      )
    ).rejects.toThrow(/diajukan/);
  });
```

Replace the `"approves and sets approverId/approverRole/status"` test:

```typescript
  it("approves and sets approverId/approverRole/status/approverSignatureUrl", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-3", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await reviewSubmissionHandler(
      { submissionId: "sub-3", decision: "approve", approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig" },
      { auth: { uid: "uid-spv" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("disetujui");
    expect(updated.data()!.approverId).toBe("uid-spv");
    expect(updated.data()!.approverRole).toBe("spv");
    expect(updated.data()!.approverSignatureUrl).toBe("https://drive.google.com/uc?export=view&id=sig");
  });
```

Add a new test right after it (still inside the same `describe` block, before `"rejects without rejectionNote"`):

```typescript
  it("rejects approve without approverSignatureUrl", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-6", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-6", decision: "approve" }, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });
```

- [ ] **Step 2 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/reviewSubmission.test.ts` here to verify the updated tests fail.

- [ ] **Step 3: Update `functions/src/schemas.ts`**

Replace the `reviewSubmissionSchema` and its type export in `functions/src/schemas.ts` with the exact same change as Task 1 Step 3 (this file is an intentional byte-for-byte duplicate of `lib/schemas/submission.ts`'s relevant exports):

```typescript
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
  .refine(
    (data) => data.decision !== "approve" || (data.approverSignatureUrl && data.approverSignatureUrl.trim().length > 0),
    {
      message: "Tanda tangan approver wajib diisi saat approve",
      path: ["approverSignatureUrl"],
    }
  );

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
```

- [ ] **Step 4: Update `functions/src/reviewSubmission.ts`**

In the `if (input.decision === "approve")` branch, add `approverSignatureUrl` to the `batch.update(submissionRef, {...})` call:

```typescript
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

(Everything else in the file is unchanged — the `else` branch for reject, the imports, the auth/role checks.)

- [ ] **Step 5 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/reviewSubmission.test.ts` here to verify all tests pass (6 tests total: the 5 original plus the new one).

- [ ] **Step 6: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add functions/src/schemas.ts functions/src/reviewSubmission.ts functions/src/reviewSubmission.test.ts
git commit -m "feat: persist approverSignatureUrl when a submission is approved"
```

---

## Task 3: `uploadFileHandler` allows approvers to upload a signature

**Files:**
- Modify: `functions/src/uploadFile.ts`
- Modify: `functions/src/uploadFile.test.ts` (needs emulator to actually run — see Environment note)

- [ ] **Step 1: Write the failing test**

In `functions/src/uploadFile.test.ts`, add this test right after `"uploads a valid signature and returns a direct-content Drive link (not the webViewLink)"` (still inside the `describe("uploadFileHandler", ...)` block):

```typescript
  it("allows spv to upload a signature (but not an attachment)", async () => {
    await seedUser("uid-spv", "spv");
    uploadToDriveMock.mockResolvedValue({ fileId: "file-3", webViewLink: "https://drive.google.com/file/d/file-3/view" });
    const { uploadFileHandler } = await import("./uploadFile");
    const result = await uploadFileHandler(
      { purpose: "signature", fileName: "ttd-spv.png", fileType: "image/png", fileData: "data:image/png;base64,aGVsbG8=" },
      { auth: { uid: "uid-spv" } } as any
    );
    expect(result.fileUrl).toBe("https://drive.google.com/uc?export=view&id=file-3");
  });
```

(The existing test `"rejects when caller role is not admin_cabang/snd"` already covers spv being rejected for `purpose: "attachment"` via `VALID_PAYLOAD` — no change needed there.)

- [ ] **Step 2 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/uploadFile.test.ts` here to verify the new test fails (spv currently rejected outright, regardless of purpose).

- [ ] **Step 3: Update `functions/src/uploadFile.ts`**

Replace the full contents:

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";
import { uploadFileSchema, UploadFileInput } from "./schemas";
import { uploadToDrive } from "./googleDrive";

interface CallerContext {
  auth?: { uid: string };
}

const MAX_SIZE_BYTES: Record<UploadFileInput["purpose"], number> = {
  attachment: 10 * 1024 * 1024,
  signature: 2 * 1024 * 1024,
};

const ALLOWED_MIME_TYPES: Record<UploadFileInput["purpose"], readonly string[]> = {
  attachment: ["image/jpeg", "image/png", "application/pdf"],
  signature: ["image/png"],
};

// Attachments are only ever added by the requester (admin_cabang/snd) when
// creating/resubmitting a submission. Signatures are needed by both the
// requester (submit) AND the approver (approve) — see reviewSubmission.ts.
const ALLOWED_ROLES_BY_PURPOSE: Record<UploadFileInput["purpose"], readonly string[]> = {
  attachment: ["admin_cabang", "snd"],
  signature: ["admin_cabang", "snd", "spv", "management"],
};

export async function uploadFileHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  // Schema validation runs before the role check here (rather than after, as
  // in sibling handlers) because which roles are allowed depends on
  // input.purpose, which isn't known until the payload is parsed.
  const parsed = uploadFileSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UploadFileInput = parsed.data;

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !ALLOWED_ROLES_BY_PURPOSE[input.purpose].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Anda tidak punya izin untuk upload file jenis ini.");
  }

  if (!ALLOWED_MIME_TYPES[input.purpose].includes(input.fileType)) {
    throw new HttpsError("invalid-argument", "Tipe file tidak didukung.");
  }

  // input.fileData is normally a data URL like "data:image/png;base64,....".
  // The declared input.fileType is client-supplied, so cross-check it against
  // the mime type embedded in the data URL's own prefix when one is present
  // (partial mitigation only — this doesn't inspect the actual file bytes).
  const commaIndex = input.fileData.indexOf(",");
  if (commaIndex !== -1) {
    const prefix = input.fileData.slice(0, commaIndex);
    const mimeMatch = prefix.match(/^data:([^;]+)/);
    if (mimeMatch && mimeMatch[1] !== input.fileType) {
      throw new HttpsError("invalid-argument", "Tipe file tidak didukung.");
    }
  }
  const base64Payload = commaIndex !== -1 ? input.fileData.slice(commaIndex + 1) : input.fileData;
  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.byteLength > MAX_SIZE_BYTES[input.purpose]) {
    const maxMb = MAX_SIZE_BYTES[input.purpose] / (1024 * 1024);
    throw new HttpsError("invalid-argument", `Ukuran file maksimal ${maxMb}MB.`);
  }

  try {
    const { fileId, webViewLink } = await uploadToDrive({
      fileName: input.fileName,
      mimeType: input.fileType,
      buffer,
    });
    // webViewLink is a Drive HTML viewer page, not raw image bytes — fine for
    // attachments (meant to be opened in a new tab) but useless as an <img src>.
    // Signatures need a link that actually serves the file's bytes so they can
    // be embedded directly (e.g. in the generated PDF).
    const fileUrl =
      input.purpose === "signature" ? `https://drive.google.com/uc?export=view&id=${fileId}` : webViewLink;
    return { fileId, fileUrl, fileName: input.fileName, fileType: input.fileType };
  } catch (error) {
    console.error("uploadFile: Drive upload failed", error);
    throw new HttpsError("internal", "Gagal upload file, coba lagi.");
  }
}
```

- [ ] **Step 4 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/uploadFile.test.ts` here to verify all tests pass (9 tests total: 8 original plus the new one).

- [ ] **Step 5: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/uploadFile.ts functions/src/uploadFile.test.ts
git commit -m "feat: allow spv/management to upload a signature via uploadFile"
```

---

## Task 4: Antrian Persetujuan — approver signature capture

**Files:**
- Modify: `app/(dashboard)/persetujuan/page.tsx`

- [ ] **Step 1: Replace the full contents of `app/(dashboard)/persetujuan/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { httpsCallable, getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";

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

type QueueRow = { id: string; submissionNumber: string; type: string; branch: string };

export default function PersetujuanPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [noteBySubmission, setNoteBySubmission] = useState<Record<string, string>>({});
  const [signatureBySubmission, setSignatureBySubmission] = useState<Record<string, string>>({});
  const [signatureModeBySubmission, setSignatureModeBySubmission] = useState<Record<string, "gambar" | "upload">>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionErrorBySubmission, setActionErrorBySubmission] = useState<Record<string, string>>({});

  useEffect(() => {
    // Per the brief's role table, superadmin can read/monitor but not approve/reject —
    // matches reviewSubmissionHandler's own role check, so this page's action buttons
    // are only ever shown to roles that can actually use them.
    if (!loading && appUser && !["spv", "management"].includes(appUser.role)) {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "submissions"), where("status", "==", "diajukan"), orderBy("submittedAt", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            branch: d.data().branch,
          }))
        );
      },
      (err) => {
        setListError(err.code);
      }
    );
  }, []);

  function handleSignatureModeChange(submissionId: string, mode: "gambar" | "upload") {
    setSignatureModeBySubmission((prev) => ({ ...prev, [submissionId]: mode }));
    setSignatureBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
  }

  async function handleDecision(submissionId: string, decision: "approve" | "reject") {
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      const reviewSubmission = httpsCallable(functions, "reviewSubmission");
      await reviewSubmission({
        submissionId,
        decision,
        rejectionNote: noteBySubmission[submissionId],
        approverSignatureUrl: decision === "approve" ? signatureBySubmission[submissionId] : undefined,
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

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Antrian Persetujuan</h1>
      <ul className="space-y-3">
        {rows.map((row) => {
          const mode = signatureModeBySubmission[row.id] ?? "gambar";
          const hasSignature = !!signatureBySubmission[row.id];
          return (
            <li key={row.id} className="space-y-3 rounded border p-3">
              <div className="flex items-center justify-between">
                <span>
                  {row.submissionNumber} — {row.type} ({row.branch})
                </span>
                <StatusBadge status="diajukan" />
              </div>
              <Textarea
                placeholder="Catatan (wajib jika reject)"
                value={noteBySubmission[row.id] ?? ""}
                onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
              />
              <div className="space-y-2">
                <p className="text-sm font-medium">Tanda Tangan Approver (wajib untuk Setujui)</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={mode === "gambar" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleSignatureModeChange(row.id, "gambar")}
                  >
                    Gambar
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "upload" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleSignatureModeChange(row.id, "upload")}
                  >
                    Upload File
                  </Button>
                </div>
                {mode === "gambar" ? (
                  <SignaturePad
                    onChange={(dataUrl) =>
                      setSignatureBySubmission((prev) => ({ ...prev, [row.id]: dataUrl ?? "" }))
                    }
                  />
                ) : (
                  <FileUpload
                    purpose="signature"
                    onUploaded={(file) =>
                      setSignatureBySubmission((prev) => ({ ...prev, [row.id]: file.fileUrl }))
                    }
                  />
                )}
              </div>
              {actionErrorBySubmission[row.id] && (
                <p className="text-sm text-red-600">{actionErrorBySubmission[row.id]}</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busyId === row.id || !hasSignature}
                  onClick={() => handleDecision(row.id, "approve")}
                >
                  Setujui
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === row.id}
                  onClick={() => handleDecision(row.id, "reject")}
                >
                  Tolak
                </Button>
              </div>
            </li>
          );
        })}
        {listError && (
          <li className="text-sm text-red-600">Gagal memuat antrian. Coba muat ulang halaman.</li>
        )}
        {!listError && rows.length === 0 && (
          <li className="text-sm text-muted-foreground">Tidak ada pengajuan menunggu review.</li>
        )}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build` (if this fails at the prerender stage with a "Firebase client config is missing" error, temporarily `cp .env.local.example .env.local`, rerun, then delete `.env.local` again and confirm `git status` shows it untracked — same as prior sub-projects in this repo).
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/persetujuan/page.tsx"
git commit -m "feat: capture approver signature in Antrian Persetujuan"
```

---

## Task 5: `pdfTemplate.ts` — pure HTML-building function

**Files:**
- Create: `functions/src/pdfTemplate.ts`
- Test: `functions/src/pdfTemplate.test.ts`

This task is fully runnable on this machine — no Firestore, no Puppeteer.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/pdfTemplate.test.ts
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

  it("includes both signature image URLs", () => {
    const html = buildSubmissionPdfHtml(baseData);
    expect(html).toContain(baseData.requesterSignatureUrl);
    expect(html).toContain(baseData.approverSignatureUrl);
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run functions/src/pdfTemplate.test.ts`
Expected: FAIL — `Cannot find module './pdfTemplate'`.

- [ ] **Step 3: Write `functions/src/pdfTemplate.ts`**

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
      <img src="${data.requesterSignatureUrl}" alt="Tanda tangan pemohon" />
      <div class="signature-line">${escapeHtml(data.requesterName)}</div>
    </div>
    <div class="signature-block">
      <div>Mengetahui</div>
      <img src="${data.approverSignatureUrl}" alt="Tanda tangan approver" />
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
  </div>
  <div class="footer">Dokumen digenerate otomatis oleh sistem pada ${formatDateTime(new Date())}.</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/pdfTemplate.test.ts`
Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/pdfTemplate.ts functions/src/pdfTemplate.test.ts
git commit -m "feat: add PDF HTML template builder for submissions"
```

---

## Task 6: Add Puppeteer dependencies

**Files:**
- Modify: `functions/package.json`

This project's Cloud Functions target Node 20 (`engines.node: "20"` in `functions/package.json`). The newest `puppeteer-core` (25.x) and `@sparticuz/chromium` (148.x+) both require Node ≥22, so pin the last versions that support Node 20.

- [ ] **Step 1: Add the dependencies**

In `functions/package.json`, add to the `"dependencies"` object (keep existing entries — `firebase-admin`, `firebase-functions`, `googleapis`, `zod` — unchanged):

```json
    "@sparticuz/chromium": "147.0.2",
    "puppeteer-core": "24.43.1",
```

(Insert alphabetically among the existing dependency entries.)

- [ ] **Step 2: Install**

Run: `npm --prefix functions install`
Expected: installs successfully, `functions/node_modules/puppeteer-core` and `functions/node_modules/@sparticuz/chromium` both exist afterward.

- [ ] **Step 3: Verify the functions project still type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds (no code imports these packages yet, so this just confirms the install didn't break anything).

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "chore: add puppeteer-core and @sparticuz/chromium for PDF generation"
```

---

## Task 7: `generateSubmissionPdf.ts` — Firestore trigger handler

**Files:**
- Create: `functions/src/generateSubmissionPdf.ts`
- Test: `functions/src/generateSubmissionPdf.test.ts`

`shouldGeneratePdf`'s tests are fully runnable here (pure function, no I/O). `generateSubmissionPdfHandler`'s tests need the Firestore emulator AND mock out `puppeteer-core`/`@sparticuz/chromium` entirely (the real packages can't run on this machine at all) — write them, but only the `shouldGeneratePdf` describe block can actually be verified here.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/generateSubmissionPdf.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { shouldGeneratePdf } from "./generateSubmissionPdf";

describe("shouldGeneratePdf", () => {
  it("returns true when status transitions into disetujui", () => {
    expect(shouldGeneratePdf({ status: "diajukan" }, { status: "disetujui" })).toBe(true);
  });

  it("returns false when status was already disetujui (avoids re-triggering)", () => {
    expect(shouldGeneratePdf({ status: "disetujui" }, { status: "disetujui" })).toBe(false);
  });

  it("returns false when the new status isn't disetujui", () => {
    expect(shouldGeneratePdf({ status: "diajukan" }, { status: "perlu_revisi" })).toBe(false);
  });
});

// The rest of this file requires the Firestore Emulator (FIRESTORE_EMULATOR_HOST)
// AND mocks out puppeteer-core/@sparticuz/chromium entirely, since the real
// packages need a Linux Chromium binary this Windows machine can't run — see
// docs/superpowers/specs/2026-08-27-generate-submission-pdf-design.md "Batasan testing".
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-generatepdf-test";

const fft = functionsTest({ projectId: "demo-pengajuan-generatepdf-test" }, undefined);
let testEnv: RulesTestEnvironment;

const launchMock = vi.fn();
vi.mock("puppeteer-core", () => ({
  default: { launch: (...args: unknown[]) => launchMock(...args) },
}));
vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: [],
    defaultViewport: null,
    executablePath: vi.fn().mockResolvedValue("/fake/chromium"),
    headless: true,
  },
}));

const uploadToDriveMock = vi.fn();
vi.mock("./googleDrive", () => ({
  uploadToDrive: uploadToDriveMock,
}));

async function seedUser(uid: string, name: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name,
    username: uid,
    role: "admin_cabang",
    branch: "WHO",
    department: "Ops",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("generateSubmissionPdfHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-generatepdf-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    launchMock.mockReset();
    uploadToDriveMock.mockReset();
  });

  afterAll(() => fft.cleanup());

  it("renders the PDF, uploads it to Drive, and updates status to siap_dikirim", async () => {
    await seedUser("uid-requester", "Budi Santoso");
    await seedUser("uid-approver", "Siti Aminah");

    const admin = testEnv.unauthenticatedContext().firestore();
    const submissionRef = admin.collection("submissions").doc("sub-1");
    await submissionRef.set({
      submissionNumber: "001/WHO/VIII/2026",
      type: "kendaraan",
      subType: "service_berkala",
      status: "disetujui",
      requesterId: "uid-requester",
      requesterSignatureUrl: "https://drive.google.com/uc?export=view&id=req-sig",
      approverId: "uid-approver",
      approverRole: "spv",
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=approver-sig",
      branch: "WHO",
      department: "Operasional",
      position: "Admin Cabang",
      submittedAt: new Date(),
      approvedAt: new Date(),
    });
    await submissionRef.collection("items").doc("item-1").set({
      itemName: "Toyota Avanza",
      brandType: "Toyota Avanza 1.3",
      km: 45000,
      quantity: 1,
      unit: "unit",
      description: "Service 40rb km",
    });

    const fakePage = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
    };
    const fakeBrowser = {
      newPage: vi.fn().mockResolvedValue(fakePage),
      close: vi.fn().mockResolvedValue(undefined),
    };
    launchMock.mockResolvedValue(fakeBrowser);
    uploadToDriveMock.mockResolvedValue({ fileId: "pdf-1", webViewLink: "https://drive.google.com/file/d/pdf-1/view" });

    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    const submissionSnap = await submissionRef.get();
    await generateSubmissionPdfHandler("sub-1", submissionSnap.data()!);

    expect(uploadToDriveMock).toHaveBeenCalledWith({
      fileName: "001-WHO-VIII-2026.pdf",
      mimeType: "application/pdf",
      buffer: expect.any(Buffer),
    });

    const updated = await submissionRef.get();
    expect(updated.data()!.status).toBe("siap_dikirim");
    expect(updated.data()!.pdfUrl).toBe("https://drive.google.com/file/d/pdf-1/view");

    const history = await submissionRef.collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "siap_dikirim" && d.data().actorId === "system")).toBe(true);
  });

  it("logs and exits without throwing if the requester or approver user doc is missing", async () => {
    const admin = testEnv.unauthenticatedContext().firestore();
    const submissionRef = admin.collection("submissions").doc("sub-2");
    await submissionRef.set({
      submissionNumber: "002/WHO/VIII/2026",
      type: "kendaraan",
      subType: "service_berkala",
      status: "disetujui",
      requesterId: "missing-requester",
      requesterSignatureUrl: "https://drive.google.com/uc?export=view&id=req-sig",
      approverId: "missing-approver",
      approverRole: "spv",
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=approver-sig",
      branch: "WHO",
      department: "Operasional",
      position: "Admin Cabang",
      submittedAt: new Date(),
      approvedAt: new Date(),
    });

    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    const submissionSnap = await submissionRef.get();
    await expect(generateSubmissionPdfHandler("sub-2", submissionSnap.data()!)).resolves.toBeUndefined();
    expect(uploadToDriveMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the runnable half to verify it fails**

Run: `npx vitest run functions/src/generateSubmissionPdf.test.ts -t shouldGeneratePdf`
Expected: FAIL — `Cannot find module './generateSubmissionPdf'`.

- [ ] **Step 3: Write `functions/src/generateSubmissionPdf.ts`**

```typescript
import { FieldValue } from "firebase-admin/firestore";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { db } from "./admin";
import { buildSubmissionPdfHtml, SubmissionPdfData } from "./pdfTemplate";
import { uploadToDrive } from "./googleDrive";

const APPROVER_ROLE_VALUES = ["spv", "management"];

export function shouldGeneratePdf(
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): boolean {
  return before.status !== "disetujui" && after.status === "disetujui";
}

export async function generateSubmissionPdfHandler(
  submissionId: string,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const submissionRef = db.collection("submissions").doc(submissionId);

  const [itemsSnap, requesterSnap, approverSnap] = await Promise.all([
    submissionRef.collection("items").get(),
    db.collection("users").doc(after.requesterId).get(),
    db.collection("users").doc(after.approverId).get(),
  ]);

  const requester = requesterSnap.data();
  const approver = approverSnap.data();
  if (!requester || !approver) {
    console.error(`generateSubmissionPdfHandler: missing requester or approver user doc for submission ${submissionId}`);
    return;
  }
  if (!APPROVER_ROLE_VALUES.includes(after.approverRole)) {
    console.error(`generateSubmissionPdfHandler: unexpected approverRole "${after.approverRole}" for submission ${submissionId}`);
    return;
  }

  const pdfData: SubmissionPdfData = {
    submissionNumber: after.submissionNumber,
    type: after.type,
    subType: after.subType,
    branch: after.branch,
    department: after.department,
    position: after.position,
    requesterName: requester.name,
    requesterSignatureUrl: after.requesterSignatureUrl,
    approverName: approver.name,
    approverRole: after.approverRole,
    approverSignatureUrl: after.approverSignatureUrl,
    submittedAt: after.submittedAt?.toDate() ?? new Date(),
    approvedAt: after.approvedAt?.toDate() ?? new Date(),
    items: itemsSnap.docs.map((doc) => {
      const item = doc.data();
      return {
        itemName: item.itemName as string,
        brandType: item.brandType as string,
        km: (item.km as number | null) ?? null,
        quantity: item.quantity as number,
        unit: item.unit as string,
        description: item.description as string,
      };
    }),
  };

  const html = buildSubmissionPdfHtml(pdfData);

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
  } finally {
    await browser.close();
  }

  const { webViewLink } = await uploadToDrive({
    fileName: `${pdfData.submissionNumber.replace(/\//g, "-")}.pdf`,
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const batch = db.batch();
  batch.update(submissionRef, {
    pdfUrl: webViewLink,
    status: "siap_dikirim",
  });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "siap_dikirim",
    note: null,
    actorId: "system",
    actorRole: "system",
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
```

- [ ] **Step 4: Run the runnable half to verify it passes**

Run: `npx vitest run functions/src/generateSubmissionPdf.test.ts -t shouldGeneratePdf`
Expected: PASS — 3 tests passing.

- [ ] **Step 5 (SKIP — needs emulator + mocked Puppeteer, see Environment note):** would normally run `npx vitest run functions/src/generateSubmissionPdf.test.ts` (full file, both describe blocks) here.

- [ ] **Step 6: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add functions/src/generateSubmissionPdf.ts functions/src/generateSubmissionPdf.test.ts
git commit -m "feat: add generateSubmissionPdf Firestore trigger handler"
```

---

## Task 8: Wire the trigger into `functions/src/index.ts`

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add the import and export**

Add this import near the top of `functions/src/index.ts`, alongside the other handler imports:

```typescript
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { shouldGeneratePdf, generateSubmissionPdfHandler } from "./generateSubmissionPdf";
```

Add this export at the end of the file:

```typescript
// Puppeteer needs meaningfully more memory/time than the default 256MiB/60s —
// see docs/superpowers/specs/2026-08-27-generate-submission-pdf-design.md.
export const generateSubmissionPdf = onDocumentUpdated(
  { document: "submissions/{submissionId}", memory: "1GiB", timeoutSeconds: 120 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || !shouldGeneratePdf(before, after)) return;
    await generateSubmissionPdfHandler(event.params.submissionId, after);
  }
);
```

- [ ] **Step 2: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: wire generateSubmissionPdf as a Firestore trigger"
```

---

## Task 9: Manual end-to-end verification (needs emulator + Java + Linux Chromium — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Deploy or emulate on a Linux-capable environment**

This entire flow (approver signature capture → approve → Firestore trigger → Puppeteer render → Drive upload → `siap_dikirim`) can only be verified end-to-end either (a) after deploying to real Firebase Cloud Functions (Linux runtime), or (b) on a development machine with Java installed AND a Linux/WSL environment so `@sparticuz/chromium`'s bundled binary can actually execute. Neither is available on this machine.

- [ ] **Step 2: Once available, verify manually**

Seed data, log in as an `admin_cabang` user, submit a submission, log in as `spv`, draw or upload a signature in Antrian Persetujuan, click Setujui. Expected: submission status becomes `disetujui` immediately; within a few seconds it advances to `siap_dikirim` with a `pdfUrl` pointing at a Drive-hosted PDF that opens and shows the correct submission number, items, and both signatures.

---

## Self-Review Notes

- Spec coverage: approver signature capture (Tasks 1–4), PDF template per the approved layout (Task 5), Puppeteer + Drive upload pipeline via Firestore trigger (Tasks 6–8), `actorId: "system"`/`actorRole: "system"` statusHistory convention (Task 7's `generateSubmissionPdfHandler`), error handling via `console.error` + early return / uncaught rejection rather than a dedicated error status (Task 7) — all covered. Retry logic and PDF preview are explicitly out of scope per the spec and have no task.
- Type consistency: `SubmissionPdfData`/`SubmissionPdfItem` (Task 5) match exactly what Task 7's `generateSubmissionPdfHandler` constructs and passes to `buildSubmissionPdfHtml`. `shouldGeneratePdf`/`generateSubmissionPdfHandler` names match between Task 7's implementation and Task 8's import. `approverSignatureUrl` field name matches across Task 1 (schema), Task 2 (handler + persistence), and Task 4 (client payload).
- Both intentionally-duplicated schema pairs (`lib/schemas/submission.ts` ⟷ `functions/src/schemas.ts`) receive the identical edit in Tasks 1 and 2, keeping them in sync per the established codebase convention.
