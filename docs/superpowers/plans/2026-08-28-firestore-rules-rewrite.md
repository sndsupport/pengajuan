# Rewrite Firestore Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `submitSubmission`, `reviewSubmission`, `confirmSentToGa`, `markAsDone` from Cloud Functions to direct client Firestore writes guarded by Security Rules, per `docs/superpowers/specs/2026-08-28-firestore-rules-rewrite-design.md`. Sub-project 2 of 5 in the Spark-plan architecture migration.

**Architecture:** `firestore.rules` gains one `allow update` clause per valid state transition (resubmit, approve, reject, confirm-sent-to-GA, mark-done), keyed on `resource.data.status` (old) → `request.resource.data.status` (new) plus role/ownership checks. `lib/submissions/*.ts` (one file per transition, mirroring the deleted Cloud Functions 1:1) perform the actual writes via the Firestore client SDK (`writeBatch`/`setDoc`/`runTransaction`), after Zod validation using the schemas already in `lib/schemas/submission.ts`. Three pages get rewired from `httpsCallable` to these new functions.

**Tech Stack:** TypeScript, Zod, Firestore client SDK (`firebase/firestore`), `@firebase/rules-unit-testing`, Vitest.

**Important correctness note (read before Task 4):** Firestore evaluates security rules for every write in a **batch** against the database state as it was **before** the batch started — a `get()` inside a rule cannot see another document's new value from the same batch. This matters for `createNewSubmission`: the `items`/`attachments` create rule needs to `get()` the parent submission's status, but if the submission itself is created in the *same* batch as its items, that `get()` sees "document does not exist" and the write is denied. The fix (already applied in Task 4's code): create the submission document first with an awaited `setDoc` (so it's truly committed), *then* batch the items/attachments/statusHistory writes. `resubmitAfterRevisi` does NOT need this workaround — its batch updates the submission from `perlu_revisi` to `diajukan`, and the items/attachments rule's `get()` sees the *pre-batch* status (`perlu_revisi`), which is itself one of the allowed editable statuses, so a single atomic batch works there.

**Environment note:** Same constraints as prior plans — no Java, so `@firebase/rules-unit-testing`/emulator-backed tests cannot run on this machine. Every such test in this plan is written but not run — verify via `npx tsc --noEmit` / `npm run build` instead.

---

## File Structure

```
/lib
  counters.ts                 # new — client-side submission-number generator (ported from functions/src/counters.ts)
  drive-upload.ts               # modify — add deleteFromDriveClient
  /submissions
    submitSubmission.ts            # new — create + resubmit-after-revisi
    reviewSubmission.ts             # new — approve/reject
    confirmSentToGa.ts               # new
    markAsDone.ts                     # new
/tests
  firestore-rules.test.ts               # modify (full replace) — cover every new rules clause
/app
  /(dashboard)
    /pengajuan/new/page.tsx               # modify — call lib/submissions/submitSubmission instead of httpsCallable
    /persetujuan/page.tsx                   # modify — call lib/submissions/reviewSubmission
    /pengajuan/[id]/page.tsx                  # modify — call confirmSentToGa/markAsDone
firestore.rules                                # modify (full replace)
/functions
  /src
    submitSubmission.ts, submitSubmission.test.ts     # delete
    reviewSubmission.ts, reviewSubmission.test.ts       # delete
    confirmSentToGa.ts, confirmSentToGa.test.ts           # delete
    markAsDone.ts, markAsDone.test.ts                       # delete
    counters.ts, counters.test.ts                             # delete
    schemas.ts                                                  # delete (100% dead once the above are gone)
    index.ts                                                      # modify — remove the 4 deleted callables' wiring
```

---

## Task 1: Client-side counter + Drive-delete utilities

**Files:**
- Create: `lib/counters.ts`
- Test: `lib/counters.test.ts` (needs emulator — see Environment note)
- Modify: `lib/drive-upload.ts`

- [ ] **Step 1: Write the failing test for `getNextSubmissionNumber`**

```typescript
// lib/counters.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getNextSubmissionNumber } from "./counters";

let testEnv: RulesTestEnvironment;

describe("getNextSubmissionNumber", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-client-counters-test",
      firestore: { host: "127.0.0.1", port: 8080 },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => testEnv?.cleanup());

  it("starts at 001 for a new branch-month key", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const number = await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    expect(number).toBe("001/WHO/VIII/2026");
  });

  it("increments on the second call for the same branch-month", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    const second = await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    expect(second).toBe("002/WHO/VIII/2026");
  });

  it("keeps separate counters per branch", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    const whp = await getNextSubmissionNumber(db as any, "WHP", 2026, 8);
    expect(whp).toBe("001/WHP/VIII/2026");
  });
});
```

- [ ] **Step 2 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run lib/counters.test.ts` here to verify it fails.

- [ ] **Step 3: Write `lib/counters.ts`**

```typescript
import { doc, runTransaction, type Firestore } from "firebase/firestore";

const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export async function getNextSubmissionNumber(
  db: Firestore,
  branch: string,
  year: number,
  month: number
): Promise<string> {
  const monthPadded = String(month).padStart(2, "0");
  const counterRef = doc(db, "counters", `${branch}-${year}-${monthPadded}`);

  const nextNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().lastNumber as number) : 0;
    const next = current + 1;
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });

  const counterPadded = String(nextNumber).padStart(3, "0");
  return `${counterPadded}/${branch}/${ROMAN_MONTHS[month - 1]}/${year}`;
}
```

Note the client SDK API differences from the old Admin-SDK version this replaces (`functions/src/counters.ts`, not modified by this task — deleted in Task 11): `doc(db, "counters", id)` instead of `db.collection("counters").doc(id)`, `runTransaction(db, async (tx) => ...)` instead of `db.runTransaction(...)`, and critically `snap.exists()` is a **method call** here (client SDK) vs `snap.exists` being a **boolean property** in the Admin SDK version — easy to get wrong, double-check you used `()`.

- [ ] **Step 4 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run lib/counters.test.ts` here to verify all 3 tests pass.

- [ ] **Step 5: Add `deleteFromDriveClient` to `lib/drive-upload.ts`**

Add this new exported function at the end of `lib/drive-upload.ts` (after `uploadToDriveClient`, do not modify anything above it):

```typescript
export async function deleteFromDriveClient(fileId: string): Promise<void> {
  const accessToken = await getDriveAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Gagal menghapus file di Google Drive (${res.status}).`);
  }
}
```

A 404 (file already gone) is treated as success — this mirrors the "best-effort cleanup" nature of the caller (Task 4's `resubmitAfterRevisi`, which must never let a Drive cleanup failure block the resubmit itself).

- [ ] **Step 6: Verify the whole project type-checks**

Run: `npx tsc --noEmit` from repo root (`c:\Users\TSI-GA_04\pengajuan`).
Expected: no output, no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/counters.ts lib/counters.test.ts lib/drive-upload.ts
git commit -m "feat: add client-side counter and Drive-delete utilities"
```

---

## Task 2: Rewrite `firestore.rules` and its test suite

**Files:**
- Modify: `firestore.rules` (full replace)
- Modify: `tests/firestore-rules.test.ts` (full replace — needs emulator to run, see Environment note)

This is the most important task in the plan — it's the only enforcement layer for the status state machine once Cloud Functions are gone.

- [ ] **Step 1: Replace `tests/firestore-rules.test.ts` with the full new test suite**

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";

let testEnv: RulesTestEnvironment;

describe("firestore.rules", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-rules-test",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("users").doc("uid-admin").set({ role: "admin_cabang", branch: "WHO" });
      await db.collection("users").doc("uid-snd").set({ role: "snd", branch: "SND" });
      await db.collection("users").doc("uid-spv").set({ role: "spv", branch: "WHO" });
      await db.collection("submissions").doc("sub-1").set({ requesterId: "uid-admin", status: "diajukan" });
      await db.collection("submissions").doc("sub-1").collection("items").doc("item-1").set({
        itemName: "Toyota Avanza",
        quantity: 1,
      });
      await db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").set({
        fileUrl: "https://drive.google.com/file/d/abc/view",
        fileName: "nota.png",
        fileType: "image/png",
      });
    });
  });

  afterAll(() => testEnv?.cleanup());

  it("denies unauthenticated read of a submission", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.collection("submissions").doc("sub-1").get());
  });

  it("allows the owner to read their own submission", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertSucceeds(db.collection("submissions").doc("sub-1").get());
  });

  it("allows spv to read any submission", async () => {
    const db = testEnv.authenticatedContext("uid-spv").firestore();
    await assertSucceeds(db.collection("submissions").doc("sub-1").get());
  });

  it("denies a non-owner, non-reviewer read", async () => {
    const db = testEnv.authenticatedContext("uid-snd").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").get());
  });

  it("denies an unauthorized direct status change", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").update({ status: "disetujui" }));
  });

  describe("submissions create rule", () => {
    it("allows an admin_cabang/snd user to create a submission as themselves in status diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-admin", status: "diajukan" })
      );
    });

    it("denies create when the caller's role is not admin_cabang/snd", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-spv", status: "diajukan" })
      );
    });

    it("denies create when requesterId does not match the caller", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-snd", status: "diajukan" })
      );
    });

    it("denies create when status is not diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-admin", status: "disetujui" })
      );
    });
  });

  describe("submissions update rule — status transitions", () => {
    it("allows the owner to resubmit after perlu_revisi", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-revisi").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-revisi").update({ status: "diajukan", rejectionNote: null })
      );
    });

    it("denies a non-owner from resubmitting", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-revisi2").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-revisi2").update({ status: "diajukan", rejectionNote: null })
      );
    });

    it("allows spv to approve a diajukan submission with approverSignatureUrl", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
        })
      );
    });

    it("denies approve without approverSignatureUrl", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "",
        })
      );
    });

    it("denies approve when approverRole doesn't match the caller's real role", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "management",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
        })
      );
    });

    it("allows spv to reject a diajukan submission with rejectionNote", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").update({
          status: "perlu_revisi",
          rejectionNote: "KM tidak sesuai",
        })
      );
    });

    it("denies reject without rejectionNote", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "perlu_revisi",
          rejectionNote: "",
        })
      );
    });

    it("denies a non-reviewer from approving", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-admin",
          approverRole: "admin_cabang",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
        })
      );
    });

    it("allows the owner to confirm sent to GA when siap_dikirim", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-siap").set({
          requesterId: "uid-admin",
          status: "siap_dikirim",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-siap").update({ status: "on_proses_ga" }));
    });

    it("denies confirming sent to GA by a non-owner", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-siap2").set({
          requesterId: "uid-admin",
          status: "siap_dikirim",
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(db.collection("submissions").doc("sub-siap2").update({ status: "on_proses_ga" }));
    });

    it("allows the owner to mark as done when on_proses_ga", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-proses").set({
          requesterId: "uid-admin",
          status: "on_proses_ga",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-proses").update({ status: "selesai" }));
    });

    it("denies marking as done from a status other than on_proses_ga", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("submissions").doc("sub-1").update({ status: "selesai" }));
    });
  });

  describe("statusHistory create rule", () => {
    it("allows creating a statusHistory entry with a matching actorId/actorRole", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-ok").set({
          status: "diajukan",
          note: null,
          actorId: "uid-admin",
          actorRole: "admin_cabang",
        })
      );
    });

    it("denies creating a statusHistory entry with a forged actorRole", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-forged").set({
          status: "diajukan",
          note: null,
          actorId: "uid-admin",
          actorRole: "superadmin",
        })
      );
    });

    it("denies creating a statusHistory entry with a forged actorId", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-forged2").set({
          status: "diajukan",
          note: null,
          actorId: "uid-snd",
          actorRole: "admin_cabang",
        })
      );
    });
  });

  describe("users rule", () => {
    it("allows the owner to read their own user document", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("users").doc("uid-admin").get());
    });

    it("allows a reviewer to read someone else's user document", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("users").doc("uid-admin").get());
    });

    it("denies a non-owner, non-reviewer from reading someone else's user document", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(db.collection("users").doc("uid-admin").get());
    });

    it("denies any client write to a user document", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("users").doc("uid-admin").update({ role: "superadmin" }));
    });
  });

  describe("items subcollection rule", () => {
    it("allows the owner to read an item under their own submission", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").get());
    });

    it("allows a reviewer to read an item under any submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").get());
    });

    it("denies a non-owner, non-reviewer from reading an item", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").get());
    });

    it("denies direct client update of an item", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-1").update({ quantity: 2 })
      );
    });

    it("allows the owner to create an item while status is diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-new").set({
          itemName: "Kertas A4",
          quantity: 5,
        })
      );
    });

    it("allows the owner to delete an item while status is diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").delete());
    });

    it("denies a non-owner from creating an item", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-new2").set({
          itemName: "Kertas A4",
          quantity: 5,
        })
      );
    });

    it("denies creating an item once the submission is no longer editable", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-approved").set({
          requesterId: "uid-admin",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-approved").collection("items").doc("item-new3").set({
          itemName: "Kertas A4",
          quantity: 5,
        })
      );
    });
  });

  describe("attachments subcollection rule", () => {
    it("allows the owner to read an attachment under their own submission", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").get()
      );
    });

    it("allows a reviewer to read an attachment under any submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").get()
      );
    });

    it("denies a non-owner, non-reviewer from reading an attachment", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").get()
      );
    });

    it("denies direct client update of an attachment", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").update({ fileName: "hacked.png" })
      );
    });
  });

  describe("counters rule", () => {
    it("allows an admin_cabang/snd user to create a new counter at 1", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("counters").doc("WHO-2026-09").set({ lastNumber: 1 }));
    });

    it("denies creating a new counter at a value other than 1", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("counters").doc("WHO-2026-10").set({ lastNumber: 2 }));
    });

    it("allows incrementing an existing counter by exactly 1", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("counters").doc("WHO-2026-08").update({ lastNumber: 2 }));
    });

    it("denies incrementing a counter by more than 1", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("counters").doc("WHO-2026-08").update({ lastNumber: 5 }));
    });

    it("denies a reviewer role from writing counters", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(db.collection("counters").doc("WHO-2026-11").set({ lastNumber: 1 }));
    });
  });
});
```

- [ ] **Step 2 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run tests/firestore-rules.test.ts` here to verify the new/changed assertions fail against the current rules.

- [ ] **Step 3: Replace `firestore.rules` with the full new rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }
    function userRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }
    function isReviewer() {
      return isSignedIn() && userRole() in ['spv', 'management', 'superadmin'];
    }
    function isRequesterRole() {
      return isSignedIn() && userRole() in ['admin_cabang', 'snd'];
    }

    match /users/{uid} {
      allow read: if isSignedIn() && (request.auth.uid == uid || userRole() in ['spv', 'management', 'superadmin']);
      allow write: if false;
    }

    match /submissions/{submissionId} {
      allow create: if isSignedIn()
        && isRequesterRole()
        && request.resource.data.requesterId == request.auth.uid
        && request.resource.data.status == 'diajukan';
      allow read: if isSignedIn() && (resource.data.requesterId == request.auth.uid || isReviewer());

      allow update: if isSignedIn() && (
        // Resubmit setelah revisi: pemilik, status lama perlu_revisi -> diajukan
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'perlu_revisi'
          && request.resource.data.status == 'diajukan')
        ||
        // Review - approve: spv/management, status lama diajukan -> disetujui
        (userRole() in ['spv', 'management']
          && resource.data.status == 'diajukan'
          && request.resource.data.status == 'disetujui'
          && request.resource.data.approverId == request.auth.uid
          && request.resource.data.approverRole == userRole()
          && request.resource.data.approverSignatureUrl is string
          && request.resource.data.approverSignatureUrl.size() > 0)
        ||
        // Review - reject: spv/management, status lama diajukan -> perlu_revisi
        (userRole() in ['spv', 'management']
          && resource.data.status == 'diajukan'
          && request.resource.data.status == 'perlu_revisi'
          && request.resource.data.rejectionNote is string
          && request.resource.data.rejectionNote.size() > 0)
        ||
        // Konfirmasi sudah dikirim ke GA: pemilik, status lama siap_dikirim -> on_proses_ga
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'siap_dikirim'
          && request.resource.data.status == 'on_proses_ga')
        ||
        // Tandai selesai: pemilik, status lama on_proses_ga -> selesai
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'on_proses_ga'
          && request.resource.data.status == 'selesai')
      );

      allow delete: if false;

      match /items/{itemId} {
        allow read: if isSignedIn() &&
          (get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid || isReviewer());
        allow create, delete: if isSignedIn()
          && get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid
          && get(/databases/$(database)/documents/submissions/$(submissionId)).data.status in ['diajukan', 'perlu_revisi'];
        allow update: if false;
      }

      match /statusHistory/{historyId} {
        allow read: if isSignedIn() &&
          (get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid || isReviewer());
        allow create: if isSignedIn()
          && request.resource.data.actorId == request.auth.uid
          && request.resource.data.actorRole == userRole();
        allow update, delete: if false;
      }

      match /attachments/{attachmentId} {
        allow read: if isSignedIn() &&
          (get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid || isReviewer());
        allow create, delete: if isSignedIn()
          && get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid
          && get(/databases/$(database)/documents/submissions/$(submissionId)).data.status in ['diajukan', 'perlu_revisi'];
        allow update: if false;
      }
    }

    match /counters/{counterId} {
      allow get: if isRequesterRole();
      allow create: if isRequesterRole() && request.resource.data.lastNumber == 1;
      allow update: if isRequesterRole() && request.resource.data.lastNumber == resource.data.lastNumber + 1;
      allow delete: if false;
    }
  }
}
```

- [ ] **Step 4 (SKIP — needs emulator, see Environment note):** would normally run `npx vitest run tests/firestore-rules.test.ts` here to verify every test passes.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: rewrite Firestore Rules to enforce status transitions without Cloud Functions"
```

---

## Task 3: `lib/submissions/submitSubmission.ts`

**Files:**
- Create: `lib/submissions/submitSubmission.ts`

- [ ] **Step 1: Write `lib/submissions/submitSubmission.ts`**

```typescript
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createSubmissionSchema, CreateSubmissionInput } from "@/lib/schemas/submission";
import { getNextSubmissionNumber } from "@/lib/counters";
import { deleteFromDriveClient } from "@/lib/drive-upload";
import type { AppUser } from "@/lib/hooks/useAuth";

export type SubmitSubmissionResult = { submissionId: string; submissionNumber: string; status: "diajukan" };

export async function submitSubmission(rawInput: unknown, caller: AppUser): Promise<SubmitSubmissionResult> {
  const input: CreateSubmissionInput = createSubmissionSchema.parse(rawInput);

  if (input.submissionId) {
    return resubmitAfterRevisi(input, caller);
  }
  return createNewSubmission(input, caller);
}

async function createNewSubmission(input: CreateSubmissionInput, caller: AppUser): Promise<SubmitSubmissionResult> {
  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, caller.branch!, now.getFullYear(), now.getMonth() + 1);

  // Create the submission doc first (awaited, truly committed) BEFORE writing its
  // items/attachments/statusHistory in a batch — the items/attachments create rule
  // needs to `get()` this document, and Firestore evaluates every write in a batch
  // against the pre-batch state, so a same-batch create wouldn't be visible yet.
  const submissionRef = doc(collection(db, "submissions"));
  await setDoc(submissionRef, {
    submissionNumber,
    type: input.type,
    subType: input.subType,
    status: "diajukan",
    requesterId: caller.uid,
    requesterSignatureUrl: input.requesterSignatureUrl,
    approverId: null,
    approverRole: null,
    approverSignatureUrl: null,
    branch: caller.branch,
    department: caller.department,
    position: caller.position,
    rejectionNote: null,
    pdfUrl: null,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    approvedAt: null,
    sentToGaAt: null,
    completedAt: null,
  });

  const batch = writeBatch(db);
  input.items.forEach((item) => {
    const itemRef = doc(collection(submissionRef, "items"));
    batch.set(itemRef, item);
  });
  input.attachments.forEach((attachment) => {
    const attachmentRef = doc(collection(submissionRef, "attachments"));
    batch.set(attachmentRef, { ...attachment, uploadedAt: serverTimestamp() });
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "diajukan",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: submissionRef.id, submissionNumber, status: "diajukan" };
}

async function resubmitAfterRevisi(input: CreateSubmissionInput, caller: AppUser): Promise<SubmitSubmissionResult> {
  const submissionRef = doc(db, "submissions", input.submissionId!);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "perlu_revisi") {
    throw new Error("Hanya pengajuan berstatus perlu_revisi yang bisa direvisi.");
  }

  const existingItemsSnap = await getDocs(collection(submissionRef, "items"));
  const existingAttachmentsSnap = await getDocs(collection(submissionRef, "attachments"));

  // Single atomic batch is safe here: the items/attachments create/delete rule's
  // get() on the parent submission sees the PRE-batch status ("perlu_revisi"),
  // which is itself one of the two statuses that rule allows editing under — so
  // it doesn't matter that this same batch also updates status to "diajukan".
  const batch = writeBatch(db);
  existingItemsSnap.forEach((d) => batch.delete(d.ref));
  existingAttachmentsSnap.forEach((d) => batch.delete(d.ref));
  input.items.forEach((item) => {
    const itemRef = doc(collection(submissionRef, "items"));
    batch.set(itemRef, item);
  });
  input.attachments.forEach((attachment) => {
    const attachmentRef = doc(collection(submissionRef, "attachments"));
    batch.set(attachmentRef, { ...attachment, uploadedAt: serverTimestamp() });
  });
  batch.update(submissionRef, {
    type: input.type,
    subType: input.subType,
    requesterSignatureUrl: input.requesterSignatureUrl,
    status: "diajukan",
    rejectionNote: null,
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "diajukan",
    note: "Diajukan ulang setelah revisi",
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  const keptFileIds = new Set(input.attachments.map((a) => a.fileId));
  await Promise.all(
    existingAttachmentsSnap.docs.map(async (d) => {
      const fileId = d.data().fileId as string | undefined;
      if (!fileId || keptFileIds.has(fileId)) return;
      try {
        await deleteFromDriveClient(fileId);
      } catch (error) {
        console.error(`resubmitAfterRevisi: failed to delete orphaned Drive file ${fileId}`, error);
      }
    })
  );

  return {
    submissionId: submissionRef.id,
    submissionNumber: submission.submissionNumber as string,
    status: "diajukan",
  };
}
```

`caller.branch!` (non-null assertion): `AppUser.branch` is typed `string | null` because `spv`/`management`/`superadmin` never have one, but `admin_cabang`/`snd` — the only roles allowed to reach this function (enforced by both the UI and, ultimately, the `firestore.rules` create rule's `isRequesterRole()` check) — always do, guaranteed by the Manajemen User creation form requiring branch selection for exactly those two roles.

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/submitSubmission.ts
git commit -m "feat: add client-side submitSubmission (create + resubmit)"
```

---

## Task 4: `lib/submissions/reviewSubmission.ts`

**Files:**
- Create: `lib/submissions/reviewSubmission.ts`

- [ ] **Step 1: Write `lib/submissions/reviewSubmission.ts`**

```typescript
import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { reviewSubmissionSchema, ReviewSubmissionInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type ReviewSubmissionResult = { submissionId: string; status: "disetujui" | "perlu_revisi" };

export async function reviewSubmission(rawInput: unknown, caller: AppUser): Promise<ReviewSubmissionResult> {
  const input: ReviewSubmissionInput = reviewSubmissionSchema.parse(rawInput);

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.status !== "diajukan") {
    throw new Error("Hanya pengajuan berstatus diajukan yang bisa direview.");
  }

  const batch = writeBatch(db);
  const historyRef = doc(collection(submissionRef, "statusHistory"));

  if (input.decision === "approve") {
    batch.update(submissionRef, {
      status: "disetujui",
      approverId: caller.uid,
      approverRole: caller.role,
      approverSignatureUrl: input.approverSignatureUrl,
      approvedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "disetujui",
      note: null,
      actorId: caller.uid,
      actorRole: caller.role,
      timestamp: serverTimestamp(),
    });
  } else {
    batch.update(submissionRef, {
      status: "perlu_revisi",
      rejectionNote: input.rejectionNote,
      reviewedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "perlu_revisi",
      note: input.rejectionNote,
      actorId: caller.uid,
      actorRole: caller.role,
      timestamp: serverTimestamp(),
    });
  }

  await batch.commit();
  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
```

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/reviewSubmission.ts
git commit -m "feat: add client-side reviewSubmission (approve/reject)"
```

---

## Task 5: `lib/submissions/confirmSentToGa.ts`

**Files:**
- Create: `lib/submissions/confirmSentToGa.ts`

- [ ] **Step 1: Write `lib/submissions/confirmSentToGa.ts`**

```typescript
import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { confirmSentToGaSchema, ConfirmSentToGaInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type ConfirmSentToGaResult = { submissionId: string; status: "on_proses_ga" };

export async function confirmSentToGa(rawInput: unknown, caller: AppUser): Promise<ConfirmSentToGaResult> {
  const input: ConfirmSentToGaInput = confirmSentToGaSchema.parse(rawInput);

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "siap_dikirim") {
    throw new Error("Hanya pengajuan berstatus siap_dikirim yang bisa dikonfirmasi.");
  }

  const batch = writeBatch(db);
  batch.update(submissionRef, {
    status: "on_proses_ga",
    sentToGaAt: serverTimestamp(),
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "on_proses_ga",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "on_proses_ga" };
}
```

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/confirmSentToGa.ts
git commit -m "feat: add client-side confirmSentToGa"
```

---

## Task 6: `lib/submissions/markAsDone.ts`

**Files:**
- Create: `lib/submissions/markAsDone.ts`

- [ ] **Step 1: Write `lib/submissions/markAsDone.ts`**

```typescript
import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { markAsDoneSchema, MarkAsDoneInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type MarkAsDoneResult = { submissionId: string; status: "selesai" };

export async function markAsDone(rawInput: unknown, caller: AppUser): Promise<MarkAsDoneResult> {
  const input: MarkAsDoneInput = markAsDoneSchema.parse(rawInput);

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "on_proses_ga") {
    throw new Error("Hanya pengajuan berstatus on_proses_ga yang bisa ditandai selesai.");
  }

  const batch = writeBatch(db);
  batch.update(submissionRef, {
    status: "selesai",
    completedAt: serverTimestamp(),
  });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "selesai",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: "selesai" };
}
```

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/markAsDone.ts
git commit -m "feat: add client-side markAsDone"
```

---

## Task 7: Rewire `app/(dashboard)/pengajuan/new/page.tsx`

**Files:**
- Modify: `app/(dashboard)/pengajuan/new/page.tsx`

- [ ] **Step 1: Update the imports**

Remove these lines:
```typescript
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
```
and the module-level emulator bootstrap block:
```typescript
const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (error) {
    console.warn("[functions] Emulator connection skipped (already configured):", error);
  }
}
```

Add these imports (alongside the existing `firebaseApp, db` import from `@/lib/firebase/client` — you can drop `firebaseApp` from that import if nothing else in the file uses it):
```typescript
import { useAuth } from "@/lib/hooks/useAuth";
import { submitSubmission } from "@/lib/submissions/submitSubmission";
```

- [ ] **Step 2: Add `useAuth()` inside the component and update `onSubmit`**

Add near the top of `NewPengajuanPage`'s body (alongside the existing `useRouter`/`useSearchParams` calls):
```typescript
const { appUser } = useAuth();
```

Replace the `onSubmit` function:
```typescript
async function onSubmit(data: CreateSubmissionInput) {
  if (!appUser) return;
  setServerError(null);
  try {
    const result = await submitSubmission(data, appUser);
    router.push(`/pengajuan/${result.submissionId}`);
  } catch (err) {
    setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
  }
}
```

Everything else in the file (the form, `useForm`, `useFieldArray`, `SignaturePad`/`FileUpload` usage, resubmit-loading `useEffect`) is unchanged.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if it fails at the prerender stage with a missing-Firebase-config error, rerun, then delete `.env.local` again afterward and confirm `git status` shows it untracked).
Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/pengajuan/new/page.tsx"
git commit -m "feat: submit pengajuan directly to Firestore instead of via Cloud Function"
```

---

## Task 8: Rewire `app/(dashboard)/persetujuan/page.tsx`

**Files:**
- Modify: `app/(dashboard)/persetujuan/page.tsx`

- [ ] **Step 1: Update the imports**

Remove:
```typescript
import { httpsCallable, getFunctions, connectFunctionsEmulator } from "firebase/functions";
```
and the module-level emulator bootstrap block (same shape as Task 7 Step 1).

Add:
```typescript
import { reviewSubmission } from "@/lib/submissions/reviewSubmission";
```

(`useAuth` is already imported and used in this file — no change needed there. If `firebaseApp` was only imported for the emulator bootstrap block, drop it from the `@/lib/firebase/client` import too; keep `db`.)

- [ ] **Step 2: Update `handleDecision`**

Replace:
```typescript
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
```

with:
```typescript
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

Everything else in the file (the queue `onSnapshot`, signature capture UI, route guard) is unchanged.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build` (same `.env.local` fallback as Task 7 if needed).
Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/persetujuan/page.tsx"
git commit -m "feat: submit review decisions directly to Firestore instead of via Cloud Function"
```

---

## Task 9: Rewire `app/(dashboard)/pengajuan/[id]/page.tsx`

**Files:**
- Modify: `app/(dashboard)/pengajuan/[id]/page.tsx`

- [ ] **Step 1: Update the imports**

Remove:
```typescript
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
```
and the module-level emulator bootstrap block.

Add:
```typescript
import { confirmSentToGa } from "@/lib/submissions/confirmSentToGa";
import { markAsDone } from "@/lib/submissions/markAsDone";
```

(`useAuth` is already imported/used. Drop `firebaseApp` from the `@/lib/firebase/client` import if it's no longer used elsewhere in the file; keep `db`.)

- [ ] **Step 2: Update `handleConfirm` and `handleMarkDone`**

Replace:
```typescript
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
```

with:
```typescript
async function handleConfirm() {
    if (!submission || !appUser) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      await confirmSentToGa({ submissionId: submission.id }, appUser);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal konfirmasi.");
    } finally {
      setConfirming(false);
    }
  }
```

Replace:
```typescript
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
```

with:
```typescript
async function handleMarkDone() {
    if (!submission || !appUser) return;
    setMarkDoneError(null);
    setMarkingDone(true);
    try {
      await markAsDone({ submissionId: submission.id }, appUser);
    } catch (err) {
      setMarkDoneError(err instanceof Error ? err.message : "Gagal menandai selesai.");
    } finally {
      setMarkingDone(false);
    }
  }
```

Everything else in the file (both `onSnapshot` listeners, `handleCopy`, the `perlu_revisi`/`siap_dikirim`/`on_proses_ga` sections) is unchanged.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build` (same `.env.local` fallback as Task 7 if needed).
Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/pengajuan/[id]/page.tsx"
git commit -m "feat: confirm-sent-to-GA and mark-as-done directly via Firestore instead of Cloud Functions"
```

---

## Task 10: Remove the 5 now-dead Cloud Functions and `schemas.ts`

**Files:**
- Delete: `functions/src/submitSubmission.ts`, `functions/src/submitSubmission.test.ts`
- Delete: `functions/src/reviewSubmission.ts`, `functions/src/reviewSubmission.test.ts`
- Delete: `functions/src/confirmSentToGa.ts`, `functions/src/confirmSentToGa.test.ts`
- Delete: `functions/src/markAsDone.ts`, `functions/src/markAsDone.test.ts`
- Delete: `functions/src/counters.ts`, `functions/src/counters.test.ts`
- Delete: `functions/src/schemas.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Delete the ten files**

```bash
git rm functions/src/submitSubmission.ts functions/src/submitSubmission.test.ts
git rm functions/src/reviewSubmission.ts functions/src/reviewSubmission.test.ts
git rm functions/src/confirmSentToGa.ts functions/src/confirmSentToGa.test.ts
git rm functions/src/markAsDone.ts functions/src/markAsDone.test.ts
git rm functions/src/counters.ts functions/src/counters.test.ts
git rm functions/src/schemas.ts
```

- [ ] **Step 2: Replace `functions/src/index.ts` with only the surviving callables**

```typescript
import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";
import { shouldGeneratePdf, generateSubmissionPdfHandler } from "./generateSubmissionPdf";

export const createUser = onCall((request) =>
  createUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const updateUser = onCall((request) =>
  updateUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const resetUserPassword = onCall((request) =>
  resetUserPasswordHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

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

Do NOT touch `functions/src/googleDrive.ts`, `functions/src/generateSubmissionPdf.ts`, `functions/src/pdfTemplate.ts`, `functions/src/createUser.ts`, `functions/src/updateUser.ts`, `functions/src/resetUserPassword.ts`, or `functions/src/userSchemas.ts` — all still actively used, out of scope until sub-projects 3 and 4.

- [ ] **Step 3: Verify the functions project still type-checks**

Run: `npm --prefix functions run build`.
Expected: succeeds, no type errors. (This also implicitly confirms nothing left in `functions/src/` still imports any of the deleted files — a stale import would be a compile error here.)

- [ ] **Step 4: Verify the whole repo type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "chore: remove Cloud Functions now replaced by client-side Firestore writes"
```

---

## Task 11: Manual end-to-end verification (needs emulator + Java — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Once Java/emulator is available, verify manually**

Seed data, log in as `admin_cabang`, submit a new pengajuan (confirms the two-step create-then-batch write and the counter transaction work end-to-end), log in as `spv` and approve it with a signature (confirms the update-rule's approve clause and `statusHistory` actorRole check), log in as the original requester and confirm-sent-to-GA then mark-as-done (confirms the remaining two transitions). Also try a reject + resubmit cycle. At each step, open the Firebase Emulator UI's Firestore tab and confirm `statusHistory` entries and the submission's fields look correct, and try (as a sanity check that rules are actually doing their job, not just absent) an unauthorized action from the browser console — e.g. a different role attempting to approve — and confirm it's rejected with a permission-denied error.

---

## Self-Review Notes

- Spec coverage: security-only rules philosophy (Zod stays for field-shape validation, not replicated in rules), all 4 status transitions + resubmit as distinct `allow update` clauses, `statusHistory.actorRole` forgery prevention via `get()`-based `userRole()`, `items`/`attachments` create/delete gated on editable-status, counter role-gate + increment-by-1 check, `disetujui → siap_dikirim` explicitly left untouched (Task 2's rules have no clause for it — confirmed absent by design), `functions/src/schemas.ts` deleted in full rather than partially (Task 10) — all covered.
- Type consistency: `AppUser` (from `lib/hooks/useAuth.ts`, unmodified) is the `caller` parameter type across all four `lib/submissions/*.ts` files. `CreateSubmissionInput`/`ReviewSubmissionInput`/`ConfirmSentToGaInput`/`MarkAsDoneInput` and their schemas (all from `lib/schemas/submission.ts`, unmodified by this plan) match exactly how each `lib/submissions/*.ts` file imports and uses them. `getNextSubmissionNumber`'s signature (`db, branch, year, month`) matches between Task 1's implementation and Task 3's call site. `deleteFromDriveClient(fileId)` matches between Task 1's addition and Task 3's usage in `resubmitAfterRevisi`.
- The batch-vs-sequential-write correctness note (stated up front and applied specifically in Task 3's `createNewSubmission`) is the single most important non-obvious detail in this plan — flagged prominently so a reader skimming task-by-task doesn't miss why `createNewSubmission` looks different from the batch-only pattern used everywhere else.
