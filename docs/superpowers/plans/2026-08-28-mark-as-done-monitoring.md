# Tandai Selesai + Dashboard Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a requester mark an `on_proses_ga` submission as `selesai`, and add a Dashboard Monitoring page showing every accessible submission with per-stage durations from `statusHistory`, per `docs/superpowers/specs/2026-08-28-mark-as-done-monitoring-design.md`.

**Architecture:** `markAsDone` is a new Cloud Function callable following the exact same shape as the existing `confirmSentToGa` (owner-only, status-guarded, batch update + `statusHistory` write). The monitoring dashboard is a new page + a per-row component (`MonitoringRow`) that each independently subscribe to their own submission's `statusHistory` subcollection; a pure `lib/monitoring.ts` module computes stage durations from that data with no Firebase dependency.

**Tech Stack:** TypeScript, Zod, Vitest, Firebase Functions v2 callable, Firestore `onSnapshot`.

**Environment note:** Same constraints as prior plans — no Java, so Firestore-Emulator-backed tests cannot run on this machine. `lib/schemas/submission.ts` and `lib/monitoring.ts` have no such dependency and MUST be run and verified. UI pages have no automated tests in this codebase (consistent with `/pengajuan`, `/persetujuan`, `/admin`, etc.) — verified via `npm run build` only.

---

## File Structure

```
/lib
  monitoring.ts             # new — computeStageDurations, formatDuration, pure
  monitoring.test.ts          # new
  /schemas
    submission.ts               # modify — add markAsDoneSchema
    submission.test.ts           # modify — add its tests
/functions
  /src
    schemas.ts                    # modify — duplicate markAsDoneSchema
    markAsDone.ts                   # new
    markAsDone.test.ts                # new (needs emulator)
    index.ts                            # modify — wire the callable
/components
  /monitoring-row
    MonitoringRow.tsx                    # new
/app
  /(dashboard)
    layout.tsx                             # modify — nav link
    /pengajuan
      /[id]
        page.tsx                             # modify — Tandai Selesai section
    /monitoring
      page.tsx                                # new
```

---

## Task 1: `markAsDoneSchema` in `lib/schemas/submission.ts`

**Files:**
- Modify: `lib/schemas/submission.ts`
- Modify: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Write the failing test**

First, update the top-of-file import in `lib/schemas/submission.test.ts` from:

```typescript
import { createSubmissionSchema, reviewSubmissionSchema, uploadFileSchema, confirmSentToGaSchema } from "./submission";
```

to:

```typescript
import { createSubmissionSchema, reviewSubmissionSchema, uploadFileSchema, confirmSentToGaSchema, markAsDoneSchema } from "./submission";
```

Then add this new `describe` block to the end of the file (after the existing `describe("confirmSentToGaSchema", ...)` block):

```typescript
describe("markAsDoneSchema", () => {
  it("accepts a valid submissionId", () => {
    expect(markAsDoneSchema.safeParse({ submissionId: "abc" }).success).toBe(true);
  });

  it("rejects an empty submissionId", () => {
    expect(markAsDoneSchema.safeParse({ submissionId: "" }).success).toBe(false);
  });

  it("rejects a missing submissionId", () => {
    expect(markAsDoneSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/submission.test.ts` from repo root (`c:\Users\TSI-GA_04\pengajuan`).
Expected: FAIL — `markAsDoneSchema` is not exported yet.

- [ ] **Step 3: Add `markAsDoneSchema` to `lib/schemas/submission.ts`**

Add this at the end of the file (after `confirmSentToGaSchema`/`ConfirmSentToGaInput`):

```typescript
export const markAsDoneSchema = z.object({
  submissionId: z.string().min(1),
});

export type MarkAsDoneInput = z.infer<typeof markAsDoneSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS — 26 tests passing total in the file (23 from before, plus 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add markAsDoneSchema"
```

---

## Task 2: `markAsDone` Cloud Function

**Files:**
- Modify: `functions/src/schemas.ts`
- Create: `functions/src/markAsDone.ts`
- Test: `functions/src/markAsDone.test.ts` (needs emulator — see Environment note)

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/markAsDone.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-markdone-test";

const fft = functionsTest({ projectId: "demo-pengajuan-markdone-test" }, undefined);
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

describe("markAsDoneHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-markdone-test",
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
    await expect(
      markAsDoneHandler({ submissionId: "sub-1" }, { auth: undefined })
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when caller is not the requester", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedUser("uid-other", "admin_cabang");
    await seedSubmission("sub-1", "on_proses_ga", "uid-admin");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-1" }, { auth: { uid: "uid-other" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't on_proses_ga", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-2", "siap_dikirim", "uid-admin");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("marks done and sets status/completedAt/statusHistory", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-3", "on_proses_ga", "uid-admin");
    const { markAsDoneHandler } = await import("./markAsDone");
    const result = await markAsDoneHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-admin" } } as any);
    expect(result.status).toBe("selesai");

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("selesai");
    expect(updated.data()!.completedAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-3").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "selesai" && d.data().actorId === "uid-admin")).toBe(true);
  });

  it("rejects an empty submissionId", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });
});
```

- [ ] **Step 2 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/markAsDone.test.ts` here to verify it fails.

- [ ] **Step 3: Add `markAsDoneSchema` to `functions/src/schemas.ts`**

Add at the end of the file (byte-for-byte identical to Task 1's addition to `lib/schemas/submission.ts`):

```typescript
export const markAsDoneSchema = z.object({
  submissionId: z.string().min(1),
});

export type MarkAsDoneInput = z.infer<typeof markAsDoneSchema>;
```

- [ ] **Step 4: Write `functions/src/markAsDone.ts`**

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { markAsDoneSchema, MarkAsDoneInput } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function markAsDoneHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const parsed = markAsDoneSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: MarkAsDoneInput = parsed.data;

  const submissionRef = db.collection("submissions").doc(input.submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== context.auth.uid) {
    throw new HttpsError("permission-denied", "Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "on_proses_ga") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus on_proses_ga yang bisa ditandai selesai.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();

  const batch = db.batch();
  batch.update(submissionRef, {
    status: "selesai",
    completedAt: FieldValue.serverTimestamp(),
  });
  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "selesai",
    note: null,
    actorId: context.auth.uid,
    actorRole: caller?.role ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "selesai" as const };
}
```

- [ ] **Step 5 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run functions/src/markAsDone.test.ts` here to verify all 5 tests pass.

- [ ] **Step 6: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add functions/src/schemas.ts functions/src/markAsDone.ts functions/src/markAsDone.test.ts
git commit -m "feat: add markAsDone callable"
```

---

## Task 3: Wire `markAsDone` into `functions/src/index.ts`

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add the import and export**

Add this import near the top, alongside the other handler imports:

```typescript
import { markAsDoneHandler } from "./markAsDone";
```

Add this export (position doesn't matter, e.g. right after `confirmSentToGa`):

```typescript
export const markAsDone = onCall((request) =>
  markAsDoneHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
```

- [ ] **Step 2: Verify the functions project type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: export markAsDone callable"
```

---

## Task 4: "Tandai Selesai" section on the detail page

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
  const [copyError, setCopyError] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState(false);
  const [markDoneError, setMarkDoneError] = useState<string | null>(null);

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
    setCopyError(null);
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
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      setCopyError("Gagal menyalin. Coba salin manual.");
    }
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

  async function handleMarkDone() {
    if (!submission) return;
    setMarkDoneError(null);
    setMarkingDone(true);
    try {
      const markAsDone = httpsCallable(functions, "markAsDone");
      await markAsDone({ submissionId: submission.id });
    } catch (err) {
      setMarkDoneError(err instanceof Error ? err.message : "Gagal menandai selesai.");
    } finally {
      setMarkingDone(false);
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
          {copyError && <p className="text-sm text-red-600">{copyError}</p>}
          {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
          <Button type="button" size="sm" disabled={confirming} onClick={handleConfirm}>
            {confirming ? "Memproses..." : "Konfirmasi Sudah Dikirim ke GA"}
          </Button>
        </div>
      )}

      {submission.status === "on_proses_ga" && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-medium">Barang/layanan sudah diterima?</p>
          {markDoneError && <p className="text-sm text-red-600">{markDoneError}</p>}
          <Button type="button" size="sm" disabled={markingDone} onClick={handleMarkDone}>
            {markingDone ? "Memproses..." : "Tandai Selesai"}
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

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if it fails at the prerender stage with a missing-Firebase-config error, rerun, then delete `.env.local` again afterward and confirm `git status` shows it untracked).
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/pengajuan/[id]/page.tsx"
git commit -m "feat: add Tandai Selesai section for on_proses_ga submissions"
```

---

## Task 5: `lib/monitoring.ts` — pure duration calculator

**Files:**
- Create: `lib/monitoring.ts`
- Test: `lib/monitoring.test.ts`

This task is fully runnable on this machine — no Firebase, no I/O.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/monitoring.test.ts
import { describe, it, expect } from "vitest";
import { computeStageDurations, formatDuration, StatusHistoryEntry } from "./monitoring";

describe("computeStageDurations", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("returns all nulls for an empty history", () => {
    const result = computeStageDurations([], now);
    expect(result).toEqual({
      diajukanToDisetujui: null,
      disetujuiToSiapDikirim: null,
      siapDikirimToOnProsesGa: null,
      onProsesGaToSelesai: null,
      total: null,
    });
  });

  it("computes total as elapsed-so-far when only diajukan exists", () => {
    const entries: StatusHistoryEntry[] = [{ status: "diajukan", timestamp: new Date("2026-08-28T10:00:00Z") }];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBeNull();
    expect(result.total).toBe(2 * 60 * 60 * 1000);
  });

  it("computes diajukanToDisetujui from the earliest entry, including a revision cycle", () => {
    const entries: StatusHistoryEntry[] = [
      { status: "diajukan", timestamp: new Date("2026-08-20T00:00:00Z") },
      { status: "perlu_revisi", timestamp: new Date("2026-08-21T00:00:00Z") },
      { status: "diajukan", timestamp: new Date("2026-08-22T00:00:00Z") },
      { status: "disetujui", timestamp: new Date("2026-08-23T00:00:00Z") },
    ];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("computes each subsequent stage duration and a final total when selesai", () => {
    const entries: StatusHistoryEntry[] = [
      { status: "diajukan", timestamp: new Date("2026-08-01T00:00:00Z") },
      { status: "disetujui", timestamp: new Date("2026-08-02T00:00:00Z") },
      { status: "siap_dikirim", timestamp: new Date("2026-08-02T01:00:00Z") },
      { status: "on_proses_ga", timestamp: new Date("2026-08-03T00:00:00Z") },
      { status: "selesai", timestamp: new Date("2026-08-05T00:00:00Z") },
    ];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBe(24 * 60 * 60 * 1000);
    expect(result.disetujuiToSiapDikirim).toBe(60 * 60 * 1000);
    expect(result.siapDikirimToOnProsesGa).toBe(23 * 60 * 60 * 1000);
    expect(result.onProsesGaToSelesai).toBe(2 * 24 * 60 * 60 * 1000);
    expect(result.total).toBe(4 * 24 * 60 * 60 * 1000);
  });

  it("does not assume entries are pre-sorted", () => {
    const entries: StatusHistoryEntry[] = [
      { status: "disetujui", timestamp: new Date("2026-08-02T00:00:00Z") },
      { status: "diajukan", timestamp: new Date("2026-08-01T00:00:00Z") },
    ];
    const result = computeStageDurations(entries, now);
    expect(result.diajukanToDisetujui).toBe(24 * 60 * 60 * 1000);
  });
});

describe("formatDuration", () => {
  it("returns a dash for null", () => {
    expect(formatDuration(null)).toBe("-");
  });

  it("formats minutes only under an hour", () => {
    expect(formatDuration(45 * 60 * 1000)).toBe("45m");
  });

  it("formats hours and minutes under a day", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe("2j 30m");
  });

  it("formats days and hours at a day or more", () => {
    expect(formatDuration(2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)).toBe("2h 3j");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/monitoring.test.ts` from repo root (`c:\Users\TSI-GA_04\pengajuan`).
Expected: FAIL — `Cannot find module './monitoring'`.

- [ ] **Step 3: Write `lib/monitoring.ts`**

```typescript
export type StatusHistoryEntry = {
  status: string;
  timestamp: Date;
};

export type StageDurations = {
  diajukanToDisetujui: number | null;
  disetujuiToSiapDikirim: number | null;
  siapDikirimToOnProsesGa: number | null;
  onProsesGaToSelesai: number | null;
  total: number | null;
};

export function computeStageDurations(entries: StatusHistoryEntry[], now: Date): StageDurations {
  if (entries.length === 0) {
    return {
      diajukanToDisetujui: null,
      disetujuiToSiapDikirim: null,
      siapDikirimToOnProsesGa: null,
      onProsesGaToSelesai: null,
      total: null,
    };
  }

  const sorted = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const first = sorted[0].timestamp;
  const findFirst = (status: string) => sorted.find((e) => e.status === status)?.timestamp ?? null;

  const disetujuiAt = findFirst("disetujui");
  const siapDikirimAt = findFirst("siap_dikirim");
  const onProsesGaAt = findFirst("on_proses_ga");
  const selesaiAt = findFirst("selesai");

  return {
    diajukanToDisetujui: disetujuiAt ? disetujuiAt.getTime() - first.getTime() : null,
    disetujuiToSiapDikirim: disetujuiAt && siapDikirimAt ? siapDikirimAt.getTime() - disetujuiAt.getTime() : null,
    siapDikirimToOnProsesGa: siapDikirimAt && onProsesGaAt ? onProsesGaAt.getTime() - siapDikirimAt.getTime() : null,
    onProsesGaToSelesai: onProsesGaAt && selesaiAt ? selesaiAt.getTime() - onProsesGaAt.getTime() : null,
    total: selesaiAt ? selesaiAt.getTime() - first.getTime() : now.getTime() - first.getTime(),
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/monitoring.test.ts`
Expected: PASS — 9 tests passing (5 in `computeStageDurations`, 4 in `formatDuration`).

- [ ] **Step 5: Commit**

```bash
git add lib/monitoring.ts lib/monitoring.test.ts
git commit -m "feat: add pure stage-duration calculator for monitoring dashboard"
```

---

## Task 6: `MonitoringRow` component

**Files:**
- Create: `components/monitoring-row/MonitoringRow.tsx`

- [ ] **Step 1: Write `components/monitoring-row/MonitoringRow.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { computeStageDurations, formatDuration, StatusHistoryEntry } from "@/lib/monitoring";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { TableCell, TableRow } from "@/components/ui/table";

export type MonitoringSubmission = {
  id: string;
  submissionNumber: string;
  type: string;
  branch: string;
  status: string;
  requesterId: string;
};

export function MonitoringRow({ submission }: { submission: MonitoringSubmission }) {
  const [entries, setEntries] = useState<StatusHistoryEntry[]>([]);
  const [requesterName, setRequesterName] = useState<string>(submission.requesterId);

  useEffect(() => {
    const q = query(collection(db, "submissions", submission.id, "statusHistory"), orderBy("timestamp", "asc"));
    return onSnapshot(q, (snap) => {
      setEntries(
        snap.docs.map((d) => ({
          status: d.data().status as string,
          timestamp: d.data().timestamp?.toDate() ?? new Date(),
        }))
      );
    });
  }, [submission.id]);

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "users", submission.requesterId)).then((snap) => {
      if (!cancelled && snap.exists()) {
        setRequesterName((snap.data().name as string) ?? submission.requesterId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [submission.requesterId]);

  const durations = computeStageDurations(entries, new Date());

  return (
    <TableRow>
      <TableCell>
        <Link href={`/pengajuan/${submission.id}`} className="underline">
          {submission.submissionNumber}
        </Link>
      </TableCell>
      <TableCell>{requesterName}</TableCell>
      <TableCell>{submission.branch}</TableCell>
      <TableCell>{submission.type}</TableCell>
      <TableCell>
        <StatusBadge status={submission.status} />
      </TableCell>
      <TableCell>{formatDuration(durations.diajukanToDisetujui)}</TableCell>
      <TableCell>{formatDuration(durations.disetujuiToSiapDikirim)}</TableCell>
      <TableCell>{formatDuration(durations.siapDikirimToOnProsesGa)}</TableCell>
      <TableCell>{formatDuration(durations.onProsesGaToSelesai)}</TableCell>
      <TableCell>{formatDuration(durations.total)}</TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors. (This component isn't imported by any page yet — Task 7 wires it in — so `npm run build` just confirms this file alone type-checks; a Next.js build won't fail on an unused-but-valid file.)

- [ ] **Step 3: Commit**

```bash
git add components/monitoring-row/MonitoringRow.tsx
git commit -m "feat: add MonitoringRow component"
```

---

## Task 7: `/monitoring` page

**Files:**
- Create: `app/(dashboard)/monitoring/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/monitoring/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { MonitoringRow, MonitoringSubmission } from "@/components/monitoring-row/MonitoringRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function MonitoringPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<MonitoringSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser) return;

    const isRequesterRole = appUser.role === "admin_cabang" || appUser.role === "snd";
    const q = isRequesterRole
      ? query(collection(db, "submissions"), where("requesterId", "==", appUser.uid), orderBy("submittedAt", "desc"))
      : query(collection(db, "submissions"), orderBy("submittedAt", "desc"));

    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            branch: d.data().branch,
            status: d.data().status,
            requesterId: d.data().requesterId,
          }))
        );
      },
      (err) => {
        setError(err.code);
      }
    );
  }, [appUser]);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Dashboard Monitoring</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. Pengajuan</TableHead>
            <TableHead>Pengaju</TableHead>
            <TableHead>Cabang</TableHead>
            <TableHead>Jenis</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Diajukan→Disetujui</TableHead>
            <TableHead>Disetujui→Kirim</TableHead>
            <TableHead>Kirim→GA</TableHead>
            <TableHead>GA→Selesai</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <MonitoringRow key={row.id} submission={row} />
          ))}
        </TableBody>
      </Table>
      {error && <p className="text-sm text-red-600">Gagal memuat data. Coba muat ulang halaman.</p>}
      {!error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if it fails at the prerender stage, rerun, then delete `.env.local` again afterward and confirm `git status` shows it untracked).
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/monitoring/page.tsx"
git commit -m "feat: add Dashboard Monitoring page"
```

---

## Task 8: Nav link

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

- [ ] **Step 1: Add the "Monitoring" link**

In `app/(dashboard)/layout.tsx`, find this block:

```typescript
            <Link href="/pengajuan" className="hover:underline">
              Pengajuan Saya
            </Link>
```

Add immediately after it (still inside the same `<div className="flex gap-4 text-sm">`, before the `spv`/`management` conditional block):

```typescript
            <Link href="/monitoring" className="hover:underline">
              Monitoring
            </Link>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat: add Monitoring nav link"
```

---

## Task 9: Manual end-to-end verification (needs emulator + Java — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Once Java/emulator is available, verify manually**

Seed data, take a submission all the way through `on_proses_ga` (requires the full flow from prior sub-projects), then as the requester open its detail page and click "Tandai Selesai". Expected: status becomes `selesai`, the section disappears, the timeline shows the final entry.

Then open `/monitoring` as each role: as the requester, confirm only their own submissions appear with correct per-stage durations (including a "-" for any stage not yet reached, and a live-updating Total for anything not yet `selesai`); as `spv`/`management`/`superadmin`, confirm all submissions across all branches appear. Click a submission number and confirm it navigates to the detail page.

---

## Self-Review Notes

- Spec coverage: `markAsDone` owner-only + status-guarded + real-actor `statusHistory` (Tasks 1-4), no confirmation dialog (Task 4's button has no `window.confirm`), monitoring access for all roles with role-scoped query and no rules/index changes (Task 7), detailed per-stage duration columns including the revision-cycle-inclusive `diajukanToDisetujui` semantics (Task 5), per-row isolation via a dedicated component (Task 6), nav link ungated by role (Task 8) — all covered. No filter controls, no confirmation dialog, no live-ticking timer, no rules changes were built, matching the spec's explicit out-of-scope list.
- Type consistency: `MonitoringSubmission` (Task 6) matches exactly what Task 7's `page.tsx` constructs and passes to `MonitoringRow`. `StatusHistoryEntry`/`computeStageDurations`/`formatDuration` names match between Task 5's implementation and Task 6's import. `markAsDoneSchema`/`MarkAsDoneInput` match across Task 1 (`lib/schemas/submission.ts`), Task 2 (`functions/src/schemas.ts` duplicate + `markAsDone.ts` consumer), and Task 3 (`index.ts` imports the handler, not the schema directly, which is correct).
