# Client-Side Google Drive Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloud-Function-mediated file upload (`uploadFile` callable) with a client-side Google Drive upload using OAuth (Google Identity Services), per `docs/superpowers/specs/2026-08-28-client-side-drive-upload-design.md`. This is sub-project 1 of 5 in the Spark-plan architecture migration.

**Architecture:** A new `lib/drive-upload.ts` module handles OAuth token acquisition (Google Identity Services) and direct browser-to-Drive-API uploads (multipart/related request). `components/file-upload/FileUpload.tsx` is rewired to call this module instead of the `uploadFile` Cloud Function callable, with its external interface (`purpose`, `onUploaded`, `UploadedFile` type) unchanged, so no caller needs to change. The now-fully-dead `uploadFile` Cloud Function is removed.

**Tech Stack:** TypeScript, Vitest, Google Identity Services (`accounts.google.com/gsi/client`), Google Drive API v3 (REST, direct `fetch`), Next.js client components.

**Environment note:** `getDriveAccessToken`/`uploadToDriveClient` need a real browser (`window`, a real Google OAuth consent flow) and cannot be tested on this machine — write them, verify via `npm run build` (type-check) only. `buildMultipartRequestBody` has no such dependency (uses only the `Blob` API, available in Node) — write it via TDD and actually run its tests.

---

## File Structure

```
/lib
  drive-upload.ts          # new — getDriveAccessToken, buildMultipartRequestBody, uploadToDriveClient
  drive-upload.test.ts       # new — tests buildMultipartRequestBody only
/components
  /file-upload
    FileUpload.tsx              # modify — call uploadToDriveClient instead of the uploadFile callable
/functions
  /src
    uploadFile.ts                  # delete — fully dead once FileUpload.tsx stops calling it
    uploadFile.test.ts              # delete
    index.ts                        # modify — remove uploadFile import/export
.env.local.example                   # modify — add NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID, NEXT_PUBLIC_DRIVE_FOLDER_ID
```

---

## Task 1: `lib/drive-upload.ts` — OAuth token + client-side Drive upload

**Files:**
- Create: `lib/drive-upload.ts`
- Test: `lib/drive-upload.test.ts`

`buildMultipartRequestBody` is fully runnable here (pure-ish, uses only the `Blob` API). `getDriveAccessToken`/`uploadToDriveClient` need a real browser and cannot be tested on this machine — write them, verify only via `npm run build`.

- [ ] **Step 1: Write the failing test for `buildMultipartRequestBody`**

```typescript
// lib/drive-upload.test.ts
import { describe, it, expect } from "vitest";
import { buildMultipartRequestBody } from "./drive-upload";

describe("buildMultipartRequestBody", () => {
  it("includes the metadata as a JSON part", async () => {
    const fileBlob = new Blob(["hello"], { type: "text/plain" });
    const body = buildMultipartRequestBody(
      { name: "test.txt", parents: ["folder-1"] },
      fileBlob,
      "text/plain",
      "test-boundary"
    );
    const text = await body.text();
    expect(text).toContain("--test-boundary");
    expect(text).toContain("Content-Type: application/json; charset=UTF-8");
    expect(text).toContain('{"name":"test.txt","parents":["folder-1"]}');
  });

  it("includes the file content with its content type", async () => {
    const fileBlob = new Blob(["hello world"], { type: "image/png" });
    const body = buildMultipartRequestBody({ name: "sig.png" }, fileBlob, "image/png", "test-boundary");
    const text = await body.text();
    expect(text).toContain("Content-Type: image/png");
    expect(text).toContain("hello world");
  });

  it("closes with the boundary terminator", async () => {
    const fileBlob = new Blob(["x"], { type: "text/plain" });
    const body = buildMultipartRequestBody({ name: "x.txt" }, fileBlob, "text/plain", "test-boundary");
    const text = await body.text();
    expect(text.endsWith("--test-boundary--")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/drive-upload.test.ts` from repo root (`c:\Users\TSI-GA_04\pengajuan`).
Expected: FAIL — `Cannot find module './drive-upload'`.

- [ ] **Step 3: Write `lib/drive-upload.ts`**

```typescript
const SYNTHETIC_BOUNDARY = "pengajuan_drive_upload_boundary";

let cachedToken: { value: string; expiresAt: number } | null = null;
let gisLoadPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void;
          }) => { requestAccessToken: (overrideConfig?: { prompt?: string }) => void };
        };
      };
    };
  }
}

function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Identity Services hanya bisa dimuat di browser."));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) {
    return gisLoadPromise;
  }
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat Google Identity Services."));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

async function requestNewAccessToken(): Promise<string> {
  await loadGoogleIdentityServices();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID belum dikonfigurasi.");
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Gagal mendapatkan akses Google Drive."));
          return;
        }
        const expiresInMs = (response.expires_in ?? 3600) * 1000;
        cachedToken = { value: response.access_token, expiresAt: Date.now() + expiresInMs - 60_000 };
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

export async function getDriveAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  return requestNewAccessToken();
}

export function buildMultipartRequestBody(
  metadata: Record<string, unknown>,
  fileBlob: Blob,
  fileType: string,
  boundary: string = SYNTHETIC_BOUNDARY
): Blob {
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeaderPart = `--${boundary}\r\nContent-Type: ${fileType}\r\n\r\n`;
  const closingPart = `\r\n--${boundary}--`;
  return new Blob([metadataPart, fileHeaderPart, fileBlob, closingPart]);
}

export type DriveUploadResult = { fileId: string; fileUrl: string };

export async function uploadToDriveClient(
  file: File,
  purpose: "attachment" | "signature"
): Promise<DriveUploadResult> {
  const folderId = process.env.NEXT_PUBLIC_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("NEXT_PUBLIC_DRIVE_FOLDER_ID belum dikonfigurasi.");
  }

  const accessToken = await getDriveAccessToken();
  const body = buildMultipartRequestBody({ name: file.name, parents: [folderId] }, file, file.type);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${SYNTHETIC_BOUNDARY}`,
      },
      body,
    }
  );
  if (!uploadRes.ok) {
    throw new Error(`Gagal upload ke Google Drive (${uploadRes.status}).`);
  }
  const uploaded = (await uploadRes.json()) as { id: string; webViewLink: string };

  const permissionRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  });
  if (!permissionRes.ok) {
    throw new Error(`Gagal mengatur izin akses file di Google Drive (${permissionRes.status}).`);
  }

  const fileUrl =
    purpose === "signature" ? `https://drive.google.com/uc?export=view&id=${uploaded.id}` : uploaded.webViewLink;

  return { fileId: uploaded.id, fileUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/drive-upload.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Verify the whole project still type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors. (This confirms the browser-only parts — `getDriveAccessToken`, `uploadToDriveClient`, the `Window.google` global augmentation — at least type-check correctly, even though they can't be exercised at runtime here.)

- [ ] **Step 6: Commit**

```bash
git add lib/drive-upload.ts lib/drive-upload.test.ts
git commit -m "feat: add client-side Google Drive upload module"
```

---

## Task 2: `.env.local.example` — new config keys

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Add the two new variables**

Add these two lines at the end of `.env.local.example` (leave every existing line unchanged):

```
NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
NEXT_PUBLIC_DRIVE_FOLDER_ID=your-shared-drive-folder-id
```

- [ ] **Step 2: Commit**

```bash
git add .env.local.example
git commit -m "chore: document Google Drive OAuth env vars in .env.local.example"
```

---

## Task 3: Rewire `FileUpload.tsx` to use client-side Drive upload

**Files:**
- Modify: `components/file-upload/FileUpload.tsx`

- [ ] **Step 1: Replace the full contents of `components/file-upload/FileUpload.tsx`**

```typescript
"use client";

import { useState } from "react";
import { uploadToDriveClient } from "@/lib/drive-upload";

export type UploadedFile = { fileId: string; fileUrl: string; fileName: string; fileType: string };

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

    if (!(config.acceptedTypes as readonly string[]).includes(file.type)) {
      setError("Tipe file tidak didukung.");
      return;
    }
    if (file.size > config.maxSizeBytes) {
      setError(`Ukuran file maksimal ${config.maxSizeLabel}.`);
      return;
    }

    setUploading(true);
    try {
      const { fileId, fileUrl } = await uploadToDriveClient(file, purpose);
      onUploaded({ fileId, fileUrl, fileName: file.name, fileType: file.type });
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

Note what changed vs the current file: removed the `firebase/functions` imports, the module-level `getFunctions`/`connectFunctionsEmulator` emulator-bootstrap block, and the `readFileAsDataUrl` helper (no longer needed — the raw `File` is passed straight to `uploadToDriveClient` instead of being base64-encoded for a callable payload). `PURPOSE_CONFIG`, the component's props/exports (`UploadedFile`, `FileUpload`), and the validation logic are unchanged, so `app/(dashboard)/pengajuan/new/page.tsx` and `app/(dashboard)/persetujuan/page.tsx` (both of which use this component) need no changes.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if it fails at the prerender stage with a missing-Firebase-config error, rerun, then delete `.env.local` again afterward and confirm `git status` shows it untracked).
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/file-upload/FileUpload.tsx
git commit -m "feat: upload attachments/signatures directly to Google Drive from the client"
```

---

## Task 4: Remove the now-dead `uploadFile` Cloud Function

**Files:**
- Delete: `functions/src/uploadFile.ts`
- Delete: `functions/src/uploadFile.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Delete the two files**

```bash
git rm functions/src/uploadFile.ts functions/src/uploadFile.test.ts
```

- [ ] **Step 2: Remove the `uploadFile` import and export from `functions/src/index.ts`**

Replace the full contents of `functions/src/index.ts`:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";
import { confirmSentToGaHandler } from "./confirmSentToGa";
import { markAsDoneHandler } from "./markAsDone";
import { shouldGeneratePdf, generateSubmissionPdfHandler } from "./generateSubmissionPdf";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const createUser = onCall((request) =>
  createUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const updateUser = onCall((request) =>
  updateUserHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const resetUserPassword = onCall((request) =>
  resetUserPasswordHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const confirmSentToGa = onCall((request) =>
  confirmSentToGaHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const markAsDone = onCall((request) =>
  markAsDoneHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
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

Do NOT remove `uploadFileSchema`/`UploadFileInput` from `functions/src/schemas.ts` or `lib/schemas/submission.ts` in this task — leave both as-is. Removing them would break the intentional byte-for-byte-duplicate convention between the two files if only one side is cleaned up, and a broader schema sweep belongs to the later "Bersih-bersih" sub-project, not this one.

- [ ] **Step 2: Verify the functions project still type-checks**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors, and `functions/lib/uploadFile.js` no longer gets (re)generated (the compiled output for a deleted source file may still exist on disk from a previous build — that's fine, it's gitignored and not part of what's checked here).

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "chore: remove dead uploadFile callable now that uploads go directly to Drive"
```

---

## Task 5: Manual end-to-end verification (needs a real browser + real Google account — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Fill in the new env vars**

In `.env.local`, set `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` to the OAuth Client ID created for this project (`961820440687-12vpd7s5hnbl1c0lp7ohm8vftvm40ju1.apps.googleusercontent.com`), and `NEXT_PUBLIC_DRIVE_FOLDER_ID` to the shared Drive folder's ID.

- [ ] **Step 2: Run the app and try an upload**

`npm run dev`, log in as an `admin_cabang`/`snd` user, go to Buat Pengajuan, switch the signature mode to "Upload File" (or add an attachment). Expected: choosing a file triggers a Google consent popup (first time only) asking to allow access to Google Drive; after allowing, the file uploads and the form shows it was added successfully. Check the shared Drive folder — the file should appear there, owned by the account that just logged into Google, with "Anyone with the link" view access.

- [ ] **Step 3: Verify the approver path too**

As an `spv`/`management` user, open Antrian Persetujuan, try both "Gambar" (unchanged — no Drive involved) and "Upload File" signature modes. Expected: same consent-then-upload behavior as Step 2.

---

## Self-Review Notes

- Spec coverage: OAuth token flow with `drive.file` scope and 60-second-early-expiry caching (Task 1), multipart/related upload + public-permission step (Task 1), `NEXT_PUBLIC_` env vars documented (Task 2), `FileUpload.tsx`'s external interface unchanged so callers need no changes (Task 3, and confirmed no other file was touched), `uploadFile` Cloud Function fully removed (Task 4), `functions/src/googleDrive.ts` and the two Cloud Functions still depending on it (`generateSubmissionPdf.ts`, `submitSubmission.ts`) deliberately left untouched (correctly out of scope, per the spec's explicit "di luar scope" list) — all covered.
- Type consistency: `uploadToDriveClient(file, purpose)`'s return type `DriveUploadResult` (`{fileId, fileUrl}`) matches exactly how Task 3's `FileUpload.tsx` destructures it. `buildMultipartRequestBody`'s signature (`metadata, fileBlob, fileType, boundary?`) matches between Task 1's implementation and its own test calls.
