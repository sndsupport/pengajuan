# One Gate Expansion (Gedung & Fasilitas + Personalia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the submissions system with a new `gedung_fasilitas` type (reuses the existing operational flow as-is) and a new `personalia` type covering lembur/cuti/izin (a materially different flow: single PDF upload instead of items+signature, dual approval from both `spv` and `management` instead of either-or, auto-completion with no GA-shipping stages).

**Architecture:** One Firestore collection (`submissions`), one dashboard, no new routes. New isolated modules (`submitPersonaliaSubmission.ts`, `reviewPersonaliaSubmission.ts`, a new personalia schema) sit alongside the existing operational modules untouched. Existing pages (`/pengajuan/new`, `/pengajuan/detail`, `/persetujuan`) branch their rendering on `submission.type` to show the right form/view. Firestore rules gain new transition clauses scoped to `type == 'personalia'`; all existing rules for the operational shape are unchanged and reused as-is.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Firebase (Firestore, client SDK only — no Cloud Functions), Zod, React Hook Form, Vitest, `@firebase/rules-unit-testing`.

**Reference:** `docs/superpowers/specs/2026-08-29-one-gate-personalia-gedung-design.md` (approved design).

**Known environment limitation:** This dev machine has no Java, so the Firestore emulator can't run — `tests/firestore-rules.test.ts` cannot be executed live here (same as every prior plan in this repo since the Spark-plan migration). Task 6 writes the tests and documents the run command; treat "written but unexecuted" as the deliverable, not a blocker.

---

### Task 1: Extend `type`/`subType` schema — add `gedung_fasilitas`

**Files:**
- Modify: `lib/schemas/submission.ts:1-8`
- Test: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/schemas/submission.test.ts`, right after the closing `});` of the existing `describe("createSubmissionSchema", ...)` block (after line 81):

```ts
describe("createSubmissionSchema — gedung_fasilitas", () => {
  it("accepts a valid gedung_fasilitas payload without km", () => {
    const payload = {
      type: "gedung_fasilitas" as const,
      subType: "perbaikan" as const,
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "AC ruang meeting", brandType: "Daikin 1PK", km: null, quantity: 1, unit: "unit", description: "Bocor freon" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects a subType not valid for gedung_fasilitas", () => {
    const payload = {
      type: "gedung_fasilitas" as const,
      subType: "service_berkala",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "AC ruang meeting", brandType: "Daikin 1PK", km: null, quantity: 1, unit: "unit", description: "" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: the two new tests FAIL (`type: "gedung_fasilitas"` isn't in `submissionTypeSchema` yet, so Zod rejects the whole payload — first test fails because it expected `true`).

- [ ] **Step 3: Extend the schema**

In `lib/schemas/submission.ts`, replace lines 3-8:

```ts
export const submissionTypeSchema = z.enum(["kendaraan", "perlengkapan", "gedung_fasilitas", "personalia"]);

export const subTypeByType = {
  kendaraan: ["service_berkala", "service_insidentil", "pengadaan_baru"] as const,
  perlengkapan: ["pengadaan_baru", "penggantian"] as const,
  gedung_fasilitas: ["pengadaan_baru", "perbaikan"] as const,
};

export const TYPE_LABEL: Record<string, string> = {
  kendaraan: "Kendaraan",
  perlengkapan: "Perlengkapan",
  gedung_fasilitas: "Gedung & Fasilitas",
  personalia: "Personalia",
};
```

(`personalia` is intentionally left out of `subTypeByType` — it doesn't use the items-based `createSubmissionSchema` at all, see Task 2. `TYPE_LABEL` is added here, colocated with the enum, as the single source of truth other files will import instead of hand-rolling their own label maps.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add gedung_fasilitas submission type"
```

---

### Task 2: Add the Personalia schema (lembur/cuti/izin)

**Files:**
- Modify: `lib/schemas/submission.ts` (append)
- Test: `lib/schemas/submission.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `lib/schemas/submission.test.ts`:

```ts
describe("createPersonaliaSubmissionSchema", () => {
  const validPayload = {
    subType: "cuti" as const,
    employeeName: "Rahmat Hidayat",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-03",
    attachment: {
      fileId: "file-cuti-1",
      fileUrl: "https://drive.google.com/file/d/cuti1/view",
      fileName: "form-cuti-rahmat.pdf",
      fileType: "application/pdf",
    },
  };

  it("accepts a valid cuti payload", () => {
    expect(createPersonaliaSubmissionSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts lembur and izin as subType", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, subType: "lembur" }).success).toBe(true);
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, subType: "izin" }).success).toBe(true);
  });

  it("rejects an unknown subType", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, subType: "sakit" }).success).toBe(false);
  });

  it("rejects an empty employeeName", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, employeeName: "" }).success).toBe(false);
  });

  it("rejects periodEnd before periodStart", () => {
    const result = createPersonaliaSubmissionSchema.safeParse({
      ...validPayload,
      periodStart: "2026-09-05",
      periodEnd: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing attachment", () => {
    const { attachment, ...rest } = validPayload;
    expect(createPersonaliaSubmissionSchema.safeParse(rest).success).toBe(false);
  });

  it("allows submissionId to be null (resubmit path serializes an absent field as null)", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, submissionId: null }).success).toBe(true);
  });
});

describe("reviewPersonaliaSubmissionSchema", () => {
  it("requires rejectionNote when decision is reject", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "" });
    expect(result.success).toBe(false);
  });

  it("accepts reject with a non-empty rejectionNote", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "reject",
      rejectionNote: "Tanggal cuti tidak jelas",
    });
    expect(result.success).toBe(true);
  });

  it("accepts approve without requiring a note", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(true);
  });

  it("accepts approve with an optional note", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve", note: "OK" });
    expect(result.success).toBe(true);
  });
});
```

Update the import line at the top of the test file (line 3) to also pull in the new exports:

```ts
import {
  createSubmissionSchema,
  reviewSubmissionSchema,
  uploadFileSchema,
  confirmSentToGaSchema,
  markAsDoneSchema,
  createPersonaliaSubmissionSchema,
  reviewPersonaliaSubmissionSchema,
} from "./submission";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL with `createPersonaliaSubmissionSchema is not a function` / `reviewPersonaliaSubmissionSchema is not a function` (not exported yet).

- [ ] **Step 3: Implement the schemas**

Append to `lib/schemas/submission.ts` (after the existing `markAsDoneSchema`/`MarkAsDoneInput` at the end of the file):

```ts
export const personaliaSubTypeSchema = z.enum(["lembur", "cuti", "izin"]);

export const PERSONALIA_SUBTYPE_LABEL: Record<z.infer<typeof personaliaSubTypeSchema>, string> = {
  lembur: "Lembur",
  cuti: "Cuti",
  izin: "Izin",
};

export const createPersonaliaSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    subType: personaliaSubTypeSchema,
    employeeName: z.string().min(1, "Nama karyawan wajib diisi"),
    periodStart: z.string().min(1, "Tanggal mulai wajib diisi"),
    periodEnd: z.string().min(1, "Tanggal selesai wajib diisi"),
    attachment: attachmentSchema,
  })
  .refine((data) => data.periodEnd >= data.periodStart, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["periodEnd"],
  });

export type CreatePersonaliaSubmissionInput = z.infer<typeof createPersonaliaSubmissionSchema>;

export const reviewPersonaliaSubmissionSchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    rejectionNote: z.string().nullish(),
    note: z.string().nullish(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  });

export type ReviewPersonaliaSubmissionInput = z.infer<typeof reviewPersonaliaSubmissionSchema>;
```

(`periodStart`/`periodEnd` are `YYYY-MM-DD` strings from `<input type="date">` — string comparison works correctly for that format, no `Date` parsing needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add personalia (lembur/cuti/izin) submission schema"
```

---

### Task 3: WhatsApp template for HC

**Files:**
- Modify: `lib/wa-template.ts` (append)
- Test: `lib/wa-template.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `lib/wa-template.test.ts`:

```ts
import { buildPersonaliaWaTemplate } from "./wa-template";

describe("buildPersonaliaWaTemplate", () => {
  const submission = {
    submissionNumber: "001/WHO/IX/2026",
    subType: "cuti",
    employeeName: "Rahmat Hidayat",
    branch: "WHO",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-03",
    attachmentUrl: "https://drive.google.com/file/d/cuti1/view",
  };

  it("includes the submission number", () => {
    expect(buildPersonaliaWaTemplate(submission, "Budi Santoso")).toContain("001/WHO/IX/2026");
  });

  it("includes the employee name and subType", () => {
    const text = buildPersonaliaWaTemplate(submission, "Budi Santoso");
    expect(text).toContain("Rahmat Hidayat");
    expect(text).toContain("cuti");
  });

  it("includes the period", () => {
    const text = buildPersonaliaWaTemplate(submission, "Budi Santoso");
    expect(text).toContain("2026-09-01");
    expect(text).toContain("2026-09-03");
  });

  it("includes the attachment link", () => {
    expect(buildPersonaliaWaTemplate(submission, "Budi Santoso")).toContain(
      "https://drive.google.com/file/d/cuti1/view"
    );
  });

  it("starts with a greeting to HC", () => {
    expect(buildPersonaliaWaTemplate(submission, "Budi Santoso").startsWith("Halo HC")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/wa-template.test.ts`
Expected: FAIL — `buildPersonaliaWaTemplate is not a function`.

- [ ] **Step 3: Implement the template**

Append to `lib/wa-template.ts`:

```ts
export type WaTemplatePersonaliaSubmission = {
  submissionNumber: string;
  subType: string;
  employeeName: string;
  branch: string;
  periodStart: string;
  periodEnd: string;
  attachmentUrl: string;
};

export function buildPersonaliaWaTemplate(submission: WaTemplatePersonaliaSubmission, requesterName: string): string {
  return `Halo HC, mohon diproses pengajuan berikut:

No. Pengajuan: ${submission.submissionNumber}
Jenis: ${submission.subType}
Nama Karyawan: ${submission.employeeName}
Cabang: ${submission.branch}
Periode: ${submission.periodStart} s/d ${submission.periodEnd}
Pengaju: ${requesterName}

Dokumen: ${submission.attachmentUrl}

Terima kasih.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/wa-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/wa-template.ts lib/wa-template.test.ts
git commit -m "feat: add WA template for personalia submissions (to HC)"
```

---

### Task 4: `submitPersonaliaSubmission` module

**Files:**
- Create: `lib/submissions/submitPersonaliaSubmission.ts`

No dedicated unit test file: like the existing `lib/submissions/submitSubmission.ts` and `reviewSubmission.ts` (neither has a `.test.ts`), this function performs real Firestore writes and is exercised via `tests/firestore-rules.test.ts` (permission boundaries) and manual QA (end-to-end behavior) rather than a mocked unit test — this matches the established pattern in this codebase, not a shortcut.

- [ ] **Step 1: Create the file**

```ts
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createPersonaliaSubmissionSchema, CreatePersonaliaSubmissionInput } from "@/lib/schemas/submission";
import { getNextSubmissionNumber } from "@/lib/counters";
import { deleteFromDriveClient } from "@/lib/drive-upload";
import type { AppUser } from "@/lib/hooks/useAuth";

export type SubmitPersonaliaSubmissionResult = { submissionId: string; submissionNumber: string; status: "diajukan" };

const ALLOWED_ROLES_BY_SUBTYPE: Record<CreatePersonaliaSubmissionInput["subType"], AppUser["role"][]> = {
  lembur: ["admin_cabang", "snd"],
  cuti: ["admin_cabang", "snd", "spv"],
  izin: ["admin_cabang", "snd", "spv"],
};

export async function submitPersonaliaSubmission(
  rawInput: unknown,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  const parsed = createPersonaliaSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreatePersonaliaSubmissionInput = parsed.data;

  if (!ALLOWED_ROLES_BY_SUBTYPE[input.subType].includes(caller.role)) {
    throw new Error("Anda tidak memiliki akses untuk mengajukan kategori ini.");
  }

  if (input.submissionId) {
    return resubmitAfterRevisi(input, caller);
  }
  return createNewSubmission(input, caller);
}

async function createNewSubmission(
  input: CreatePersonaliaSubmissionInput,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, caller.branch!, now.getFullYear(), now.getMonth() + 1);

  // Same ordering rationale as submitSubmission.ts: the submission doc is created
  // and awaited before the batch, because the attachments subcollection's create
  // rule needs to get() this parent doc, and a same-batch create wouldn't be
  // visible yet when Firestore evaluates the batch against pre-batch state.
  const submissionRef = doc(collection(db, "submissions"));
  await setDoc(submissionRef, {
    submissionNumber,
    type: "personalia",
    subType: input.subType,
    status: "diajukan",
    requesterId: caller.uid,
    employeeName: input.employeeName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    spvApproval: null,
    managerApproval: null,
    branch: caller.branch,
    department: caller.department,
    position: caller.position,
    rejectionNote: null,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    completedAt: null,
  });

  const batch = writeBatch(db);
  const attachmentRef = doc(collection(submissionRef, "attachments"));
  batch.set(attachmentRef, { ...input.attachment, uploadedAt: serverTimestamp() });
  const historyRef = doc(collection(submissionRef, "statusHistory"));
  batch.set(historyRef, {
    status: "diajukan",
    note: null,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    throw new Error(
      `Pengajuan ${submissionNumber} sudah dibuat tapi dokumennya gagal tersimpan. Hubungi admin untuk pengecekan manual.`,
      { cause: error }
    );
  }

  return { submissionId: submissionRef.id, submissionNumber, status: "diajukan" };
}

async function resubmitAfterRevisi(
  input: CreatePersonaliaSubmissionInput,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  const submissionRef = doc(db, "submissions", input.submissionId!);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== caller.uid) {
    throw new Error("Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "perlu_revisi") {
    throw new Error("Hanya pengajuan berstatus perlu_revisi yang bisa direvisi.");
  }

  const existingAttachmentsSnap = await getDocs(collection(submissionRef, "attachments"));

  const batch = writeBatch(db);
  existingAttachmentsSnap.forEach((d) => batch.delete(d.ref));
  const attachmentRef = doc(collection(submissionRef, "attachments"));
  batch.set(attachmentRef, { ...input.attachment, uploadedAt: serverTimestamp() });
  batch.update(submissionRef, {
    subType: input.subType,
    employeeName: input.employeeName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: "diajukan",
    rejectionNote: null,
    spvApproval: null,
    managerApproval: null,
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

  const keptFileIds = new Set([input.attachment.fileId]);
  await Promise.all(
    existingAttachmentsSnap.docs.map(async (d) => {
      const fileId = d.data().fileId as string | undefined;
      if (!fileId || keptFileIds.has(fileId)) return;
      try {
        await deleteFromDriveClient(fileId);
      } catch (error) {
        console.error(`resubmitAfterRevisi (personalia): failed to delete orphaned Drive file ${fileId}`, error);
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

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds (this file isn't wired into any page yet, but it must compile standalone — Next.js type-checks every file in the project during build).

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/submitPersonaliaSubmission.ts
git commit -m "feat: add submitPersonaliaSubmission (create + resubmit)"
```

---

### Task 5: `reviewPersonaliaSubmission` module

**Files:**
- Create: `lib/submissions/reviewPersonaliaSubmission.ts`

Same testing rationale as Task 4 — no dedicated unit test file; covered by `tests/firestore-rules.test.ts` (Task 6) and manual QA.

- [ ] **Step 1: Create the file**

```ts
import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { reviewPersonaliaSubmissionSchema, ReviewPersonaliaSubmissionInput } from "@/lib/schemas/submission";
import type { AppUser } from "@/lib/hooks/useAuth";

export type ReviewPersonaliaSubmissionResult = { submissionId: string; status: "selesai" | "perlu_revisi" | "diajukan" };

const APPROVAL_FIELD: Record<"spv" | "management", "spvApproval" | "managerApproval"> = {
  spv: "spvApproval",
  management: "managerApproval",
};
const OTHER_APPROVAL_FIELD: Record<"spv" | "management", "spvApproval" | "managerApproval"> = {
  spv: "managerApproval",
  management: "spvApproval",
};
const APPROVER_LABEL: Record<"spv" | "management", string> = {
  spv: "AWS Supervisor",
  management: "Operational Manager",
};

export async function reviewPersonaliaSubmission(
  rawInput: unknown,
  caller: AppUser
): Promise<ReviewPersonaliaSubmissionResult> {
  const parsed = reviewPersonaliaSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ReviewPersonaliaSubmissionInput = parsed.data;

  if (caller.role !== "spv" && caller.role !== "management") {
    throw new Error("Anda tidak memiliki akses untuk mereview pengajuan.");
  }

  const submissionRef = doc(db, "submissions", input.submissionId);
  const submissionSnap = await getDoc(submissionRef);
  const submission = submissionSnap.data();
  if (!submission) {
    throw new Error("Pengajuan tidak ditemukan.");
  }
  if (submission.type !== "personalia") {
    throw new Error("Pengajuan ini bukan kategori personalia.");
  }
  if (submission.status !== "diajukan") {
    throw new Error("Hanya pengajuan berstatus diajukan yang bisa direview.");
  }

  const batch = writeBatch(db);
  const historyRef = doc(collection(submissionRef, "statusHistory"));

  if (input.decision === "reject") {
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
    await batch.commit();
    return { submissionId: input.submissionId, status: "perlu_revisi" };
  }

  const ownField = APPROVAL_FIELD[caller.role];
  const otherField = OTHER_APPROVAL_FIELD[caller.role];
  if (submission[ownField]) {
    throw new Error("Anda sudah memberikan approval untuk pengajuan ini.");
  }

  const bothApproved = submission[otherField] != null;
  const approvalRecord = {
    approverId: caller.uid,
    approverName: caller.name,
    note: input.note ?? null,
    decidedAt: serverTimestamp(),
  };

  batch.update(submissionRef, {
    [ownField]: approvalRecord,
    ...(bothApproved ? { status: "selesai", completedAt: serverTimestamp() } : {}),
  });
  batch.set(historyRef, {
    status: bothApproved ? "selesai" : "diajukan",
    note: bothApproved
      ? null
      : `Disetujui oleh ${APPROVER_LABEL[caller.role]}, menunggu ${APPROVER_LABEL[caller.role === "spv" ? "management" : "spv"]}`,
    actorId: caller.uid,
    actorRole: caller.role,
    timestamp: serverTimestamp(),
  });
  await batch.commit();

  return { submissionId: input.submissionId, status: bothApproved ? "selesai" : "diajukan" };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/reviewPersonaliaSubmission.ts
git commit -m "feat: add reviewPersonaliaSubmission (dual approval, immediate reject)"
```

---

### Task 6: Firestore rules — personalia create/transition rules

**Files:**
- Modify: `firestore.rules`
- Test: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Seed a `management`-role user in the shared test fixture**

In `tests/firestore-rules.test.ts`, inside the `beforeEach` block (after the `uid-spv2` line, currently line 20), add:

```ts
      await db.collection("users").doc("uid-mgmt").set({ role: "management", branch: null, name: "Andi Wijaya" });
```

- [ ] **Step 2: Write the failing tests**

Append a new `describe` block at the end of the file, just before the final closing `});` of the outer `describe("firestore.rules", ...)` (i.e. after the `describe("counters rule", ...)` block, before line 767's closing):

```ts
  describe("personalia submissions — create rule", () => {
    it("allows admin_cabang to create a lembur submission", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-1").set({
          requesterId: "uid-admin",
          status: "diajukan",
          type: "personalia",
          subType: "lembur",
        })
      );
    });

    it("denies spv from creating a lembur submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-2").set({
          requesterId: "uid-spv",
          status: "diajukan",
          type: "personalia",
          subType: "lembur",
        })
      );
    });

    it("allows spv to create a cuti submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-3").set({
          requesterId: "uid-spv",
          status: "diajukan",
          type: "personalia",
          subType: "cuti",
        })
      );
    });

    it("allows spv to create an izin submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-4").set({
          requesterId: "uid-spv",
          status: "diajukan",
          type: "personalia",
          subType: "izin",
        })
      );
    });

    it("denies management from creating any personalia submission", async () => {
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-5").set({
          requesterId: "uid-mgmt",
          status: "diajukan",
          type: "personalia",
          subType: "cuti",
        })
      );
    });
  });

  describe("personalia submissions — dual approval transitions", () => {
    async function seedPersonalia(id: string, overrides: Record<string, unknown> = {}) {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc(id).set({
          requesterId: "uid-admin",
          status: "diajukan",
          type: "personalia",
          subType: "cuti",
          spvApproval: null,
          managerApproval: null,
          ...overrides,
        });
      });
    }

    it("allows spv to record a partial approval, status stays diajukan", async () => {
      await seedPersonalia("pers-partial-1");
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-partial-1").update({
          spvApproval: { approverId: "uid-spv", approverName: "Siti Aminah", note: null, decidedAt: new Date() },
        })
      );
    });

    it("denies spv from also changing status during a partial approval", async () => {
      await seedPersonalia("pers-partial-2");
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-partial-2").update({
          status: "selesai",
          spvApproval: { approverId: "uid-spv", approverName: "Siti Aminah", note: null, decidedAt: new Date() },
        })
      );
    });

    it("denies spv from writing management's approval field", async () => {
      await seedPersonalia("pers-partial-3");
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-partial-3").update({
          managerApproval: { approverId: "uid-spv", approverName: "Siti Aminah", note: null, decidedAt: new Date() },
        })
      );
    });

    it("denies a forged approverId in the partial approval", async () => {
      await seedPersonalia("pers-partial-4");
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-partial-4").update({
          spvApproval: { approverId: "uid-spv2", approverName: "Siti Aminah", note: null, decidedAt: new Date() },
        })
      );
    });

    it("allows management to complete the second approval, status becomes selesai", async () => {
      await seedPersonalia("pers-final-1", {
        spvApproval: { approverId: "uid-spv", approverName: "Siti Aminah", note: null, decidedAt: new Date() },
      });
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-final-1").update({
          status: "selesai",
          completedAt: new Date(),
          managerApproval: { approverId: "uid-mgmt", approverName: "Andi Wijaya", note: null, decidedAt: new Date() },
        })
      );
    });

    it("denies completing to selesai when the other approval isn't present yet", async () => {
      await seedPersonalia("pers-final-2");
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-final-2").update({
          status: "selesai",
          completedAt: new Date(),
          managerApproval: { approverId: "uid-mgmt", approverName: "Andi Wijaya", note: null, decidedAt: new Date() },
        })
      );
    });

    it("allows spv or management to reject a personalia submission via the existing reject rule", async () => {
      await seedPersonalia("pers-reject-1");
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-reject-1").update({
          status: "perlu_revisi",
          rejectionNote: "Periode cuti tidak jelas",
        })
      );
    });

    it("allows the owner to resubmit a rejected personalia submission, clearing approvals", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("pers-resubmit-1").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
          type: "personalia",
          subType: "cuti",
          spvApproval: null,
          managerApproval: null,
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("pers-resubmit-1").update({
          status: "diajukan",
          rejectionNote: null,
          subType: "izin",
          employeeName: "Rahmat Hidayat",
          periodStart: "2026-09-10",
          periodEnd: "2026-09-11",
          spvApproval: null,
          managerApproval: null,
        })
      );
    });

    it("denies a non-owner from resubmitting a personalia submission", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("pers-resubmit-2").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
          type: "personalia",
          subType: "cuti",
          spvApproval: null,
          managerApproval: null,
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("pers-resubmit-2").update({
          status: "diajukan",
          rejectionNote: null,
          subType: "cuti",
          employeeName: "Rahmat Hidayat",
          periodStart: "2026-09-10",
          periodEnd: "2026-09-11",
          spvApproval: null,
          managerApproval: null,
        })
      );
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/firestore-rules.test.ts`
Expected: FAIL — this requires the Firestore emulator (`127.0.0.1:8080`), which needs Java. On this machine it fails with `ECONNREFUSED` regardless of the rules content (same pre-existing limitation as every other spec in this repo). **If you're executing this plan on a machine that has Java and the emulator running** (`firebase emulators:start --only firestore,auth`), this step should show the new tests failing with permission-denied-expected-success errors, confirming they correctly test not-yet-implemented rules.

- [ ] **Step 4: Add the rules**

In `firestore.rules`, replace the `create` rule (current lines 26-29):

```
      allow create: if isSignedIn()
        && isRequesterRole()
        && request.resource.data.requesterId == request.auth.uid
        && request.resource.data.status == 'diajukan';
```

with:

```
      allow create: if isSignedIn()
        && request.resource.data.requesterId == request.auth.uid
        && request.resource.data.status == 'diajukan'
        && (
          isRequesterRole()
          || (userRole() == 'spv'
            && request.resource.data.type == 'personalia'
            && request.resource.data.subType in ['cuti', 'izin'])
        );
```

Then, inside the `allow update:` rule, add three new clauses to the `||`-chain — insert them right before the closing `);` of the `allow update` block (current line 86, right after the "Tandai selesai" clause ending at line 85):

```
        ||
        // Resubmit personalia setelah revisi: pemilik, status lama perlu_revisi -> diajukan
        (resource.data.requesterId == request.auth.uid
          && resource.data.type == 'personalia'
          && resource.data.status == 'perlu_revisi'
          && request.resource.data.status == 'diajukan'
          && request.resource.data.spvApproval == null
          && request.resource.data.managerApproval == null
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['subType', 'employeeName', 'periodStart', 'periodEnd', 'status', 'rejectionNote', 'spvApproval', 'managerApproval']))
        ||
        // Personalia partial approval: spv/management mengisi approval milik sendiri, status tetap diajukan
        (resource.data.type == 'personalia'
          && resource.data.status == 'diajukan'
          && request.resource.data.status == 'diajukan'
          && (
            (userRole() == 'spv'
              && resource.data.spvApproval == null
              && request.resource.data.spvApproval.approverId == request.auth.uid
              && request.resource.data.spvApproval.approverName == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.name
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spvApproval']))
            ||
            (userRole() == 'management'
              && resource.data.managerApproval == null
              && request.resource.data.managerApproval.approverId == request.auth.uid
              && request.resource.data.managerApproval.approverName == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.name
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['managerApproval']))
          ))
        ||
        // Personalia final approval: approver kedua, status diajukan -> selesai
        (resource.data.type == 'personalia'
          && resource.data.status == 'diajukan'
          && request.resource.data.status == 'selesai'
          && (
            (userRole() == 'spv'
              && resource.data.managerApproval != null
              && resource.data.spvApproval == null
              && request.resource.data.spvApproval.approverId == request.auth.uid
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spvApproval', 'status', 'completedAt']))
            ||
            (userRole() == 'management'
              && resource.data.spvApproval != null
              && resource.data.managerApproval == null
              && request.resource.data.managerApproval.approverId == request.auth.uid
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['managerApproval', 'status', 'completedAt']))
          ))
```

No change is needed to the existing reject clause (lines 54-61) — it's already generic across `type`, which is exactly why the "reject via the existing reject rule" test in Step 2 targets it directly. No change is needed to the `items`/`attachments`/`statusHistory` subcollection rules either — they're keyed on `requesterId`/`isReviewer()`/submission `status`, none of which differ for personalia.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/firestore-rules.test.ts`
Expected: on a machine with Java + the emulator running, all tests PASS (old and new). On this machine, still `ECONNREFUSED` — document that in the task notes rather than treating it as a regression.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: add firestore rules for personalia create + dual-approval transitions"
```

---

### Task 7: Relabel "Management" → "Operational Manager" in UI

**Files:**
- Modify: `components/app-shell/nav-config.ts:38-44`
- Modify: `app/(dashboard)/admin/new/page.tsx:15-21`
- Modify: `app/(dashboard)/admin/edit/page.tsx:17-23`
- Modify: `lib/pdf/pdfTemplate.ts:6-9`
- Test: `lib/pdf/pdfTemplate.test.ts:60-63`

The database role value stays `"management"` everywhere — only the four display strings below change.

- [ ] **Step 1: Update the PDF template test first (TDD for the one label with a test)**

In `lib/pdf/pdfTemplate.test.ts`, change line 62:

```ts
    expect(html).toContain("Management");
```

to:

```ts
    expect(html).toContain("Operational Manager");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/pdf/pdfTemplate.test.ts`
Expected: FAIL (the code still renders "Management").

- [ ] **Step 3: Update the four labels**

In `lib/pdf/pdfTemplate.ts`, change lines 6-9:

```ts
const APPROVER_ROLE_LABEL: Record<"spv" | "management", string> = {
  spv: "AWS Supervisor",
  management: "Management",
};
```

to:

```ts
const APPROVER_ROLE_LABEL: Record<"spv" | "management", string> = {
  spv: "AWS Supervisor",
  management: "Operational Manager",
};
```

In `components/app-shell/nav-config.ts`, change the `ROLE_LABEL` map (current lines 38-44):

```ts
export const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin_cabang: "Admin Cabang",
  snd: "SND",
  spv: "AWS Supervisor",
  management: "Management",
  superadmin: "Superadmin",
};
```

to:

```ts
export const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin_cabang: "Admin Cabang",
  snd: "SND",
  spv: "AWS Supervisor",
  management: "Operational Manager",
  superadmin: "Superadmin",
};
```

In `app/(dashboard)/admin/new/page.tsx`, change the `ROLE_OPTIONS` array (current lines 15-21):

```ts
const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Management" },
  { value: "superadmin", label: "Superadmin" },
] as const;
```

to:

```ts
const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Operational Manager" },
  { value: "superadmin", label: "Superadmin" },
] as const;
```

Apply the identical change to the identical `ROLE_OPTIONS` array in `app/(dashboard)/admin/edit/page.tsx` (current lines 17-23).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pdf/pdfTemplate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/app-shell/nav-config.ts app/(dashboard)/admin/new/page.tsx app/(dashboard)/admin/edit/page.tsx lib/pdf/pdfTemplate.ts lib/pdf/pdfTemplate.test.ts
git commit -m "chore: relabel management role as Operational Manager in UI"
```

---

### Task 8: Use `TYPE_LABEL` consistently + let `spv` see "Pengajuan Saya"

**Files:**
- Modify: `app/(dashboard)/pengajuan/page.tsx`
- Modify: `components/monitoring-row/MonitoringRow.tsx`
- Modify: `app/(dashboard)/persetujuan/page.tsx`
- Modify: `components/app-shell/nav-config.ts:16-21`

`spv` can now submit `cuti`/`izin` (Task 4/6), so it needs to reach `/pengajuan` and `/pengajuan/new` — currently that nav item is hidden for `spv`.

- [ ] **Step 1: Add `spv` to the "Pengajuan Saya" nav roles**

In `components/app-shell/nav-config.ts`, change the first `NAV_ITEMS` entry (current lines 16-21):

```ts
  {
    href: "/pengajuan",
    label: "Pengajuan Saya",
    icon: FileStack,
    roles: ["admin_cabang", "snd"],
  },
```

to:

```ts
  {
    href: "/pengajuan",
    label: "Pengajuan Saya",
    icon: FileStack,
    roles: ["admin_cabang", "snd", "spv"],
  },
```

- [ ] **Step 2: Use `TYPE_LABEL` in `/pengajuan`**

In `app/(dashboard)/pengajuan/page.tsx`, remove the local label map (current lines 17-18):

```ts
const TYPE_LABEL: Record<string, string> = { kendaraan: "Kendaraan", perlengkapan: "Perlengkapan" };
```

and instead import it from the schema module — add to the existing import block near the top of the file:

```ts
import { TYPE_LABEL } from "@/lib/schemas/submission";
```

The rest of the file already does `{TYPE_LABEL[row.type] ?? row.type}` — no other change needed there.

- [ ] **Step 3: Use `TYPE_LABEL` in `MonitoringRow`**

In `components/monitoring-row/MonitoringRow.tsx`, add the import:

```ts
import { TYPE_LABEL } from "@/lib/schemas/submission";
```

and change the type cell (current line):

```tsx
      <TableCell className="capitalize">{submission.type}</TableCell>
```

to:

```tsx
      <TableCell>{TYPE_LABEL[submission.type] ?? submission.type}</TableCell>
```

- [ ] **Step 4: Use `TYPE_LABEL` in `/persetujuan`**

In `app/(dashboard)/persetujuan/page.tsx`, add the import:

```ts
import { TYPE_LABEL } from "@/lib/schemas/submission";
```

and change the queue card subtitle (current line inside the `CardHeader`):

```tsx
                    <p className="text-sm text-muted-foreground">
                      {row.type} · {row.branch}
                    </p>
```

to:

```tsx
                    <p className="text-sm text-muted-foreground">
                      {TYPE_LABEL[row.type] ?? row.type} · {row.branch}
                    </p>
```

(This file's row type is currently untyped as `string` via the existing `QueueRow` type — `TYPE_LABEL[row.type]` still works since `TYPE_LABEL` is indexed by `string`.)

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/(dashboard)/pengajuan/page.tsx components/monitoring-row/MonitoringRow.tsx app/(dashboard)/persetujuan/page.tsx components/app-shell/nav-config.ts
git commit -m "refactor: use shared TYPE_LABEL map; let spv reach Pengajuan Saya"
```

---

### Task 9: Regression-proof `lib/monitoring.ts` against skipped stages

**Files:**
- Test: `lib/monitoring.test.ts` (append)

`computeStageDurations` already returns `null` for any stage timestamp it can't find via `findFirst`, and `formatDuration(null)` already renders `"-"` — personalia's history (`diajukan` → `selesai` directly, no `disetujui`/`siap_dikirim`/`on_proses_ga` entries) is exactly this "missing middle stages" case. This task locks that behavior in with an explicit test rather than assuming it — no production code change is expected.

- [ ] **Step 1: Read the existing test file to match its exact import/style**

Run: `cat lib/monitoring.test.ts` (or open it) and confirm the top-of-file imports (`computeStageDurations`, `formatDuration` from `./monitoring`) before writing the new test in the same style.

- [ ] **Step 2: Write the test**

Append a new `describe` block to `lib/monitoring.test.ts`:

```ts
describe("computeStageDurations — personalia (stages skipped entirely)", () => {
  it("returns null for disetujui/siap_dikirim/on_proses_ga stages when only diajukan and selesai exist", () => {
    const now = new Date("2026-09-05T00:00:00Z");
    const entries = [
      { status: "diajukan", timestamp: new Date("2026-09-01T00:00:00Z") },
      { status: "selesai", timestamp: new Date("2026-09-03T00:00:00Z") },
    ];
    const durations = computeStageDurations(entries, now);
    expect(durations.diajukanToDisetujui).toBeNull();
    expect(durations.disetujuiToSiapDikirim).toBeNull();
    expect(durations.siapDikirimToOnProsesGa).toBeNull();
    expect(durations.onProsesGaToSelesai).toBeNull();
  });

  it("still computes total duration end to end", () => {
    const now = new Date("2026-09-05T00:00:00Z");
    const entries = [
      { status: "diajukan", timestamp: new Date("2026-09-01T00:00:00Z") },
      { status: "selesai", timestamp: new Date("2026-09-03T00:00:00Z") },
    ];
    const durations = computeStageDurations(entries, now);
    expect(durations.total).toBe(new Date("2026-09-03T00:00:00Z").getTime() - new Date("2026-09-01T00:00:00Z").getTime());
  });

  it("formatDuration renders null stages as a dash", () => {
    expect(formatDuration(null)).toBe("-");
  });
});
```

- [ ] **Step 3: Run the test to verify it passes immediately**

Run: `npx vitest run lib/monitoring.test.ts`
Expected: PASS with no code changes — this confirms the assumption from the design spec before any UI work depends on it. If it fails, stop and fix `lib/monitoring.ts` before proceeding to Task 12.

- [ ] **Step 4: Commit**

```bash
git add lib/monitoring.test.ts
git commit -m "test: lock in monitoring duration behavior for skipped-stage (personalia) history"
```

---

### Task 10: `/pengajuan/new` — Personalia form branch

**Files:**
- Modify: `app/(dashboard)/pengajuan/new/page.tsx`

This page currently renders one `useForm` bound to `createSubmissionSchema`. Personalia needs a second, independent `useForm` bound to `createPersonaliaSubmissionSchema` — the two shapes don't share enough fields to merge into one resolver. A single top-level "Kategori" selector switches which form is shown and which submit function runs.

- [ ] **Step 1: Replace the whole file**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  createSubmissionSchema,
  CreateSubmissionInput,
  subTypeByType,
  createPersonaliaSubmissionSchema,
  CreatePersonaliaSubmissionInput,
  PERSONALIA_SUBTYPE_LABEL,
} from "@/lib/schemas/submission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
import { useAuth } from "@/lib/hooks/useAuth";
import { submitSubmission } from "@/lib/submissions/submitSubmission";
import { submitPersonaliaSubmission } from "@/lib/submissions/submitPersonaliaSubmission";
import type { AppUser } from "@/lib/hooks/useAuth";
import { AlertCircle, FileText, Paperclip, PenLine, Plus, Trash2 } from "lucide-react";

type Category = "kendaraan" | "perlengkapan" | "gedung_fasilitas" | "lembur" | "cuti" | "izin";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "kendaraan", label: "Kendaraan" },
  { value: "perlengkapan", label: "Perlengkapan" },
  { value: "gedung_fasilitas", label: "Gedung & Fasilitas" },
  { value: "lembur", label: "Lembur" },
  { value: "cuti", label: "Cuti" },
  { value: "izin", label: "Izin" },
];

const PERSONALIA_ALLOWED_ROLES: Record<"lembur" | "cuti" | "izin", AppUser["role"][]> = {
  lembur: ["admin_cabang", "snd"],
  cuti: ["admin_cabang", "snd", "spv"],
  izin: ["admin_cabang", "snd", "spv"],
};

function categoryOptionsForRole(role: AppUser["role"] | undefined): typeof CATEGORY_OPTIONS {
  if (!role) return CATEGORY_OPTIONS;
  return CATEGORY_OPTIONS.filter((opt) => {
    if (opt.value === "lembur" || opt.value === "cuti" || opt.value === "izin") {
      return PERSONALIA_ALLOWED_ROLES[opt.value].includes(role);
    }
    return true;
  });
}

function isPersonaliaCategory(category: Category): category is "lembur" | "cuti" | "izin" {
  return category === "lembur" || category === "cuti" || category === "izin";
}

export default function NewPengajuanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appUser } = useAuth();
  const resubmitId = searchParams.get("resubmit") ?? undefined;
  const [category, setCategory] = useState<Category>("kendaraan");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoadingResubmit, setIsLoadingResubmit] = useState(!!resubmitId);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [signatureMode, setSignatureMode] = useState<"gambar" | "upload">("gambar");
  const [signatureFileName, setSignatureFileName] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createSubmissionSchema>, unknown, CreateSubmissionInput>({
    resolver: zodResolver(createSubmissionSchema),
    defaultValues: {
      submissionId: resubmitId,
      type: "kendaraan",
      subType: "service_berkala",
      requesterSignatureUrl: "",
      items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
      attachments: [],
    },
  });

  const {
    register: registerPersonalia,
    handleSubmit: handleSubmitPersonalia,
    setValue: setValuePersonalia,
    watch: watchPersonalia,
    reset: resetPersonalia,
    formState: { errors: personaliaErrors, isSubmitting: isSubmittingPersonalia },
  } = useForm<z.input<typeof createPersonaliaSubmissionSchema>, unknown, CreatePersonaliaSubmissionInput>({
    resolver: zodResolver(createPersonaliaSubmissionSchema),
    defaultValues: {
      submissionId: resubmitId,
      subType: "cuti",
      employeeName: "",
      periodStart: "",
      periodEnd: "",
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment,
  } = useFieldArray({ control, name: "attachments" });
  const selectedType = watch("type");
  const typeField = register("type");
  const personaliaAttachmentName = watchPersonalia("attachment")?.fileName;

  function handleCategoryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextCategory = event.target.value as Category;
    setCategory(nextCategory);
    if (!isPersonaliaCategory(nextCategory)) {
      setValue("type", nextCategory);
      setValue("subType", subTypeByType[nextCategory][0]);
    }
  }

  function handleSignatureModeChange(mode: "gambar" | "upload") {
    setSignatureMode(mode);
    setValue("requesterSignatureUrl", "");
    setSignatureFileName(null);
  }

  useEffect(() => {
    if (!resubmitId) return;
    const id = resubmitId;
    let cancelled = false;

    async function loadResubmitData() {
      setIsLoadingResubmit(true);
      setResubmitError(null);
      try {
        const submissionSnap = await getDoc(doc(db, "submissions", id));
        if (!submissionSnap.exists()) {
          throw new Error("Pengajuan tidak ditemukan.");
        }
        const submissionData = submissionSnap.data();

        if (submissionData?.type === "personalia") {
          const attachmentsSnap = await getDocs(collection(db, "submissions", id, "attachments"));
          const firstAttachment = attachmentsSnap.docs[0]?.data();
          if (cancelled) return;
          setCategory(submissionData.subType as Category);
          resetPersonalia({
            submissionId: id,
            subType: submissionData.subType,
            employeeName: submissionData.employeeName ?? "",
            periodStart: submissionData.periodStart ?? "",
            periodEnd: submissionData.periodEnd ?? "",
            attachment: firstAttachment
              ? {
                  fileId: firstAttachment.fileId,
                  fileUrl: firstAttachment.fileUrl,
                  fileName: firstAttachment.fileName,
                  fileType: firstAttachment.fileType,
                }
              : undefined,
          });
          return;
        }

        const itemsSnap = await getDocs(collection(db, "submissions", id, "items"));
        const items = itemsSnap.docs.map((itemDoc) => {
          const data = itemDoc.data();
          return {
            itemName: data.itemName ?? "",
            brandType: data.brandType ?? "",
            km: data.km ?? null,
            quantity: data.quantity ?? 1,
            unit: data.unit ?? "",
            description: data.description ?? "",
          };
        });
        const attachmentsSnap = await getDocs(collection(db, "submissions", id, "attachments"));
        const attachments = attachmentsSnap.docs.map((attachmentDoc) => {
          const data = attachmentDoc.data();
          return {
            fileId: data.fileId ?? "",
            fileUrl: data.fileUrl ?? "",
            fileName: data.fileName ?? "",
            fileType: data.fileType ?? "",
          };
        });

        if (cancelled) return;

        setCategory((submissionData?.type as Category) ?? "kendaraan");
        reset({
          submissionId: id,
          type: submissionData?.type ?? "kendaraan",
          subType: submissionData?.subType ?? "service_berkala",
          requesterSignatureUrl: "",
          items:
            items.length > 0
              ? items
              : [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
          attachments,
        });
      } catch (err) {
        if (cancelled) return;
        const code = (err as { code?: string } | undefined)?.code;
        if (code === "permission-denied") {
          setResubmitError("Anda tidak punya akses ke pengajuan ini.");
        } else if (err instanceof Error && err.message === "Pengajuan tidak ditemukan.") {
          setResubmitError(err.message);
        } else {
          setResubmitError("Gagal memuat data pengajuan untuk direvisi.");
        }
      } finally {
        if (!cancelled) setIsLoadingResubmit(false);
      }
    }

    loadResubmitData();
    return () => {
      cancelled = true;
    };
  }, [resubmitId, reset, resetPersonalia]);

  async function onSubmit(data: CreateSubmissionInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      const result = await submitSubmission(data, appUser);
      router.push(`/pengajuan/detail?id=${result.submissionId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    }
  }

  async function onSubmitPersonalia(data: CreatePersonaliaSubmissionInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      const result = await submitPersonaliaSubmission(data, appUser);
      router.push(`/pengajuan/detail?id=${result.submissionId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    }
  }

  if (isLoadingResubmit) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Memuat data pengajuan...</div>;
  }

  if (resubmitError) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-destructive">{resubmitError}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title={resubmitId ? "Revisi Pengajuan" : "Buat Pengajuan"}
        description="Isi detail kendaraan, perlengkapan, gedung & fasilitas, atau lembur/cuti/izin yang ingin Anda ajukan."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kategori Pengajuan</CardTitle>
        </CardHeader>
        <CardContent>
          <NativeSelect value={category} onChange={handleCategoryChange} disabled={!!resubmitId}>
            {categoryOptionsForRole(appUser?.role).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>

      {isPersonaliaCategory(category) ? (
        <form onSubmit={handleSubmitPersonalia(onSubmitPersonalia)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Detail Pengajuan {PERSONALIA_SUBTYPE_LABEL[category]}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="employeeName">Nama Karyawan</Label>
                <Input id="employeeName" {...registerPersonalia("employeeName")} />
                {personaliaErrors.employeeName && (
                  <p className="text-sm text-destructive">{personaliaErrors.employeeName.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Tanggal Mulai</Label>
                <Input id="periodStart" type="date" {...registerPersonalia("periodStart")} />
                {personaliaErrors.periodStart && (
                  <p className="text-sm text-destructive">{personaliaErrors.periodStart.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Tanggal Selesai</Label>
                <Input id="periodEnd" type="date" {...registerPersonalia("periodEnd")} />
                {personaliaErrors.periodEnd && (
                  <p className="text-sm text-destructive">{personaliaErrors.periodEnd.message}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4 text-primary" />
                Dokumen Form {PERSONALIA_SUBTYPE_LABEL[category]}
              </CardTitle>
              <CardDescription>Upload form yang sudah diisi & ditandatangani manual (PDF).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {personaliaAttachmentName ? (
                <div className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <span className="truncate">{personaliaAttachmentName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setValuePersonalia("attachment", undefined as never)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <FileUpload purpose="attachment" onUploaded={(file) => setValuePersonalia("attachment", file)} />
              )}
              {personaliaErrors.attachment && (
                <p className="text-sm text-destructive">Dokumen PDF wajib diupload.</p>
              )}
            </CardContent>
          </Card>

          {serverError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Button type="submit" disabled={isSubmittingPersonalia} size="lg">
            {isSubmittingPersonalia ? "Mengirim..." : "Kirim Pengajuan"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Sub Jenis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <input type="hidden" {...typeField} />
              <NativeSelect id="subType" {...register("subType")}>
                {subTypeByType[selectedType].map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </NativeSelect>
              {errors.subType && <p className="text-sm text-destructive">{errors.subType.message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Item</CardTitle>
                <CardDescription>Daftar barang/layanan yang diajukan.</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" })
                }
              >
                <Plus className="h-4 w-4" />
                Tambah Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {fields.map((field, index) => {
                const itemErrors = errors.items?.[index];
                return (
                  <div key={field.id} className="space-y-3 rounded-xl border bg-muted/30 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Input placeholder="Nama item" {...register(`items.${index}.itemName`)} />
                        {itemErrors?.itemName && (
                          <p className="text-sm text-destructive">{itemErrors.itemName.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Input placeholder="Merk/Tipe" {...register(`items.${index}.brandType`)} />
                        {itemErrors?.brandType && (
                          <p className="text-sm text-destructive">{itemErrors.brandType.message}</p>
                        )}
                      </div>
                      {selectedType === "kendaraan" && (
                        <div className="space-y-1.5">
                          <Input
                            type="number"
                            placeholder="KM"
                            className="font-mono"
                            {...register(`items.${index}.km`, {
                              setValueAs: (v) => (v === "" ? null : Number(v)),
                            })}
                          />
                          {itemErrors?.km && <p className="text-sm text-destructive">{itemErrors.km.message}</p>}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Input
                          type="number"
                          placeholder="Jumlah"
                          className="font-mono"
                          {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                        />
                        {itemErrors?.quantity && (
                          <p className="text-sm text-destructive">{itemErrors.quantity.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Input placeholder="Satuan" {...register(`items.${index}.unit`)} />
                        {itemErrors?.unit && <p className="text-sm text-destructive">{itemErrors.unit.message}</p>}
                      </div>
                    </div>
                    <Textarea placeholder="Deskripsi" {...register(`items.${index}.description`)} />
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Hapus Item
                      </Button>
                    )}
                  </div>
                );
              })}
              {errors.items && !Array.isArray(errors.items) && (
                <p className="text-sm text-destructive">{errors.items.message as string}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4 text-primary" />
                Lampiran <span className="font-normal text-muted-foreground">(opsional)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {attachmentFields.map((field, index) => (
                <div key={field.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <span className="truncate">{field.fileName}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachment(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <FileUpload purpose="attachment" onUploaded={(file) => appendAttachment(file)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PenLine className="h-4 w-4 text-primary" />
                Tanda Tangan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={signatureMode === "gambar" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSignatureModeChange("gambar")}
                >
                  Gambar
                </Button>
                <Button
                  type="button"
                  variant={signatureMode === "upload" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSignatureModeChange("upload")}
                >
                  Upload File
                </Button>
              </div>
              {signatureMode === "gambar" ? (
                <SignaturePad onChange={(dataUrl) => setValue("requesterSignatureUrl", dataUrl ?? "")} />
              ) : (
                <>
                  <FileUpload
                    purpose="signature"
                    onUploaded={(file) => {
                      setValue("requesterSignatureUrl", file.fileUrl);
                      setSignatureFileName(file.fileName);
                    }}
                  />
                  {signatureFileName && (
                    <p className="text-sm text-muted-foreground">Berhasil diupload: {signatureFileName}</p>
                  )}
                </>
              )}
              {errors.requesterSignatureUrl && (
                <p className="text-sm text-destructive">Tanda tangan wajib diisi.</p>
              )}
            </CardContent>
          </Card>

          {serverError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} size="lg">
            {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
          </Button>
        </form>
      )}
    </div>
  );
}
```

Notes on what changed from the previous version of this file: the "Jenis Pengajuan" (Kendaraan/Perlengkapan) `<select>` is replaced by the new "Kategori Pengajuan" card at the top (now 6 flat options, filtered by role), which drives a `category` state; a hidden `type` field keeps `createSubmissionSchema`'s `register("type")` wired for the operational branch; the "Sub Jenis" card no longer needs an `onChange` handler because `handleCategoryChange` already sets `subType` to `subTypeByType[category][0]` whenever the category changes.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke check (no live Firebase needed for this — just React state/rendering)**

Run: `npm run dev`, open `http://localhost:3000/pengajuan/new` (log in first at `/login`), and:
- Switch "Kategori Pengajuan" through all options — confirm the item-based form shows for Kendaraan/Perlengkapan/Gedung & Fasilitas, and the employee/period/upload form shows for Lembur/Cuti/Izin.
- Confirm the category dropdown, when logged in as a non-`spv`/`management` role, shows all 6 options; note in your task notes if you don't have an `spv` test account handy to verify the Lembur option is hidden for `spv` (that's a Firestore-rules-level guarantee from Task 6 regardless, so this is a UX nicety check, not a security check).

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/pengajuan/new/page.tsx
git commit -m "feat: add personalia form branch to /pengajuan/new"
```

---

### Task 11: `/pengajuan/detail` — Personalia view branch

**Files:**
- Modify: `app/(dashboard)/pengajuan/detail/page.tsx`

- [ ] **Step 1: Add the personalia-specific imports**

Add to the top of `app/(dashboard)/pengajuan/detail/page.tsx`:

```ts
import { buildPersonaliaWaTemplate } from "@/lib/wa-template";
import { TYPE_LABEL, PERSONALIA_SUBTYPE_LABEL } from "@/lib/schemas/submission";
```

(the existing `buildWaTemplate` import stays — both are used, one per branch.)

- [ ] **Step 2: Add personalia copy-to-HC state and handler**

In `PengajuanDetailContent`, alongside the existing `copyFeedback`/`copyError` state, add:

```ts
  const [hcCopyFeedback, setHcCopyFeedback] = useState(false);
  const [hcCopyError, setHcCopyError] = useState<string | null>(null);
  const [personaliaAttachmentUrl, setPersonaliaAttachmentUrl] = useState<string | null>(null);
```

Add a second effect (alongside the existing submission/history listeners) that loads the single attachment for personalia submissions:

```ts
  useEffect(() => {
    if (!id || !submission || submission.type !== "personalia") return;
    const unsub = onSnapshot(collection(db, "submissions", id, "attachments"), (snap) => {
      setPersonaliaAttachmentUrl(snap.docs[0]?.data().fileUrl ?? null);
    });
    return unsub;
  }, [id, submission]);
```

This needs `collection` added to the existing `firebase/firestore` import line (it currently imports `doc, onSnapshot, collection, orderBy, query, DocumentData` — `collection` is already there, no import change needed).

Add the handler function, next to `handleCopy`:

```ts
  async function handleCopyToHc() {
    if (!submission || !appUser || !personaliaAttachmentUrl) return;
    setHcCopyError(null);
    const text = buildPersonaliaWaTemplate(
      {
        submissionNumber: submission.submissionNumber,
        subType: submission.subType,
        employeeName: submission.employeeName,
        branch: submission.branch,
        periodStart: submission.periodStart,
        periodEnd: submission.periodEnd,
        attachmentUrl: personaliaAttachmentUrl,
      },
      appUser.name
    );
    try {
      await navigator.clipboard.writeText(text);
      setHcCopyFeedback(true);
      setTimeout(() => setHcCopyFeedback(false), 2000);
    } catch {
      setHcCopyError("Gagal menyalin. Coba salin manual.");
    }
  }
```

- [ ] **Step 3: Branch the render**

Replace the block that currently renders the header + status-specific cards (from `<h2 className="font-mono text-xl font-bold tracking-tight">{submission.submissionNumber}</h2>` through the end of the `siap_dikirim` block, i.e. everything between the header row and the `on_proses_ga` block) so that personalia submissions skip straight from the header to an approval-progress card and, once `selesai`, the HC copy card — while the `perlu_revisi` card and the final `SubmissionTimeline` card stay shared for both branches.

Concretely, wrap the existing `disetujui`/`siap_dikirim`/`on_proses_ga` blocks in `{submission.type !== "personalia" && ( ... )}`, and insert a new personalia-only block right after the `perlu_revisi` card:

```tsx
      {submission.type === "personalia" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detail {PERSONALIA_SUBTYPE_LABEL[submission.subType as "lembur" | "cuti" | "izin"] ?? submission.subType}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Nama Karyawan</p>
                <p className="font-medium">{submission.employeeName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Periode</p>
                <p className="font-mono">{submission.periodStart} s/d {submission.periodEnd}</p>
              </div>
            </div>
            {personaliaAttachmentUrl && (
              <a
                href={personaliaAttachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                Lihat Dokumen PDF
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {submission.status === "diajukan" && (
              <p className="text-muted-foreground">
                {submission.spvApproval && !submission.managerApproval &&
                  "Sudah disetujui AWS Supervisor, menunggu Operational Manager."}
                {submission.managerApproval && !submission.spvApproval &&
                  "Sudah disetujui Operational Manager, menunggu AWS Supervisor."}
                {!submission.spvApproval && !submission.managerApproval &&
                  "Menunggu approval AWS Supervisor dan Operational Manager."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {submission.type === "personalia" && submission.status === "selesai" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kirim ke HC lewat WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopyToHc} disabled={!personaliaAttachmentUrl}>
                <Copy className="h-4 w-4" />
                Salin Template WA ke HC
              </Button>
              {hcCopyFeedback && (
                <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Disalin!
                </span>
              )}
            </div>
            {hcCopyError && <p className="text-sm text-destructive">{hcCopyError}</p>}
          </CardContent>
        </Card>
      )}
```

`ExternalLink` is already imported (used by the existing `siap_dikirim` block's "Lihat PDF" link).

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/pengajuan/detail/page.tsx
git commit -m "feat: add personalia view branch to /pengajuan/detail"
```

---

### Task 12: `/persetujuan` — Personalia review branch

**Files:**
- Modify: `app/(dashboard)/persetujuan/page.tsx`

The existing page queries `where("status", "==", "diajukan")` and renders one Card layout per row (signature pad required, single approve/reject). Personalia rows need a simpler Card: no signature, and an approve/reject action that calls `reviewPersonaliaSubmission` instead of `reviewSubmission`.

- [ ] **Step 1: Extend the row type and import the new function**

Change the `QueueRow` type (current line 15):

```ts
type QueueRow = { id: string; submissionNumber: string; type: string; branch: string };
```

to:

```ts
type QueueRow = { id: string; submissionNumber: string; type: string; subType: string; branch: string };
```

and update the `onSnapshot` mapping (inside the `useEffect` that builds `rows`) to also read `subType`:

```ts
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            subType: d.data().subType,
            branch: d.data().branch,
          }))
        );
```

Add the import:

```ts
import { reviewPersonaliaSubmission } from "@/lib/submissions/reviewPersonaliaSubmission";
```

- [ ] **Step 2: Add a personalia decision handler**

Alongside the existing `handleDecision`, add:

```ts
  async function handlePersonaliaDecision(submissionId: string, decision: "approve" | "reject") {
    if (!appUser) return;
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      await reviewPersonaliaSubmission(
        {
          submissionId,
          decision,
          rejectionNote: noteBySubmission[submissionId],
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

- [ ] **Step 3: Branch the row rendering**

Inside the `rows.map((row) => { ... })` block, right after computing `mode`/`hasSignature`, branch on `row.type`:

```tsx
          {rows.map((row) => {
            if (row.type === "personalia") {
              return (
                <Card key={row.id}>
                  <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
                    <div>
                      <p className="font-mono text-sm font-semibold">{row.submissionNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        {TYPE_LABEL[row.type] ?? row.type} · {row.branch}
                      </p>
                    </div>
                    <StatusBadge status="diajukan" />
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="space-y-1.5">
                      <Label htmlFor={`note-${row.id}`}>Catatan (wajib jika tolak)</Label>
                      <Textarea
                        id={`note-${row.id}`}
                        placeholder="Tulis catatan revisi di sini..."
                        value={noteBySubmission[row.id] ?? ""}
                        onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      />
                    </div>
                    {actionErrorBySubmission[row.id] && (
                      <p className="text-sm text-destructive">{actionErrorBySubmission[row.id]}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={busyId === row.id || !appUser}
                        onClick={() => handlePersonaliaDecision(row.id, "approve")}
                      >
                        <Check className="h-4 w-4" />
                        Setujui
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyId === row.id || !appUser}
                        onClick={() => handlePersonaliaDecision(row.id, "reject")}
                      >
                        <X className="h-4 w-4" />
                        Tolak
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            const mode = signatureModeBySubmission[row.id] ?? "gambar";
            const hasSignature = !!signatureBySubmission[row.id];
            return (
```

(the rest of the existing operational Card — unchanged — follows this `return (`, closing with its existing `);` and the `})}` that ends the `.map`.)

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/persetujuan/page.tsx
git commit -m "feat: add personalia review branch to /persetujuan"
```

---

### Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: same emulator-dependent failures as the pre-existing baseline (`tests/firestore-rules.test.ts` and any Firestore-dependent test — `ECONNREFUSED`, no Java on this machine), but every pure/schema/template test — including all the new ones from Tasks 1-3, 7, 9 — passes.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds, all 11 existing routes plus no new routes (personalia lives inside existing `/pengajuan/new`, `/pengajuan/detail`, `/persetujuan` — no new pages were created).

- [ ] **Step 3: Manual QA checklist (requires a real login against `sndsupportapps` — see project memory on Drive OAuth two-step upload before testing file uploads)**

Document the outcome of each in your task notes; don't just assume success:
- Log in as an `admin_cabang` user → `/pengajuan/new` → submit a `lembur` request → confirm it appears in `/pengajuan` and `/monitoring` with the "Personalia" type label and "-" in the GA-related duration columns.
- Log in as `spv` → confirm `/persetujuan` shows the new submission with the simplified (no-signature) review card, and confirm the "Lembur" category is absent if `spv` tries `/pengajuan/new` themselves.
- Approve as `spv` → confirm status stays "Diajukan" in the badge, and the detail page shows "Sudah disetujui AWS Supervisor, menunggu Operational Manager."
- Log in as `management` → approve the same submission → confirm status flips to "Selesai" and the "Salin Template WA ke HC" button appears and works.
- Submit a `gedung_fasilitas` request as `admin_cabang` and confirm it goes through the full existing operational flow (signature → approve → generate PDF → siap_dikirim → confirm sent to GA → mark done) with no errors.

- [ ] **Step 4: Commit any fixes found during manual QA as separate commits**

If Step 3 surfaces a bug, fix it and commit separately — do not silently amend earlier task commits.

---

## Self-Review

**Spec coverage:** All 7 numbered decisions in the design spec map to a task — §1 (type/subType extension) → Task 1; §2 (personalia data/form) → Tasks 2, 10; §3 (dual-approval status flow) → Tasks 5, 6, 11; §4 (role/permission table) → Tasks 4, 6; §5 (Firestore rules) → Task 6; §6 (new isolated modules, existing modules untouched) → Tasks 4, 5 (verified no edits to `submitSubmission.ts`/`reviewSubmission.ts`/`confirmSentToGa.ts`/`markAsDone.ts` anywhere in this plan); §7 (UI: `/pengajuan/new`, `/pengajuan/detail`, `/persetujuan`, monitoring, role relabel) → Tasks 7, 8, 9, 10, 11, 12.

**Placeholder scan:** No TBD/TODO markers; every code step has complete code; no "similar to Task N" references.

**Type consistency:** `CreatePersonaliaSubmissionInput`/`ReviewPersonaliaSubmissionInput` names and shapes are identical between Task 2 (definition) and Tasks 4/5/10 (usage). `spvApproval`/`managerApproval` field names are identical across Task 5 (function), Task 6 (rules), and Task 11 (UI read). `TYPE_LABEL`/`PERSONALIA_SUBTYPE_LABEL` names are identical between Task 1 (definition) and Tasks 8/10/11/12 (usage).
