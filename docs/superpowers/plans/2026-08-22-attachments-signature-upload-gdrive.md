# Lampiran & Upload Tanda Tangan via Google Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional supporting-document attachments and an alternative "upload PNG" signature mode to the "Buat Pengajuan" form, storing all uploaded files in Google Drive via a new `uploadFile` Cloud Function.

**Architecture:** A new Cloud Function callable (`uploadFile`) is the only part of the system that talks to Google Drive — it validates the caller (same role gate as `submitSubmission`), validates file type/size per purpose, uploads to a pre-configured shared Drive folder using `googleapis`, sets link-sharing permission, and returns `{fileUrl, fileName, fileType}`. The client uploads each file individually (via a new reusable `FileUpload` component) as the user picks it — not bundled into the final submit payload — then only the small resulting metadata travels through `submitSubmission`'s existing payload/batch-write, extended to also persist an `attachments` subcollection (already in the documented data model, never built until now). Firestore rules extend the existing read-follows-parent-submission pattern (already used for `items`/`statusHistory`) to the new `attachments` subcollection.

**Tech Stack:** Next.js 14, TypeScript (strict), React Hook Form + Zod (existing), Firebase Cloud Functions v2 + Admin SDK (existing), `googleapis` (new — Google Drive API v3 client), Vitest (existing, mocked Drive client for unit tests).

**Design spec:** `docs/superpowers/specs/2026-08-22-attachments-signature-upload-gdrive-design.md` — read it for the full rationale behind these decisions (Drive-vs-Storage choice, "anyone with link" sharing model, why attachments upload per-file instead of bundled into submit, etc.).

**Explicitly out of scope for this plan** (per the design spec): storing generated PDFs in Drive (waits for `generateSubmissionPdf` to be designed), and approver signature capture (unrelated gap, not requested).

---

## File Structure

```
functions/
  package.json                    # +googleapis dependency
  src/
    googleDrive.ts                 # NEW — thin wrapper around the Drive API (upload + set permission)
    googleDrive.test.ts            # NEW — unit tests, googleapis mocked
    uploadFile.ts                  # NEW — the uploadFile Cloud Function handler
    uploadFile.test.ts             # NEW — unit tests, googleapis mocked + Firestore emulator for auth/role
    schemas.ts                     # MODIFY — add attachmentSchema, uploadFileSchema, attachments field
    submitSubmission.ts            # MODIFY — persist attachments subcollection (create + resubmit)
    submitSubmission.test.ts       # MODIFY — cover attachments persistence
    index.ts                       # MODIFY — export uploadFile as onCall
lib/
  schemas/
    submission.ts                  # MODIFY — mirror schemas.ts additions
    submission.test.ts             # MODIFY — cover new schema fields
firestore.rules                    # MODIFY — add attachments subcollection rule
tests/
  firestore-rules.test.ts          # MODIFY — cover attachments subcollection rule
components/
  file-upload/
    FileUpload.tsx                 # NEW — reusable file picker + upload component
app/(dashboard)/pengajuan/new/
  page.tsx                         # MODIFY — wire in attachments section + signature upload toggle + resubmit prefill
```

Each file keeps one job: `googleDrive.ts` only knows how to push bytes into Drive and make them link-shareable; `uploadFile.ts` only knows auth/validation/orchestration for a single file upload; `FileUpload.tsx` only knows how to pick-validate-upload-report one file at a time — the parent form owns the list state for attachments (same division of responsibility `items`/`SignaturePad` already use).

---

## Task 1: Google Drive upload helper (`googleDrive.ts`)

**Files:**
- Modify: `functions/package.json`
- Create: `functions/src/googleDrive.ts`
- Test: `functions/src/googleDrive.test.ts`

- [ ] **Step 1: Install the `googleapis` dependency**

Run: `npm --prefix functions install googleapis`
Expected: `functions/package.json` gets a new `"googleapis"` entry under `dependencies`, `functions/package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

```typescript
// functions/src/googleDrive.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const filesCreate = vi.fn();
const permissionsCreate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({})),
    },
    drive: vi.fn().mockImplementation(() => ({
      files: { create: filesCreate },
      permissions: { create: permissionsCreate },
    })),
  },
}));

describe("uploadToDrive", () => {
  beforeEach(() => {
    filesCreate.mockReset();
    permissionsCreate.mockReset();
    process.env.DRIVE_FOLDER_ID = "folder-123";
  });

  it("throws if DRIVE_FOLDER_ID is not configured", async () => {
    delete process.env.DRIVE_FOLDER_ID;
    const { uploadToDrive } = await import("./googleDrive");
    await expect(
      uploadToDrive({ fileName: "x.png", mimeType: "image/png", buffer: Buffer.from("x") })
    ).rejects.toThrow(/DRIVE_FOLDER_ID/);
  });

  it("uploads the file into the configured folder and sets anyone-reader permission", async () => {
    filesCreate.mockResolvedValue({
      data: { id: "file-abc", webViewLink: "https://drive.google.com/file/d/file-abc/view" },
    });
    permissionsCreate.mockResolvedValue({});

    const { uploadToDrive } = await import("./googleDrive");
    const result = await uploadToDrive({
      fileName: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from("hello"),
    });

    expect(result).toEqual({ fileId: "file-abc", webViewLink: "https://drive.google.com/file/d/file-abc/view" });
    expect(filesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { name: "test.png", parents: ["folder-123"] },
        fields: "id, webViewLink",
      })
    );
    expect(permissionsCreate).toHaveBeenCalledWith({
      fileId: "file-abc",
      requestBody: { type: "anyone", role: "reader" },
    });
  });

  it("throws if Drive does not return a file id/webViewLink", async () => {
    filesCreate.mockResolvedValue({ data: {} });
    const { uploadToDrive } = await import("./googleDrive");
    await expect(
      uploadToDrive({ fileName: "x.png", mimeType: "image/png", buffer: Buffer.from("x") })
    ).rejects.toThrow(/id\/webViewLink/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run functions/src/googleDrive.test.ts`
Expected: FAIL — `Cannot find module './googleDrive'`.

- [ ] **Step 4: Write `functions/src/googleDrive.ts`**

```typescript
import { google } from "googleapis";
import { Readable } from "stream";

export async function uploadToDrive(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ fileId: string; webViewLink: string }> {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("DRIVE_FOLDER_ID env var is not configured.");
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const createRes = await drive.files.create({
    requestBody: {
      name: params.fileName,
      parents: [folderId],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(params.buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = createRes.data.id;
  const webViewLink = createRes.data.webViewLink;
  if (!fileId || !webViewLink) {
    throw new Error("Drive did not return an id/webViewLink for the uploaded file.");
  }

  await drive.permissions.create({
    fileId,
    requestBody: { type: "anyone", role: "reader" },
  });

  return { fileId, webViewLink };
}
```

Note on the `drive` (not `drive.file`) OAuth scope: the target folder is shared *to* the service account by a human via Drive's sharing UI (Task 8) rather than created *by* the service account itself. The narrower `drive.file` scope only grants access to files/folders the app itself created or that were opened through a picker — it does not reliably cover a folder shared in after the fact. The broader `drive` scope avoids that ambiguity for this exact "upload into a pre-shared folder" case.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run functions/src/googleDrive.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Build and commit**

Run: `npm --prefix functions run build`

```bash
git add functions/src/googleDrive.ts functions/src/googleDrive.test.ts functions/package.json functions/package-lock.json
git commit -m "feat: add Google Drive upload helper"
```

---

## Task 2: Zod schema additions (`attachmentSchema`, `uploadFileSchema`, `attachments` field)

**Files:**
- Modify: `functions/src/schemas.ts`
- Modify: `lib/schemas/submission.ts`
- Modify: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/schemas/submission.test.ts`, inside the existing `describe("createSubmissionSchema", ...)` block (after the `"allows submissionId to be null..."` test, before its closing `});`):

```typescript
  it("accepts a payload with attachments and preserves them", () => {
    const payload = {
      ...validPayload,
      attachments: [{ fileUrl: "https://drive.google.com/file/d/abc/view", fileName: "nota.png", fileType: "image/png" }],
    };
    const result = createSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual(payload.attachments);
    }
  });

  it("defaults attachments to an empty array when omitted", () => {
    const result = createSubmissionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual([]);
    }
  });

  it("rejects an attachment with an invalid fileUrl", () => {
    const payload = {
      ...validPayload,
      attachments: [{ fileUrl: "not-a-url", fileName: "nota.png", fileType: "image/png" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(false);
  });
```

Also append a new top-level `describe` block at the end of the file (after the closing `});` of `describe("reviewSubmissionSchema", ...)`):

```typescript
describe("uploadFileSchema", () => {
  it("accepts a valid attachment upload payload", () => {
    const result = uploadFileSchema.safeParse({
      purpose: "attachment",
      fileName: "nota.png",
      fileType: "image/png",
      fileData: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown purpose", () => {
    const result = uploadFileSchema.safeParse({
      purpose: "avatar",
      fileName: "nota.png",
      fileType: "image/png",
      fileData: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty fileData", () => {
    const result = uploadFileSchema.safeParse({
      purpose: "signature",
      fileName: "ttd.png",
      fileType: "image/png",
      fileData: "",
    });
    expect(result.success).toBe(false);
  });
});
```

Update the import line at the top of the file to also bring in `uploadFileSchema`:

```typescript
import { createSubmissionSchema, reviewSubmissionSchema, uploadFileSchema } from "./submission";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL — `uploadFileSchema` is not exported from `./submission`; the three new `createSubmissionSchema` tests fail their assertions (attachments stripped/undefined, invalid attachment silently accepted since the unknown key is dropped before validation).

- [ ] **Step 3: Update `functions/src/schemas.ts`**

Replace the full file content with:

```typescript
import { z } from "zod";

export const subTypeByType = {
  kendaraan: ["service_berkala", "service_insidentil", "pengadaan_baru"] as const,
  perlengkapan: ["pengadaan_baru", "penggantian"] as const,
};

export const itemSchema = z.object({
  itemName: z.string().min(1),
  brandType: z.string().min(1),
  km: z.number().int().nonnegative().nullable(),
  quantity: z.number().int().positive(),
  unit: z.string().min(1),
  description: z.string(),
});

export const attachmentSchema = z.object({
  fileUrl: z.string().url(),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
});

export const createSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    type: z.enum(["kendaraan", "perlengkapan"]),
    subType: z.string(),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1),
    attachments: z.array(attachmentSchema).default([]),
  })
  .refine((data) => (subTypeByType[data.type] as readonly string[]).includes(data.subType), {
    message: "subType tidak valid untuk type ini",
    path: ["subType"],
  });

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const reviewSubmissionSchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    rejectionNote: z.string().nullish(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  });

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;

export const uploadFileSchema = z.object({
  purpose: z.enum(["attachment", "signature"]),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileData: z.string().min(1),
});

export type UploadFileInput = z.infer<typeof uploadFileSchema>;
```

- [ ] **Step 4: Update `lib/schemas/submission.ts`**

Replace the full file content with:

```typescript
import { z } from "zod";

export const submissionTypeSchema = z.enum(["kendaraan", "perlengkapan"]);

export const subTypeByType = {
  kendaraan: ["service_berkala", "service_insidentil", "pengadaan_baru"] as const,
  perlengkapan: ["pengadaan_baru", "penggantian"] as const,
};

export const itemSchema = z.object({
  itemName: z.string().min(1, "Nama item wajib diisi"),
  brandType: z.string().min(1, "Merk/tipe wajib diisi"),
  km: z.number().int().nonnegative().nullable(),
  quantity: z.number().int().positive(),
  unit: z.string().min(1, "Satuan wajib diisi"),
  description: z.string(),
});

export const attachmentSchema = z.object({
  fileUrl: z.string().url(),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
});

export const createSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    type: submissionTypeSchema,
    subType: z.string(),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1, "Minimal 1 item"),
    attachments: z.array(attachmentSchema).default([]),
  })
  .refine((data) => (subTypeByType[data.type] as readonly string[]).includes(data.subType), {
    message: "subType tidak valid untuk type ini",
    path: ["subType"],
  });

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const reviewSubmissionSchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    rejectionNote: z.string().nullish(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  });

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;

export const uploadFileSchema = z.object({
  purpose: z.enum(["attachment", "signature"]),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileData: z.string().min(1),
});

export type UploadFileInput = z.infer<typeof uploadFileSchema>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS — 16 tests passing (10 existing + 6 new).

- [ ] **Step 6: Build and commit**

Run: `npm run build && npm --prefix functions run build`

```bash
git add functions/src/schemas.ts lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add attachment and uploadFile Zod schemas"
```

---

## Task 3: `uploadFile` Cloud Function callable

**Files:**
- Create: `functions/src/uploadFile.ts`
- Test: `functions/src/uploadFile.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/uploadFile.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

// Point the Admin SDK (used internally by uploadFile.ts via ./admin) at the
// local Firestore emulator instead of production. Must be set before "./uploadFile"
// (and transitively "./admin") is ever imported, since getFirestore() reads this at init time.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-upload-test";

const fft = functionsTest({ projectId: "demo-pengajuan-upload-test" }, undefined);
let testEnv: RulesTestEnvironment;

const uploadToDriveMock = vi.fn();
vi.mock("./googleDrive", () => ({
  uploadToDrive: uploadToDriveMock,
}));

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

const VALID_PAYLOAD = {
  purpose: "attachment" as const,
  fileName: "nota.png",
  fileType: "image/png",
  fileData: "data:image/png;base64,aGVsbG8=",
};

describe("uploadFileHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-upload-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    uploadToDriveMock.mockReset();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not authenticated", async () => {
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: undefined })).rejects.toThrow(HttpsError);
  });

  it("rejects when caller role is not admin_cabang/snd", async () => {
    await seedUser("uid-spv", "spv");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-spv" } } as any)).rejects.toThrow(HttpsError);
  });

  it("rejects an unsupported file type for the given purpose", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(
      uploadFileHandler({ ...VALID_PAYLOAD, fileType: "application/zip" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(/tidak didukung/);
  });

  it("rejects a signature upload that isn't PNG", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(
      uploadFileHandler(
        { purpose: "signature", fileName: "ttd.jpg", fileType: "image/jpeg", fileData: "data:image/jpeg;base64,aGVsbG8=" },
        { auth: { uid: "uid-admin" } } as any
      )
    ).rejects.toThrow(/tidak didukung/);
  });

  it("rejects a file larger than the purpose's max size", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const bigBase64 = Buffer.alloc(11 * 1024 * 1024).toString("base64");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(
      uploadFileHandler(
        { purpose: "attachment", fileName: "big.png", fileType: "image/png", fileData: `data:image/png;base64,${bigBase64}` },
        { auth: { uid: "uid-admin" } } as any
      )
    ).rejects.toThrow(/maksimal/);
  });

  it("uploads a valid attachment and returns Drive metadata", async () => {
    await seedUser("uid-admin", "admin_cabang");
    uploadToDriveMock.mockResolvedValue({ fileId: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" });
    const { uploadFileHandler } = await import("./uploadFile");
    const result = await uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-admin" } } as any);
    expect(result).toEqual({ fileUrl: "https://drive.google.com/file/d/file-1/view", fileName: "nota.png", fileType: "image/png" });
    expect(uploadToDriveMock).toHaveBeenCalledWith({ fileName: "nota.png", mimeType: "image/png", buffer: expect.any(Buffer) });
  });

  it("surfaces a generic error if the Drive upload fails", async () => {
    await seedUser("uid-admin", "admin_cabang");
    uploadToDriveMock.mockRejectedValue(new Error("Drive quota exceeded"));
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-admin" } } as any)).rejects.toThrow(/Gagal upload file/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run functions/src/uploadFile.test.ts`
Expected: FAIL — `Cannot find module './uploadFile'`.

- [ ] **Step 3: Write `functions/src/uploadFile.ts`**

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

export async function uploadFileHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["admin_cabang", "snd"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya admin cabang atau SND yang bisa upload file.");
  }

  const parsed = uploadFileSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input = parsed.data;

  if (!ALLOWED_MIME_TYPES[input.purpose].includes(input.fileType)) {
    throw new HttpsError("invalid-argument", "Tipe file tidak didukung.");
  }

  const base64Payload = input.fileData.includes(",") ? input.fileData.split(",")[1] : input.fileData;
  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.byteLength > MAX_SIZE_BYTES[input.purpose]) {
    const maxMb = MAX_SIZE_BYTES[input.purpose] / (1024 * 1024);
    throw new HttpsError("invalid-argument", `Ukuran file maksimal ${maxMb}MB.`);
  }

  try {
    const { webViewLink } = await uploadToDrive({
      fileName: input.fileName,
      mimeType: input.fileType,
      buffer,
    });
    return { fileUrl: webViewLink, fileName: input.fileName, fileType: input.fileType };
  } catch (error) {
    console.error("uploadFile: Drive upload failed", error);
    throw new HttpsError("internal", "Gagal upload file, coba lagi.");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/uploadFile.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Wire up the callable export**

Replace `functions/src/index.ts` with:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { uploadFileHandler } from "./uploadFile";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const uploadFile = onCall((request) =>
  uploadFileHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
```

- [ ] **Step 6: Build and commit**

Run: `npm --prefix functions run build`

```bash
git add functions/src/uploadFile.ts functions/src/uploadFile.test.ts functions/src/index.ts
git commit -m "feat: add uploadFile callable (attachment + signature upload to Drive)"
```

---

## Task 4: Persist `attachments` in `submitSubmission`

**Files:**
- Modify: `functions/src/submitSubmission.ts`
- Modify: `functions/src/submitSubmission.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this test inside the existing `describe("submitSubmissionHandler (create)", ...)` block, right after the `"creates a new submission with generated number and statusHistory entry"` test (before the block's closing `});`):

```typescript
  it("writes attachments to the attachments subcollection when creating a new submission", async () => {
    await seedUser("uid-admin2", "admin_cabang", "WHO");
    const { submitSubmissionHandler } = await import("./submitSubmission");
    const result = await submitSubmissionHandler(
      {
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/y.png",
        items: validItems,
        attachments: [{ fileUrl: "https://drive.google.com/file/d/abc/view", fileName: "nota.png", fileType: "image/png" }],
      },
      { auth: { uid: "uid-admin2" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const attachments = await admin
      .collection("submissions")
      .doc(result.submissionId)
      .collection("attachments")
      .get();
    expect(attachments.docs).toHaveLength(1);
    expect(attachments.docs[0].data().fileName).toBe("nota.png");
  });
```

Add these two tests inside the existing `describe("submitSubmissionHandler (resubmit after revisi)", ...)` block, right after the `"resubmits, keeps the same submissionNumber, and replaces items"` test (before the block's closing `});`):

```typescript
  it("replaces attachments on resubmit", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-3");
    await subRef.set({
      submissionNumber: "003/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "Lampiran kurang jelas",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });
    await subRef.collection("attachments").doc("old-attachment").set({ fileUrl: "https://drive.google.com/file/d/old/view", fileName: "lama.png", fileType: "image/png" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await submitSubmissionHandler(
      {
        submissionId: "sub-3",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
        attachments: [{ fileUrl: "https://drive.google.com/file/d/new/view", fileName: "baru.png", fileType: "image/png" }],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    const attachments = await subRef.collection("attachments").get();
    expect(attachments.docs).toHaveLength(1);
    expect(attachments.docs[0].data().fileName).toBe("baru.png");
  });

  it("removes all attachments on resubmit when the payload has none", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-4");
    await subRef.set({
      submissionNumber: "004/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "Tidak perlu lampiran",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });
    await subRef.collection("attachments").doc("old-attachment").set({ fileUrl: "https://drive.google.com/file/d/old/view", fileName: "lama.png", fileType: "image/png" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await submitSubmissionHandler(
      {
        submissionId: "sub-4",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    const attachments = await subRef.collection("attachments").get();
    expect(attachments.docs).toHaveLength(0);
  });
```

Note: the first new test uses a fresh uid (`uid-admin2`) rather than reusing `uid-admin`, since `admin_cabang`/`WHO` already has submissions created by other tests in the same describe block, and reusing the same branch could shift the expected `submissionNumber` sequence — this test doesn't assert on `submissionNumber` so it's not strictly required, but keeps this test independent of ordering/counter state from its siblings.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run functions/src/submitSubmission.test.ts`
Expected: FAIL — `attachments` is `undefined` on the created/resubmitted docs (TypeScript will also flag `input.attachments` as possibly used before the schema recognizes it, but since Task 2 already added the schema field, the failure here is behavioral, not a compile error: the current handler never writes an `attachments` subcollection at all, so `attachments.docs` is empty in all three new tests).

- [ ] **Step 3: Update `functions/src/submitSubmission.ts`**

Replace the full file content with:

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { createSubmissionSchema, CreateSubmissionInput } from "./schemas";
import { getNextSubmissionNumber } from "./counters";

interface CallerContext {
  auth?: { uid: string };
}

export async function submitSubmissionHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["admin_cabang", "snd"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya admin cabang atau SND yang bisa mengajukan.");
  }

  const parsed = createSubmissionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateSubmissionInput = parsed.data;

  if (input.submissionId) {
    return resubmitAfterRevisi(input, context.auth.uid, caller);
  }

  return createNewSubmission(input, context.auth.uid, caller);
}

async function createNewSubmission(
  input: CreateSubmissionInput,
  uid: string,
  caller: FirebaseFirestore.DocumentData
) {
  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, caller.branch, now.getFullYear(), now.getMonth() + 1);

  const submissionRef = db.collection("submissions").doc();
  const batch = db.batch();

  batch.set(submissionRef, {
    submissionNumber,
    type: input.type,
    subType: input.subType,
    status: "diajukan",
    requesterId: uid,
    requesterSignatureUrl: input.requesterSignatureUrl,
    approverId: null,
    approverRole: null,
    branch: caller.branch,
    department: caller.department,
    position: caller.position,
    rejectionNote: null,
    submittedAt: FieldValue.serverTimestamp(),
    reviewedAt: null,
    approvedAt: null,
  });

  input.items.forEach((item) => {
    const itemRef = submissionRef.collection("items").doc();
    batch.set(itemRef, item);
  });

  input.attachments.forEach((attachment) => {
    const attachmentRef = submissionRef.collection("attachments").doc();
    batch.set(attachmentRef, { ...attachment, uploadedAt: FieldValue.serverTimestamp() });
  });

  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "diajukan",
    note: null,
    actorId: uid,
    actorRole: caller.role,
    timestamp: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { submissionId: submissionRef.id, submissionNumber, status: "diajukan" as const };
}

async function resubmitAfterRevisi(
  input: CreateSubmissionInput,
  uid: string,
  caller: FirebaseFirestore.DocumentData
) {
  const submissionRef = db.collection("submissions").doc(input.submissionId!);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission || submission.requesterId !== uid) {
    throw new HttpsError("permission-denied", "Pengajuan tidak ditemukan atau bukan milik Anda.");
  }
  if (submission.status !== "perlu_revisi") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus perlu_revisi yang bisa direvisi.");
  }

  const existingItems = await submissionRef.collection("items").get();
  const existingAttachments = await submissionRef.collection("attachments").get();
  const batch = db.batch();
  existingItems.forEach((doc) => batch.delete(doc.ref));
  existingAttachments.forEach((doc) => batch.delete(doc.ref));
  input.items.forEach((item) => {
    const itemRef = submissionRef.collection("items").doc();
    batch.set(itemRef, item);
  });
  input.attachments.forEach((attachment) => {
    const attachmentRef = submissionRef.collection("attachments").doc();
    batch.set(attachmentRef, { ...attachment, uploadedAt: FieldValue.serverTimestamp() });
  });

  batch.update(submissionRef, {
    type: input.type,
    subType: input.subType,
    requesterSignatureUrl: input.requesterSignatureUrl,
    status: "diajukan",
    rejectionNote: null,
  });

  const historyRef = submissionRef.collection("statusHistory").doc();
  batch.set(historyRef, {
    status: "diajukan",
    note: "Diajukan ulang setelah revisi",
    actorId: uid,
    actorRole: caller.role,
    timestamp: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { submissionId: submissionRef.id, submissionNumber: submission.submissionNumber as string, status: "diajukan" as const };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run functions/src/submitSubmission.test.ts`
Expected: PASS — 8 tests passing (5 existing + 3 new).

- [ ] **Step 5: Build and commit**

Run: `npm --prefix functions run build`

```bash
git add functions/src/submitSubmission.ts functions/src/submitSubmission.test.ts
git commit -m "feat: persist attachments subcollection in submitSubmission"
```

---

## Task 5: Firestore rules for `attachments` subcollection

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/firestore-rules.test.ts`, add an attachment doc to the seed data inside `beforeEach`'s `withSecurityRulesDisabled` block, right after the existing `items` seed:

```typescript
      await db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").set({
        fileUrl: "https://drive.google.com/file/d/abc/view",
        fileName: "nota.png",
        fileType: "image/png",
      });
```

Add a new `describe` block at the end of the file, right before the final closing `});` of the outer `describe("firestore.rules", ...)`:

```typescript
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

    it("denies direct client write to an attachment", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").update({ fileName: "hacked.png" })
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/firestore-rules.test.ts`
Expected: FAIL — the two "allows" tests fail because `firestore.rules` has no `match /attachments/{attachmentId}` block yet, so reads fall through to implicit deny.

- [ ] **Step 3: Update `firestore.rules`**

Replace the full file content with:

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

    match /users/{uid} {
      allow read: if isSignedIn() && (request.auth.uid == uid || userRole() in ['spv', 'management', 'superadmin']);
      allow write: if false;
    }

    match /submissions/{submissionId} {
      allow create: if isSignedIn()
        && userRole() in ['admin_cabang', 'snd']
        && request.resource.data.requesterId == request.auth.uid
        && request.resource.data.status == 'diajukan';
      allow read: if isSignedIn() && (resource.data.requesterId == request.auth.uid || isReviewer());
      allow update, delete: if false;

      match /items/{itemId} {
        allow read: if isSignedIn() &&
          (get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid || isReviewer());
        allow write: if false;
      }

      match /statusHistory/{historyId} {
        allow read: if isSignedIn() &&
          (get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid || isReviewer());
        allow write: if false;
      }

      match /attachments/{attachmentId} {
        allow read: if isSignedIn() &&
          (get(/databases/$(database)/documents/submissions/$(submissionId)).data.requesterId == request.auth.uid || isReviewer());
        allow write: if false;
      }
    }

    match /counters/{counterId} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/firestore-rules.test.ts`
Expected: PASS — 23 tests passing (19 existing + 4 new).

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `npm test && npm --prefix functions run test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: add Firestore rules for attachments subcollection"
```

---

## Task 6: `FileUpload` client component

**Files:**
- Create: `components/file-upload/FileUpload.tsx`

No automated test for this task (pure client UI component calling a live Cloud Function — consistent with how `SignaturePad`, Fase 1's other file-adjacent component, was verified manually rather than unit tested). Step 3 below is a manual smoke test.

- [ ] **Step 1: Write `components/file-upload/FileUpload.tsx`**

```typescript
"use client";

import { useState } from "react";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";

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

export type UploadedFile = { fileUrl: string; fileName: string; fileType: string };

const PURPOSE_CONFIG = {
  attachment: {
    acceptedTypes: ["image/jpeg", "image/png", "application/pdf"],
    maxSizeBytes: 10 * 1024 * 1024,
    maxSizeLabel: "10MB",
    accept: "image/jpeg,image/png,application/pdf",
  },
  signature: {
    acceptedTypes: ["image/png"],
    maxSizeBytes: 2 * 1024 * 1024,
    maxSizeLabel: "2MB",
    accept: "image/png",
  },
} as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

export function FileUpload({
  purpose,
  onUploaded,
}: {
  purpose: "attachment" | "signature";
  onUploaded: (file: UploadedFile) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = PURPOSE_CONFIG[purpose];

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (!config.acceptedTypes.includes(file.type)) {
      setError("Tipe file tidak didukung.");
      return;
    }
    if (file.size > config.maxSizeBytes) {
      setError(`Ukuran file maksimal ${config.maxSizeLabel}.`);
      return;
    }

    setUploading(true);
    try {
      const fileData = await readFileAsDataUrl(file);
      const uploadFile = httpsCallable(functions, "uploadFile");
      const result = await uploadFile({ purpose, fileName: file.name, fileType: file.type, fileData });
      onUploaded(result.data as UploadedFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal upload file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <input
        type="file"
        accept={config.accept}
        disabled={uploading}
        onChange={handleFileChange}
        className="block w-full text-sm"
      />
      {uploading && <p className="text-sm text-muted-foreground">Mengupload...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds (the component isn't imported anywhere yet, so this only confirms it type-checks in isolation).

- [ ] **Step 3: Manual smoke test**

Temporarily render `<FileUpload purpose="attachment" onUploaded={console.log} />` on `app/(dashboard)/pengajuan/page.tsx` (top of the returned JSX, inside `<main>`). Run `npm run dev`, pick a small PNG. Since the `uploadFile` Cloud Function is deployed but Google Drive isn't configured yet (that's Task 8), the upload is expected to fail — confirm the failure surfaces as a visible red error message (not a silent no-op or an unhandled exception in the console), which validates the component's error path end-to-end even before Drive itself is wired up. Revert the temporary change to `pengajuan/page.tsx` after confirming.

- [ ] **Step 4: Commit**

```bash
git add components/file-upload/FileUpload.tsx
git commit -m "feat: add FileUpload component"
```

---

## Task 7: Wire attachments + signature upload into "Buat Pengajuan"

**Files:**
- Modify: `app/(dashboard)/pengajuan/new/page.tsx`

- [ ] **Step 1: Replace the full file content**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { firebaseApp, db } from "@/lib/firebase/client";
import { createSubmissionSchema, CreateSubmissionInput, subTypeByType } from "@/lib/schemas/submission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function NewPengajuanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resubmitId = searchParams.get("resubmit") ?? undefined;
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoadingResubmit, setIsLoadingResubmit] = useState(!!resubmitId);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [signatureMode, setSignatureMode] = useState<"gambar" | "upload">("gambar");

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateSubmissionInput>({
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

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment,
  } = useFieldArray({ control, name: "attachments" });
  const selectedType = watch("type");
  const typeField = register("type");

  // When the user changes "Jenis Pengajuan" via the dropdown, default subType
  // to the first valid option for the new type. This is wired as an onChange
  // handler (rather than a useEffect on the watched value) specifically so it
  // only fires on user interaction — a useEffect keyed on `selectedType` would
  // also fire right after `reset()` populates the resubmit data below, and
  // clobber the freshly-loaded subType with the default.
  function handleTypeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    typeField.onChange(event);
    const nextType = event.target.value as CreateSubmissionInput["type"];
    setValue("subType", subTypeByType[nextType][0]);
  }

  function handleSignatureModeChange(mode: "gambar" | "upload") {
    setSignatureMode(mode);
    setValue("requesterSignatureUrl", "");
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
            fileUrl: data.fileUrl ?? "",
            fileName: data.fileName ?? "",
            fileType: data.fileType ?? "",
          };
        });

        if (cancelled) return;

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
  }, [resubmitId, reset]);

  async function onSubmit(data: CreateSubmissionInput) {
    setServerError(null);
    try {
      const submitSubmission = httpsCallable(functions, "submitSubmission");
      const result = await submitSubmission(data);
      router.push(`/pengajuan/${(result.data as { submissionId: string }).submissionId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    }
  }

  if (isLoadingResubmit) {
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        Memuat data pengajuan...
      </main>
    );
  }

  if (resubmitError) {
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-red-600">{resubmitError}</main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Buat Pengajuan</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-1">
          <Label htmlFor="type">Jenis Pengajuan</Label>
          <select id="type" {...typeField} onChange={handleTypeChange} className="w-full rounded border p-2">
            <option value="kendaraan">Kendaraan</option>
            <option value="perlengkapan">Perlengkapan</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="subType">Sub Jenis</Label>
          <select id="subType" {...register("subType")} className="w-full rounded border p-2">
            {subTypeByType[selectedType].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          {errors.subType && <p className="text-sm text-red-600">{errors.subType.message}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Item</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" })
              }
            >
              Tambah Item
            </Button>
          </div>
          {fields.map((field, index) => {
            const itemErrors = errors.items?.[index];
            return (
              <div key={field.id} className="grid grid-cols-2 gap-2 rounded border p-3">
                <div className="space-y-1">
                  <Input placeholder="Nama item" {...register(`items.${index}.itemName`)} />
                  {itemErrors?.itemName && (
                    <p className="text-sm text-red-600">{itemErrors.itemName.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input placeholder="Merk/Tipe" {...register(`items.${index}.brandType`)} />
                  {itemErrors?.brandType && (
                    <p className="text-sm text-red-600">{itemErrors.brandType.message}</p>
                  )}
                </div>
                {selectedType === "kendaraan" && (
                  <div className="space-y-1">
                    <Input
                      type="number"
                      placeholder="KM"
                      {...register(`items.${index}.km`, {
                        setValueAs: (v) => (v === "" ? null : Number(v)),
                      })}
                    />
                    {itemErrors?.km && <p className="text-sm text-red-600">{itemErrors.km.message}</p>}
                  </div>
                )}
                <div className="space-y-1">
                  <Input
                    type="number"
                    placeholder="Jumlah"
                    {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                  />
                  {itemErrors?.quantity && (
                    <p className="text-sm text-red-600">{itemErrors.quantity.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input placeholder="Satuan" {...register(`items.${index}.unit`)} />
                  {itemErrors?.unit && <p className="text-sm text-red-600">{itemErrors.unit.message}</p>}
                </div>
                <Textarea placeholder="Deskripsi" {...register(`items.${index}.description`)} />
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    Hapus
                  </Button>
                )}
              </div>
            );
          })}
          {errors.items && !Array.isArray(errors.items) && (
            <p className="text-sm text-red-600">{errors.items.message as string}</p>
          )}
        </div>

        <div className="space-y-3">
          <Label>Lampiran (opsional)</Label>
          {attachmentFields.map((field, index) => (
            <div key={field.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>{field.fileName}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachment(index)}>
                Hapus
              </Button>
            </div>
          ))}
          <FileUpload purpose="attachment" onUploaded={(file) => appendAttachment(file)} />
        </div>

        <div className="space-y-2">
          <Label>Tanda Tangan</Label>
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
            <FileUpload
              purpose="signature"
              onUploaded={(file) => setValue("requesterSignatureUrl", file.fileUrl)}
            />
          )}
          {errors.requesterSignatureUrl && <p className="text-sm text-red-600">Tanda tangan wajib diisi.</p>}
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds, `/pengajuan/new` route compiles with no type errors (in particular, `attachmentFields.map((field) => field.fileName)` must type-check against `CreateSubmissionInput["attachments"]`, which Task 2 already defined).

- [ ] **Step 3: Manual verification (without real Drive access yet)**

With Auth+Firestore+Functions emulators running and seed data loaded (`npm run seed`), log in as `admin.who@example.com`, visit `/pengajuan/new`:
- Confirm the "Lampiran (opsional)" section renders below Item, with a file picker.
- Confirm picking an oversized or wrong-type file shows a red error message immediately (client-side check, no network call needed — this part works without Drive configured).
- Confirm picking a valid-looking file attempts an upload (shows "Mengupload...") and then shows a red error (since Drive isn't configured until Task 8) — this confirms the whole wiring up to the `uploadFile` call is correct; only the actual Drive round-trip is unverified until Task 8.
- Confirm the "Gambar" / "Upload File" toggle above the signature area switches between `SignaturePad` and `FileUpload` correctly, and that switching modes clears any previously set `requesterSignatureUrl` (submit should still correctly require a fresh signature in whichever mode is active).
- Log in as `admin.who@example.com` on a submission you've had rejected (`perlu_revisi`) with an attachment attached at creation time (only possible to test the "attachment carries over" part once Task 8's real Drive is wired up — note this limitation and defer full confirmation to Task 8's E2E walkthrough).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/pengajuan/new/page.tsx"
git commit -m "feat: wire attachments and signature upload into Buat Pengajuan form"
```

---

## Task 8: Google Cloud / Drive manual setup + full E2E walkthrough

**Files:** none (configuration + verification only)

This task requires actions in the Google Cloud Console / Google Drive UI that cannot be scripted from this repo — they need to be done by whoever has access to the `sndsupport.tsi@gmail.com` Google account and this project's Google Cloud project.

- [ ] **Step 1: Enable the Google Drive API**

In Google Cloud Console, select the same GCP project backing this Firebase project. Go to "APIs & Services" → "Library", search "Google Drive API", click "Enable".

- [ ] **Step 2: Identify the Cloud Functions runtime service account**

In Google Cloud Console → "IAM & Admin" → "Service Accounts", find the account Cloud Functions (2nd gen) uses at runtime for this project — typically `<project-id>@appspot.gserviceaccount.com` (the App Engine default service account) unless a custom runtime service account was configured. Note its email address.

- [ ] **Step 3: Create the shared Drive folder**

Log into Google Drive as `sndsupport.tsi@gmail.com`. Create a new folder, e.g. "Lampiran Pengajuan". Right-click → "Share" → add the service account email from Step 2 as **Editor**. Open the folder and copy its ID from the URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`).

- [ ] **Step 4: Confirm `functions/.env*` is gitignored**

Cloud Functions v2 (which this project already uses — `firebase-functions@^5.0.0`) auto-loads environment variables from `functions/.env` (all environments/emulator) and `functions/.env.<firebase-project-id>` (that specific deploy target only) at both `firebase emulators:start` and `firebase deploy` time — no `firebase functions:config:set` step needed, that's the legacy Gen 1 mechanism. Open `.gitignore` at the repo root and confirm it has a line matching `functions/.env*` (or add one if missing, right next to the existing `/functions/lib` and `/functions/node_modules` entries) — these files will hold a filesystem path to a credentials key file in Step 5, so they must never be committed.

- [ ] **Step 5: Configure `DRIVE_FOLDER_ID` and local development credentials**

Since there is no Drive emulator, local testing of `uploadFile` against real Drive requires real credentials:
1. In Google Cloud Console → "IAM & Admin" → "Service Accounts", select the same service account from Step 2 (or create a separate dev-only one, also shared to the folder from Step 3 as Editor).
2. Create a new JSON key for it, download it.
3. Save it outside the repo (e.g. `C:\Users\beben\.config\gcloud\pengajuan-drive-dev-key.json`) — **never inside the project directory**, to avoid any risk of accidental commit.
4. Create `functions/.env` (gitignored per Step 4) with:
   ```
   DRIVE_FOLDER_ID=<FOLDER_ID from Step 3>
   GOOGLE_APPLICATION_CREDENTIALS=C:\Users\beben\.config\gcloud\pengajuan-drive-dev-key.json
   ```
5. For an actual deployment later (out of scope for this local-emulator-focused plan), create `functions/.env.<firebase-project-id>` with the same `DRIVE_FOLDER_ID` — omit `GOOGLE_APPLICATION_CREDENTIALS` there, since deployed Cloud Functions use the runtime service account's identity automatically (Step 2), not a downloaded key file.
6. Restart the Functions emulator so it picks up the new `functions/.env` file:
   ```bash
   npx firebase emulators:start --only auth,firestore,functions --project pengajuan-kendaraan-perlengkapan
   ```

- [ ] **Step 6: Full manual E2E walkthrough**

With the emulators running per Step 5 (real Drive credentials wired in) and `npm run dev` + `npm run seed`:

1. Log in as `admin.who@example.com` → `/pengajuan/new`.
2. Upload one attachment (a real small PNG or PDF under 10MB) → confirm it shows "Mengupload..." then appears in the attachment list with its filename, no error.
3. Switch signature mode to "Upload File", upload a PNG under 2MB → confirm no error.
4. Switch back to "Gambar", draw a signature instead (confirm the toggle correctly re-clears `requesterSignatureUrl` so the drawn signature is what actually gets submitted).
5. Fill the rest of the form, submit.
6. Open the Google Drive folder from Step 3 in a browser — confirm the uploaded attachment file is actually there.
7. In the Firebase Emulator UI (`http://localhost:4000/firestore`), confirm the new submission's `attachments` subcollection has one document with the correct `fileUrl`/`fileName`/`fileType`/`uploadedAt`.
8. Log in as `spv@example.com` → `/persetujuan` → reject this submission with a note.
9. Log back in as `admin.who@example.com` → open the submission → confirm the revisi banner → click "Revisi & Ajukan Ulang".
10. Confirm the attachment from step 2 appears pre-filled in the "Lampiran" list on the resubmit form.
11. Remove that old attachment, upload a new one, sign again, resubmit.
12. Confirm in the Emulator UI that the `attachments` subcollection now has exactly one document — the new one, not the old one.

Expected: every step completes with no console/emulator errors, the file genuinely lands in Google Drive (confirmed by browsing the folder directly, not just trusting the app's UI), and Firestore state matches what's described at each step.

- [ ] **Step 7: Run the full automated test suite one more time**

Run: `npm test && npm --prefix functions run test`
Expected: all tests pass (automated tests don't depend on real Drive credentials — `googleDrive.ts` and `uploadFile.ts` tests mock the Drive client, so this suite stays green regardless of Step 1-5's manual setup state).

- [ ] **Step 8: Commit** (only if Step 6 surfaced code fixes)

```bash
git add -A
git commit -m "fix: address issues found in attachments/signature-upload E2E walkthrough"
```

If no fixes were needed, skip this commit.
