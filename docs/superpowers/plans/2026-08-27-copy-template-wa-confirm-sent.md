# Copy Template WA + confirmSentToGa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the requester copy a WhatsApp message template and confirm they've sent it to GA, advancing the submission from `siap_dikirim` to `on_proses_ga`, per `docs/superpowers/specs/2026-08-27-copy-template-wa-confirm-sent-design.md`.

**Architecture:** A pure `buildWaTemplate` function (client-side, `lib/wa-template.ts`) builds the message text from submission fields already available on the detail page — no new Firestore reads needed. A new `confirmSentToGa` Cloud Function callable (owner-only, following the existing `reviewSubmission`/`createUser` handler pattern) advances the status and writes a `statusHistory` entry. The detail page (`app/(dashboard)/pengajuan/[id]/page.tsx`) gets a new conditional section for `status === "siap_dikirim"`.

**Tech Stack:** TypeScript, Zod, Vitest, Firebase Functions v2 callable, `navigator.clipboard`.

**Environment note:** Same constraints as prior plans — no Java, so Firestore-Emulator-backed tests cannot run on this machine. `lib/wa-template.ts`'s tests have no such dependency and MUST be run and verified.

---

## File Structure

```
/lib
  wa-template.ts           # new — buildWaTemplate, pure function
  wa-template.test.ts        # new
  /schemas
    submission.ts             # modify — add confirmSentToGaSchema
    submission.test.ts         # modify — add its tests
/functions
  /src
    schemas.ts                  # modify — duplicate confirmSentToGaSchema
    confirmSentToGa.ts            # new
    confirmSentToGa.test.ts        # new (needs emulator)
    index.ts                        # modify — wire the callable
/app
  /(dashboard)
    /pengajuan
      /[id]
        page.tsx                    # modify — WA template + confirm section
```

---

## Task 1: `lib/wa-template.ts` — pure WA template builder

**Files:**
- Create: `lib/wa-template.ts`
- Test: `lib/wa-template.test.ts`

This task is fully runnable on this machine — no Firebase, no I/O.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/wa-template.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/wa-template.test.ts` from repo root (`c:\Users\TSI-GA_04\pengajuan`).
Expected: FAIL — `Cannot find module './wa-template'`.

- [ ] **Step 3: Write `lib/wa-template.ts`**

```typescript
export type WaTemplateSubmission = {
  submissionNumber: string;
  type: string;
  subType: string;
  branch: string;
  pdfUrl: string;
};

export function buildWaTemplate(submission: WaTemplateSubmission, requesterName: string): string {
  return `Halo GA, mohon diproses pengajuan berikut:

No. Pengajuan: ${submission.submissionNumber}
Jenis: ${submission.type} (${submission.subType})
Cabang: ${submission.branch}
Pengaju: ${requesterName}

Dokumen: ${submission.pdfUrl}

Terima kasih.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/wa-template.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/wa-template.ts lib/wa-template.test.ts
git commit -m "feat: add WA template builder for confirmSentToGa flow"
```

---

## Task 2: `confirmSentToGaSchema` in `lib/schemas/submission.ts`

**Files:**
- Modify: `lib/schemas/submission.ts`
- Modify: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Write the failing test**

First, update the top-of-file import in `lib/schemas/submission.test.ts` from:

```typescript
import { createSubmissionSchema, reviewSubmissionSchema, uploadFileSchema } from "./submission";
```

to:

```typescript
import { createSubmissionSchema, reviewSubmissionSchema, uploadFileSchema, confirmSentToGaSchema } from "./submission";
```

Then add this new `describe` block to the end of the file (after the existing `describe("uploadFileSchema", ...)` block):

```typescript
describe("confirmSentToGaSchema", () => {
  it("accepts a valid submissionId", () => {
    expect(confirmSentToGaSchema.safeParse({ submissionId: "abc" }).success).toBe(true);
  });

  it("rejects an empty submissionId", () => {
    expect(confirmSentToGaSchema.safeParse({ submissionId: "" }).success).toBe(false);
  });

  it("rejects a missing submissionId", () => {
    expect(confirmSentToGaSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL — `confirmSentToGaSchema` is not exported yet.

- [ ] **Step 3: Add `confirmSentToGaSchema` to `lib/schemas/submission.ts`**

Add this at the end of the file (after `uploadFileSchema`/`UploadFileInput`):

```typescript
export const confirmSentToGaSchema = z.object({
  submissionId: z.string().min(1),
});

export type ConfirmSentToGaInput = z.infer<typeof confirmSentToGaSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS — 23 tests passing total in the file (20 from before, plus 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add confirmSentToGaSchema"
```

---

## Task 3: `confirmSentToGa` Cloud Function

**Files:**
- Modify: `functions/src/schemas.ts`
- Create: `functions/src/confirmSentToGa.ts`
- Test: `functions/src/confirmSentToGa.test.ts` (needs emulator — see Environment note)

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/confirmSentToGa.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-confirmsent-test";

const fft = functionsTest({ projectId: "demo-pengajuan-confirmsent-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "T",
    username: uid,
    role,
    branch: "WHO",
    department: "Ops",
    position: "Staff",
    createdAt: new Date(),
  });
}

async function seedSubmission(id: string, status: string, requesterId: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "001/WHO/VIII/2026",
    status,
    requesterId,
    branch: "WHO",
  });
}

describe("confirmSentToGaHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-confirmsent-test",
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
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-1" }, { auth: undefined })
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when caller is not the requester", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedUser("uid-other", "admin_cabang");
    await seedSubmission("sub-1", "siap_dikirim", "uid-admin");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-1" }, { auth: { uid: "uid-other" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't siap_dikirim", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-2", "on_proses_ga", "uid-admin");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("confirms and sets status/sentToGaAt/statusHistory", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-3", "siap_dikirim", "uid-admin");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    const result = await confirmSentToGaHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-admin" } } as any);
    expect(result.status).toBe("on_proses_ga");

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("on_proses_ga");
    expect(updated.data()!.sentToGaAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-3").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "on_proses_ga" && d.data().actorId === "uid-admin")).toBe(true);
  });

  it("rejects an empty submissionId", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });
});
```

- [ ] **Step 2 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/confirmSentToGa.test.ts` here to verify it fails.

- [ ] **Step 3: Add `confirmSentToGaSchema` to `functions/src/schemas.ts`**

Add at the end of the file (byte-for-byte identical to Task 2's addition to `lib/schemas/submission.ts` — this file is an intentional duplicate):

```typescript
export const confirmSentToGaSchema = z.object({
  submissionId: z.string().min(1),
});

export type ConfirmSentToGaInput = z.infer<typeof confirmSentToGaSchema>;
```

- [ ] **Step 4: Write `functions/src/confirmSentToGa.ts`**

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { confirmSentToGaSchema, ConfirmSentToGaInput } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function confirmSentToGaHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = confirmSentToGaSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ConfirmSentToGaInput = parsed.data;

  const submissionRef = db.collection("submissions").doc(input.submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "siap_dikirim") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus siap_dikirim yang bisa dikonfirmasi.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, {
    status: "on_proses_ga",
    sentToGaAt: FieldValue.serverTimestamp(),
  });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "on_proses_ga",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "on_proses_ga" as const };
}
```

- [ ] **Step 5 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/confirmSentToGa.test.ts` here to verify all 5 tests pass.

- [ ] **Step 6: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add functions/src/schemas.ts functions/src/confirmSentToGa.ts functions/src/confirmSentToGa.test.ts
git commit -m "feat: add confirmSentToGa callable"
```

---

## Task 4: Wire `confirmSentToGa` into `functions/src/index.ts`

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add the import and export**

Add this import near the top, alongside the other handler imports:

```typescript
import { confirmSentToGaHandler } from "./confirmSentToGa";
```

Add this export (position doesn't matter, e.g. right after `resetUserPassword`):

```typescript
export const confirmSentToGa = onCall((request) =>
  confirmSentToGaHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
```

- [ ] **Step 2: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: export confirmSentToGa callable"
```

---

## Task 5: Detail page — WA template + confirm section

**Files:**
- Modify: `app/(dashboard)/pengajuan/[id]/page.tsx`

- [ ] **Step 1: Replace the full contents of `app/(dashboard)/pengajuan/[id]/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, collection, orderBy, query, DocumentData } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { buildWaTemplate } from "@/lib/wa-template";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    const unsubSub = onSnapshot(
      doc(db, "submissions", params.id),
      (snap) => {
        setSubmission(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      (err) => {
        setError(err.code);
      }
    );
    const historyQuery = query(collection(db, "submissions", params.id, "statusHistory"), orderBy("timestamp", "asc"));
    const unsubHistory = onSnapshot(
      historyQuery,
      (snap) => {
        setHistory(
          snap.docs.map((d) => ({
            id: d.id,
            status: d.data().status,
            note: d.data().note,
            actorRole: d.data().actorRole,
            timestamp: d.data().timestamp?.toDate() ?? new Date(),
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
    return () => {
      unsubSub();
      unsubHistory();
    };
  }, [params.id]);

  async function handleCopy() {
    if (!submission || !appUser) return;
    const text = buildWaTemplate(
      {
        submissionNumber: submission.submissionNumber,
        type: submission.type,
        subType: submission.subType,
        branch: submission.branch,
        pdfUrl: submission.pdfUrl,
      },
      appUser.name
    );
    await navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }

  async function handleConfirm() {
    if (!submission) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      const confirmSentToGa = httpsCallable(functions, "confirmSentToGa");
      await confirmSentToGa({ submissionId: submission.id });
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal konfirmasi.");
    } finally {
      setConfirming(false);
    }
  }

  if (error) {
    return (
      <main className="p-6 text-sm text-red-600">
        Pengajuan tidak ditemukan atau Anda tidak punya akses.
      </main>
    );
  }

  if (!submission) {
    return <main className="p-6 text-sm text-muted-foreground">Memuat...</main>;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{submission.submissionNumber}</h1>
        <StatusBadge status={submission.status} />
      </div>

      {submission.status === "perlu_revisi" && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Catatan revisi:</p>
          <p>{submission.rejectionNote}</p>
          <Link href={`/pengajuan/new?resubmit=${submission.id}`}>
            <Button className="mt-2" size="sm">
              Revisi & Ajukan Ulang
            </Button>
          </Link>
        </div>
      )}

      {submission.status === "siap_dikirim" && appUser && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-medium">Kirim ke GA lewat WhatsApp</p>
          <a href={submission.pdfUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            Lihat PDF
          </a>
          <Textarea
            readOnly
            rows={8}
            value={buildWaTemplate(
              {
                submissionNumber: submission.submissionNumber,
                type: submission.type,
                subType: submission.subType,
                branch: submission.branch,
                pdfUrl: submission.pdfUrl,
              },
              appUser.name
            )}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              Salin Template
            </Button>
            {copyFeedback && <span className="text-sm text-green-600">Disalin!</span>}
          </div>
          {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
          <Button type="button" size="sm" disabled={confirming} onClick={handleConfirm}>
            {confirming ? "Memproses..." : "Konfirmasi Sudah Dikirim ke GA"}
          </Button>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-medium">Riwayat Status</h2>
        <SubmissionTimeline entries={history} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if it fails at the prerender stage with a missing-Firebase-config error, rerun, then delete `.env.local` again afterward and confirm `git status` shows it untracked — same as prior sub-projects).
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/pengajuan/[id]/page.tsx"
git commit -m "feat: add Copy Template WA and confirm-sent-to-GA UI"
```

---

## Task 6: Manual end-to-end verification (needs emulator + Java — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Once Java/emulator is available, verify manually**

Seed data, submit and approve a submission through to `siap_dikirim` (requires the full flow from prior sub-projects, including a real PDF render), then as the requester open its detail page. Expected: "Kirim ke GA lewat WhatsApp" section appears with a working "Lihat PDF" link, the template textarea shows the expected message, "Salin Template" copies it to the clipboard (verify by pasting elsewhere) and shows "Disalin!" briefly, and "Konfirmasi Sudah Dikirim ke GA" advances the status to `on_proses_ga` — the section disappears immediately (realtime) and the status badge/timeline update to reflect it.

---

## Self-Review Notes

- Spec coverage: two-step copy/confirm UI (Task 5), no WhatsApp deep-link (not built, correctly absent), WA template content matching the approved draft (Task 1), `confirmSentToGa` owner-only + status-guarded (Task 3), `sentToGaAt` + `statusHistory` with real actor identity (not the `"system"` sentinel, since this is a manual user action) — all covered.
- Type consistency: `WaTemplateSubmission`/`buildWaTemplate` (Task 1) match exactly how Task 5 constructs the object passed to it. `confirmSentToGaSchema`/`ConfirmSentToGaInput` names match between Task 2 (`lib/schemas/submission.ts`), Task 3 (`functions/src/schemas.ts` duplicate + `confirmSentToGa.ts` consumer), and Task 4 (`index.ts` import — actually `confirmSentToGaHandler`, not the schema directly, which is correct since `index.ts` only imports the handler).
