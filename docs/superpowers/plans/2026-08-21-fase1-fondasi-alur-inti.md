# Fase 1: Fondasi + Alur Inti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation and core submission→approval flow (Next.js + Firebase) for the Aplikasi Pengajuan Kendaraan & Perlengkapan, per `docs/superpowers/specs/2026-08-21-fase1-fondasi-alur-inti-design.md`.

**Architecture:** Next.js 14 App Router (TypeScript, Tailwind, shadcn/ui) at repo root talks to Firebase Auth/Firestore directly for reads, but ALL writes to `submissions`, `items`, `statusHistory`, and `counters` go exclusively through two Cloud Functions callables (`submitSubmission`, `reviewSubmission`) running on the Admin SDK — Firestore rules deny direct client writes to those collections. Role comes from `users/{uid}.role`, checked server-side in every callable (fail-fast) and client-side for route/UI gating.

**Tech Stack:** Next.js 14, TypeScript (strict), Tailwind CSS, shadcn/ui, React Hook Form, Zod, Firebase (Auth, Firestore, Functions, Emulator Suite), firebase-admin, firebase-functions v2, signature_pad, Vitest, @firebase/rules-unit-testing, firebase-functions-test.

**Explicit decision (resolves an ambiguity in the design spec):** the spec's rules section says items/statusHistory "follow the parent submission's rule." This plan implements that as: **read** visibility follows the parent submission (owner or spv/management/superadmin), **write** is always denied for clients — items, statusHistory, and counters are written only by the two Cloud Functions via the Admin SDK (which bypasses rules). The `submissions` create rule is still implemented as specced (role + `requesterId` match) for defense-in-depth, even though the real Fase 1 path never has the client write it directly.

---

## File Structure

```
/ (repo root — Next.js app)
  package.json, tsconfig.json, next.config.js, tailwind.config.ts, vitest.config.ts
  .env.local.example
  firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
  /app
    /(auth)/login/page.tsx
    /(dashboard)/layout.tsx
    /(dashboard)/pengajuan/page.tsx
    /(dashboard)/pengajuan/new/page.tsx
    /(dashboard)/pengajuan/[id]/page.tsx
    /(dashboard)/persetujuan/page.tsx
  /components
    /status-badge/StatusBadge.tsx
    /submission-timeline/SubmissionTimeline.tsx
    /signature-pad/SignaturePad.tsx
  /lib
    /firebase/client.ts
    /hooks/useAuth.ts
    /schemas/submission.ts
    /schemas/submission.test.ts
  /scripts
    seed-emulator.ts
  /tests
    firestore-rules.test.ts
  /functions
    package.json, tsconfig.json
    /src
      admin.ts
      counters.ts
      counters.test.ts
      submitSubmission.ts
      submitSubmission.test.ts
      reviewSubmission.ts
      reviewSubmission.test.ts
      index.ts
```

Each file has one job: `lib/schemas/submission.ts` is the single validation source (imported by both the form and, via a duplicated-but-identical copy, the functions — see Task 5 note); `functions/src/counters.ts` only knows how to mint the next number; `submitSubmission.ts`/`reviewSubmission.ts` each own one state transition.

---

## Task 1: Scaffold Next.js app

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Run create-next-app**

Run:
```bash
npx create-next-app@14 . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --use-npm
```
Expected: project files generated in the current directory (this repo root), no `src/` dir.

- [ ] **Step 2: Init shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
```
Expected: `components.json` created, `lib/utils.ts` created, Tailwind config updated with shadcn theme tokens.

- [ ] **Step 3: Add the shadcn components Fase 1 needs**

Run:
```bash
npx shadcn@latest add button input label form card badge table textarea select
```
Expected: components added under `components/ui/`.

- [ ] **Step 4: Verify dev server boots**

Run: `npm run dev` (then Ctrl+C once you see it's up)
Expected: "Ready" log, no compile errors, default Next.js page reachable at `http://localhost:3000`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 14 app with Tailwind and shadcn/ui"
```

---

## Task 2: Firebase project config + Emulator Suite

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `.env.local.example`, `.gitignore` (append)

- [ ] **Step 1: Write `firestore.rules` (deny-all placeholder, replaced in Task 10)**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: Write `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 3: Write `.firebaserc`**

```json
{
  "projects": {
    "default": "pengajuan-kendaraan-perlengkapan"
  }
}
```

Note: replace `pengajuan-kendaraan-perlengkapan` with the real Firebase project id once one is created in the console — for Fase 1 development this only matters for `firebase deploy`, not for the emulators.

- [ ] **Step 4: Write `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "functions",
    "predeploy": ["npm --prefix functions run build"]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

- [ ] **Step 5: Write `.env.local.example`**

```
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=pengajuan-kendaraan-perlengkapan.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=pengajuan-kendaraan-perlengkapan
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=pengajuan-kendaraan-perlengkapan.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
```

Copy it: `cp .env.local.example .env.local` (values above are fine for emulator-only Fase 1 dev; real values only needed once you deploy against a live Firebase project).

- [ ] **Step 6: Append to `.gitignore`**

```
.env.local
firebase-debug.log
firestore-debug.log
ui-debug.log
/functions/lib
/functions/node_modules
```

- [ ] **Step 7: Verify emulators start**

Run: `npx firebase emulators:start --only auth,firestore` (Ctrl+C after you see "All emulators ready")
Expected: log shows Auth on 9099, Firestore on 8080, Emulator UI on 4000, no errors.

- [ ] **Step 8: Commit**

```bash
git add firebase.json .firebaserc firestore.rules firestore.indexes.json .env.local.example .gitignore
git commit -m "chore: add Firebase project config and emulator setup"
```

---

## Task 3: Firebase client SDK init

**Files:**
- Create: `lib/firebase/client.ts`

- [ ] **Step 1: Install client SDK**

Run: `npm install firebase`

- [ ] **Step 2: Write `lib/firebase/client.ts`**

```typescript
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

let emulatorsConnected = false;

export function connectToEmulatorsIfConfigured() {
  if (emulatorsConnected) return;
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") return;
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  emulatorsConnected = true;
}
```

- [ ] **Step 3: Call the emulator connector once at app startup**

In `app/layout.tsx`, add near the top of the file (client-side only — this file stays a server component, so do the emulator connect in a tiny client component):

Create `app/emulator-bootstrap.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { connectToEmulatorsIfConfigured } from "@/lib/firebase/client";

export function EmulatorBootstrap() {
  useEffect(() => {
    connectToEmulatorsIfConfigured();
  }, []);
  return null;
}
```

Then render `<EmulatorBootstrap />` once inside the `<body>` of `app/layout.tsx`.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/firebase/client.ts app/emulator-bootstrap.tsx app/layout.tsx
git commit -m "feat: init Firebase client SDK with emulator bootstrap"
```

---

## Task 4: Zod schemas (single source of validation)

**Files:**
- Create: `lib/schemas/submission.ts`
- Test: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Install Zod and Vitest**

Run: `npm install zod && npm install -D vitest`

- [ ] **Step 2: Write the failing test**

```typescript
// lib/schemas/submission.test.ts
import { describe, it, expect } from "vitest";
import { createSubmissionSchema, reviewSubmissionSchema } from "./submission";

describe("createSubmissionSchema", () => {
  const validPayload = {
    type: "kendaraan" as const,
    subType: "service_berkala" as const,
    requesterSignatureUrl: "https://storage.example.com/sig.png",
    items: [
      { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service 40rb km" },
    ],
  };

  it("accepts a valid kendaraan payload", () => {
    expect(createSubmissionSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects subType not valid for the given type", () => {
    const result = createSubmissionSchema.safeParse({ ...validPayload, subType: "penggantian" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty items array", () => {
    const result = createSubmissionSchema.safeParse({ ...validPayload, items: [] });
    expect(result.success).toBe(false);
  });

  it("allows km to be null for perlengkapan", () => {
    const payload = {
      type: "perlengkapan" as const,
      subType: "pengadaan_baru" as const,
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "Kertas A4", brandType: "Sinar Dunia", km: null, quantity: 10, unit: "rim", description: "" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });
});

describe("reviewSubmissionSchema", () => {
  it("requires rejectionNote when decision is reject", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "" });
    expect(result.success).toBe(false);
  });

  it("accepts reject with a non-empty rejectionNote", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "Data KM tidak sesuai" });
    expect(result.success).toBe(true);
  });

  it("accepts approve without rejectionNote", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL — `Cannot find module './submission'`.

- [ ] **Step 3: Write `lib/schemas/submission.ts`**

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

export const createSubmissionSchema = z
  .object({
    submissionId: z.string().optional(),
    type: submissionTypeSchema,
    subType: z.string(),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1, "Minimal 1 item"),
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
    rejectionNote: z.string().optional(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  });

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Add a `test` script to `package.json`**

```json
"scripts": {
  "test": "vitest run"
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts package.json
git commit -m "feat: add Zod schemas for submission create/review payloads"
```

---

## Task 5: Scaffold Cloud Functions project

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/src/admin.ts`, `functions/src/index.ts`, `functions/src/schemas.ts`

- [ ] **Step 1: Init the functions package**

Run:
```bash
mkdir -p functions/src
```

Write `functions/package.json`:

```json
{
  "name": "functions",
  "private": true,
  "engines": { "node": "20" },
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "serve": "npm run build && firebase emulators:start --only functions,firestore,auth"
  },
  "dependencies": {
    "firebase-admin": "^12.1.0",
    "firebase-functions": "^5.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "firebase-functions-test": "^3.2.0"
  }
}
```

- [ ] **Step 2: Write `functions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es2020",
    "lib": ["es2020"],
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"],
  "compileOnStart": true
}
```

- [ ] **Step 3: Write `functions/src/admin.ts`**

```typescript
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const adminApp = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(adminApp);
```

- [ ] **Step 4: Write `functions/src/schemas.ts` (duplicated from `lib/schemas/submission.ts` — see plan header note)**

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

export const createSubmissionSchema = z
  .object({
    submissionId: z.string().optional(),
    type: z.enum(["kendaraan", "perlengkapan"]),
    subType: z.string(),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1),
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
    rejectionNote: z.string().optional(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  });

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
```

- [ ] **Step 5: Write `functions/src/index.ts` (placeholder export, filled in Tasks 7-8)**

```typescript
export {};
```

- [ ] **Step 6: Install and build**

Run: `npm --prefix functions install && npm --prefix functions run build`
Expected: `functions/lib/index.js` generated, no errors.

- [ ] **Step 7: Commit**

```bash
git add functions/package.json functions/tsconfig.json functions/src
git commit -m "chore: scaffold Cloud Functions project"
```

---

## Task 6: `counters.ts` — submission number generator

**Files:**
- Create: `functions/src/counters.ts`
- Test: `functions/src/counters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/counters.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getNextSubmissionNumber } from "./counters";

let testEnv: RulesTestEnvironment;

describe("getNextSubmissionNumber", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-counters-test",
      firestore: { host: "127.0.0.1", port: 8080 },
    });
    await testEnv.clearFirestore();
  });

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

Add dev dependency: `npm --prefix functions install -D @firebase/rules-unit-testing`

- [ ] **Step 2: Run test to verify it fails**

Run (with emulator running — see below): `npx vitest run functions/src/counters.test.ts`
Expected: FAIL — `Cannot find module './counters'`.

Start the Firestore emulator in a separate terminal before running functions tests in every subsequent task: `npx firebase emulators:start --only firestore,auth`

- [ ] **Step 3: Write `functions/src/counters.ts`**

```typescript
import type { Firestore } from "firebase-admin/firestore";

const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export async function getNextSubmissionNumber(
  db: Firestore,
  branch: string,
  year: number,
  month: number
): Promise<string> {
  const monthPadded = String(month).padStart(2, "0");
  const counterRef = db.collection("counters").doc(`${branch}-${year}-${monthPadded}`);

  const nextNumber = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data()!.lastNumber as number) : 0;
    const next = current + 1;
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });

  const counterPadded = String(nextNumber).padStart(3, "0");
  return `${counterPadded}/${branch}/${ROMAN_MONTHS[month - 1]}/${year}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/counters.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/counters.ts functions/src/counters.test.ts functions/package.json
git commit -m "feat: add transactional submission number generator"
```

---

## Task 7: `submitSubmission` Cloud Function — create path

**Files:**
- Create: `functions/src/submitSubmission.ts`
- Test: `functions/src/submitSubmission.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing test (create path only)**

```typescript
// functions/src/submitSubmission.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

const fft = functionsTest({ projectId: "demo-pengajuan-submit-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string, branch: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "Test User",
    email: `${uid}@example.com`,
    role,
    branch,
    department: "Operasional",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("submitSubmissionHandler (create)", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-submit-test",
      firestore: { host: "127.0.0.1", port: 8080 },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  const validItems = [
    { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service" },
  ];

  it("rejects when caller is not authenticated", async () => {
    const { submitSubmissionHandler } = await import("./submitSubmission");
    await expect(
      submitSubmissionHandler(
        { type: "kendaraan", subType: "service_berkala", requesterSignatureUrl: "https://x/y.png", items: validItems },
        { auth: undefined } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when caller role is not admin_cabang/snd", async () => {
    await seedUser("uid-spv", "spv", "WHO");
    const { submitSubmissionHandler } = await import("./submitSubmission");
    await expect(
      submitSubmissionHandler(
        { type: "kendaraan", subType: "service_berkala", requesterSignatureUrl: "https://x/y.png", items: validItems },
        { auth: { uid: "uid-spv" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("creates a new submission with generated number and statusHistory entry", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const { submitSubmissionHandler } = await import("./submitSubmission");
    const result = await submitSubmissionHandler(
      { type: "kendaraan", subType: "service_berkala", requesterSignatureUrl: "https://x/y.png", items: validItems },
      { auth: { uid: "uid-admin" } } as any
    );

    expect(result.submissionNumber).toMatch(/^001\/WHO\/[IVX]+\/\d{4}$/);
    expect(result.status).toBe("diajukan");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run functions/src/submitSubmission.test.ts`
Expected: FAIL — `Cannot find module './submitSubmission'`.

- [ ] **Step 3: Write `functions/src/submitSubmission.ts` (create path)**

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
    throw new HttpsError("invalid-argument", parsed.error.message);
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
  const batch = db.batch();
  existingItems.forEach((doc) => batch.delete(doc.ref));
  input.items.forEach((item) => {
    const itemRef = submissionRef.collection("items").doc();
    batch.set(itemRef, item);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/submitSubmission.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Wire up the callable export in `functions/src/index.ts`**

```typescript
import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
```

- [ ] **Step 6: Build and commit**

Run: `npm --prefix functions run build`

```bash
git add functions/src/submitSubmission.ts functions/src/submitSubmission.test.ts functions/src/index.ts functions/package.json
git commit -m "feat: add submitSubmission callable (create + resubmit-after-revisi)"
```

---

## Task 8: `submitSubmission` — resubmit-after-revisi test coverage

**Files:**
- Modify: `functions/src/submitSubmission.test.ts`

- [ ] **Step 1: Add the failing test for the resubmit path**

Append to `functions/src/submitSubmission.test.ts`, inside a new `describe`:

```typescript
describe("submitSubmissionHandler (resubmit after revisi)", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-submit-test",
      firestore: { host: "127.0.0.1", port: 8080 },
    });
    await testEnv.clearFirestore();
  });

  it("rejects resubmit when status is not perlu_revisi", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-1");
    await subRef.set({
      submissionNumber: "001/WHO/VIII/2026",
      status: "diajukan",
      requesterId: "uid-admin",
      branch: "WHO",
    });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await expect(
      submitSubmissionHandler(
        {
          submissionId: "sub-1",
          type: "kendaraan",
          subType: "service_berkala",
          requesterSignatureUrl: "https://x/y.png",
          items: [{ itemName: "X", brandType: "X", km: 1000, quantity: 1, unit: "unit", description: "" }],
        },
        { auth: { uid: "uid-admin" } } as any
      )
    ).rejects.toThrow(/perlu_revisi/);
  });

  it("resubmits, keeps the same submissionNumber, and replaces items", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-2");
    await subRef.set({
      submissionNumber: "002/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "KM salah",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    const result = await submitSubmissionHandler(
      {
        submissionId: "sub-2",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    expect(result.submissionNumber).toBe("002/WHO/VIII/2026");
    expect(result.status).toBe("diajukan");

    const updated = await subRef.get();
    expect(updated.data()!.rejectionNote).toBeNull();

    const items = await subRef.collection("items").get();
    expect(items.docs).toHaveLength(1);
    expect(items.docs[0].data().itemName).toBe("Fixed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run functions/src/submitSubmission.test.ts`
Expected: PASS immediately — the implementation from Task 7 already handles this path. If any test fails, fix `resubmitAfterRevisi` in `functions/src/submitSubmission.ts` until all pass (do not touch the create-path tests).

- [ ] **Step 3: Commit**

```bash
git add functions/src/submitSubmission.test.ts
git commit -m "test: cover submitSubmission resubmit-after-revisi path"
```

---

## Task 9: `reviewSubmission` Cloud Function

**Files:**
- Create: `functions/src/reviewSubmission.ts`
- Test: `functions/src/reviewSubmission.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/reviewSubmission.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { HttpsError } from "firebase-functions/v2/https";

let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

async function seedSubmission(id: string, status: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "001/WHO/VIII/2026",
    status,
    requesterId: "uid-requester",
    branch: "WHO",
  });
}

describe("reviewSubmissionHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-review-test",
      firestore: { host: "127.0.0.1", port: 8080 },
    });
    await testEnv.clearFirestore();
  });

  it("rejects when caller role is not spv/management", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-1", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-1", decision: "approve" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects reviewing a submission that isn't in diajukan", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-2", "disetujui");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-2", decision: "approve" }, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(/diajukan/);
  });

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

  it("rejects without rejectionNote", async () => {
    await seedUser("uid-mgmt", "management");
    await seedSubmission("sub-4", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-4", decision: "reject" }, { auth: { uid: "uid-mgmt" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects with rejectionNote and sets status perlu_revisi", async () => {
    await seedUser("uid-mgmt", "management");
    await seedSubmission("sub-5", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await reviewSubmissionHandler(
      { submissionId: "sub-5", decision: "reject", rejectionNote: "KM tidak sesuai" },
      { auth: { uid: "uid-mgmt" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-5").get();
    expect(updated.data()!.status).toBe("perlu_revisi");
    expect(updated.data()!.rejectionNote).toBe("KM tidak sesuai");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run functions/src/reviewSubmission.test.ts`
Expected: FAIL — `Cannot find module './reviewSubmission'`.

- [ ] **Step 3: Write `functions/src/reviewSubmission.ts`**

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { reviewSubmissionSchema, ReviewSubmissionInput } from "./schemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function reviewSubmissionHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["spv", "management"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya SPV atau Management yang bisa mereview.");
  }

  const parsed = reviewSubmissionSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.message);
  }
  const input: ReviewSubmissionInput = parsed.data;

  const submissionRef = db.collection("submissions").doc(input.submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();

  if (!submission) {
    throw new HttpsError("not-found", "Pengajuan tidak ditemukan.");
  }
  if (submission.status !== "diajukan") {
    throw new HttpsError("failed-precondition", "Hanya pengajuan berstatus diajukan yang bisa direview.");
  }

  const batch = db.batch();
  const historyRef = submissionRef.collection("statusHistory").doc();

  if (input.decision === "approve") {
    batch.update(submissionRef, {
      status: "disetujui",
      approverId: context.auth.uid,
      approverRole: caller.role,
      approvedAt: FieldValue.serverTimestamp(),
      reviewedAt: FieldValue.serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "disetujui",
      note: null,
      actorId: context.auth.uid,
      actorRole: caller.role,
      timestamp: FieldValue.serverTimestamp(),
    });
  } else {
    batch.update(submissionRef, {
      status: "perlu_revisi",
      rejectionNote: input.rejectionNote,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    batch.set(historyRef, {
      status: "perlu_revisi",
      note: input.rejectionNote,
      actorId: context.auth.uid,
      actorRole: caller.role,
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { submissionId: input.submissionId, status: input.decision === "approve" ? "disetujui" : "perlu_revisi" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/reviewSubmission.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Wire up the callable export**

Modify `functions/src/index.ts`:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);
```

- [ ] **Step 6: Build and commit**

Run: `npm --prefix functions run build`

```bash
git add functions/src/reviewSubmission.ts functions/src/reviewSubmission.test.ts functions/src/index.ts
git commit -m "feat: add reviewSubmission callable (approve/reject)"
```

---

## Task 10: Firestore security rules

**Files:**
- Modify: `firestore.rules`
- Create: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/firestore-rules.test.ts
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

  it("denies direct client update of submission status", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").update({ status: "disetujui" }));
  });

  it("denies direct client write to statusHistory", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(
      db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h1").set({ status: "diajukan" })
    );
  });

  it("denies direct client write to counters", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/firestore-rules.test.ts`
Expected: FAIL — the deny-all placeholder from Task 2 fails the "allows" assertions.

- [ ] **Step 3: Replace `firestore.rules` with the real Fase 1 rules**

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
    }

    match /counters/{counterId} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/firestore-rules.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: implement Fase 1 Firestore security rules"
```

---

## Task 11: Auth hook + login page

**Files:**
- Create: `lib/hooks/useAuth.ts`, `app/(auth)/login/page.tsx`

- [ ] **Step 1: Write `lib/hooks/useAuth.ts`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";

export type AppUser = {
  uid: string;
  name: string;
  email: string;
  role: "admin_cabang" | "snd" | "spv" | "management" | "superadmin";
  branch: string | null;
  department: string;
  position: string;
};

export function useAuth() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAppUser(null);
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(db, "users", user.uid));
      setAppUser(snap.exists() ? ({ uid: user.uid, ...(snap.data() as Omit<AppUser, "uid">) }) : null);
      setLoading(false);
    });
  }, []);

  return { firebaseUser, appUser, loading };
}
```

- [ ] **Step 2: Write `app/(auth)/login/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/pengajuan");
    } catch (err) {
      setError("Email atau password salah.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Masuk</h1>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Memproses..." : "Masuk"}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev` and, in another terminal, `npx firebase emulators:start --only auth,firestore`. Visit `http://localhost:4000/auth`, add a test user (email/password). Visit `http://localhost:3000/login`, sign in with that user.
Expected: redirected to `/pengajuan` (page doesn't exist yet until Task 12/16 — a 404 here is fine for this step, the goal is confirming sign-in succeeds without console errors).

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/useAuth.ts "app/(auth)/login/page.tsx"
git commit -m "feat: add auth hook and login page"
```

---

## Task 12: Dashboard layout role guard + emulator seed script

**Files:**
- Create: `app/(dashboard)/layout.tsx`, `scripts/seed-emulator.ts`

- [ ] **Step 1: Write `app/(dashboard)/layout.tsx`**

```typescript
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !appUser) {
      router.replace("/login");
    }
  }, [loading, appUser, router]);

  if (loading || !appUser) {
    return <div className="p-8 text-sm text-muted-foreground">Memuat...</div>;
  }

  return <div className="min-h-screen">{children}</div>;
}
```

Per-page role checks (e.g. `/persetujuan` requiring `spv`/`management`) are added in Task 17 alongside that page, since the redirect target and message are page-specific.

- [ ] **Step 2: Write `scripts/seed-emulator.ts`**

```typescript
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = initializeApp({ projectId: "demo-pengajuan-local" });
const auth = getAuth(app);
const db = getFirestore(app);

const SEED_USERS = [
  { email: "admin.who@example.com", password: "password123", name: "Admin WHO", role: "admin_cabang", branch: "WHO", department: "Operasional", position: "Admin Cabang" },
  { email: "snd@example.com", password: "password123", name: "Staff SND", role: "snd", branch: "SND", department: "SND", position: "Staff" },
  { email: "spv@example.com", password: "password123", name: "AWS Supervisor", role: "spv", branch: null, department: "AWS", position: "Supervisor" },
  { email: "management@example.com", password: "password123", name: "Management", role: "management", branch: null, department: "Management", position: "Manager" },
];

async function seed() {
  for (const u of SEED_USERS) {
    const userRecord = await auth.createUser({ email: u.email, password: u.password, displayName: u.name });
    await db.collection("users").doc(userRecord.uid).set({
      name: u.name,
      email: u.email,
      role: u.role,
      branch: u.branch,
      department: u.department,
      position: u.position,
      createdAt: new Date(),
    });
    console.log(`Seeded ${u.email} (${u.role})`);
  }
}

seed().then(() => process.exit(0));
```

- [ ] **Step 3: Add a `seed` script to root `package.json`**

```json
"scripts": {
  "seed": "tsx scripts/seed-emulator.ts"
}
```

Run: `npm install -D tsx firebase-admin`

- [ ] **Step 4: Verify the seed script works**

With emulators running (`npx firebase emulators:start --only auth,firestore`), run: `npm run seed`
Expected: 4 "Seeded ..." log lines, no errors; users visible at `http://localhost:4000/auth` and `http://localhost:4000/firestore`.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/layout.tsx" scripts/seed-emulator.ts package.json
git commit -m "feat: add dashboard auth guard and emulator seed script"
```

---

## Task 13: Signature pad component

**Files:**
- Create: `components/signature-pad/SignaturePad.tsx`

- [ ] **Step 1: Install `signature_pad`**

Run: `npm install signature_pad`

- [ ] **Step 2: Write `components/signature-pad/SignaturePad.tsx`**

```typescript
"use client";

import { useEffect, useRef } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const pad = new SignaturePadLib(canvasRef.current, { backgroundColor: "rgb(255,255,255)" });
    pad.addEventListener("endStroke", () => {
      onChange(pad.isEmpty() ? null : pad.toDataURL("image/png"));
    });
    padRef.current = pad;
    return () => pad.off();
  }, [onChange]);

  function handleClear() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} width={400} height={160} className="rounded border bg-white" />
      <Button type="button" variant="outline" size="sm" onClick={handleClear}>
        Hapus Tanda Tangan
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Temporarily render `<SignaturePad onChange={console.log} />` on `app/page.tsx`, run `npm run dev`, draw on the canvas.
Expected: dragging the mouse/finger draws a line; console logs a `data:image/png;base64,...` string on stroke end; "Hapus Tanda Tangan" clears the canvas and logs `null`. Revert the temporary change to `app/page.tsx` after confirming.

- [ ] **Step 4: Commit**

```bash
git add components/signature-pad/SignaturePad.tsx package.json package-lock.json
git commit -m "feat: add signature pad component"
```

---

## Task 14: Status badge + submission timeline components

**Files:**
- Create: `components/status-badge/StatusBadge.tsx`, `components/submission-timeline/SubmissionTimeline.tsx`

- [ ] **Step 1: Write `components/status-badge/StatusBadge.tsx`**

```typescript
import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  diajukan: { label: "Diajukan", color: "#64748B" },
  perlu_revisi: { label: "Perlu Revisi", color: "#D97706" },
  disetujui: { label: "Disetujui", color: "#0891B2" },
  siap_dikirim: { label: "Siap Dikirim", color: "#3454D1" },
  on_proses_ga: { label: "On Proses GA", color: "#7C3AED" },
  selesai: { label: "Selesai", color: "#16A34A" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { label: status, color: "#64748B" };
  return (
    <Badge style={{ backgroundColor: style.color, color: "white" }} className="border-0">
      {style.label}
    </Badge>
  );
}
```

- [ ] **Step 2: Write `components/submission-timeline/SubmissionTimeline.tsx`**

```typescript
import { StatusBadge } from "@/components/status-badge/StatusBadge";

export type StatusHistoryEntry = {
  id: string;
  status: string;
  note: string | null;
  actorRole: string;
  timestamp: Date;
};

export function SubmissionTimeline({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat status.</p>;
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3 text-sm">
          <StatusBadge status={entry.status} />
          <div>
            <p className="text-muted-foreground">
              {entry.actorRole} — {entry.timestamp.toLocaleString("id-ID")}
            </p>
            {entry.note && <p>{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/status-badge components/submission-timeline
git commit -m "feat: add status badge and submission timeline components"
```

---

## Task 15: Buat Pengajuan form (create + resubmit UI)

**Files:**
- Create: `app/(dashboard)/pengajuan/new/page.tsx`

- [ ] **Step 1: Install React Hook Form + resolver**

Run: `npm install react-hook-form @hookform/resolvers`

- [ ] **Step 2: Write `app/(dashboard)/pengajuan/new/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";
import { createSubmissionSchema, CreateSubmissionInput, subTypeByType } from "@/lib/schemas/submission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export default function NewPengajuanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resubmitId = searchParams.get("resubmit") ?? undefined;
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<CreateSubmissionInput>({
    resolver: zodResolver(createSubmissionSchema),
    defaultValues: {
      submissionId: resubmitId,
      type: "kendaraan",
      subType: "service_berkala",
      requesterSignatureUrl: "",
      items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const selectedType = watch("type");

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

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Buat Pengajuan</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-1">
          <Label htmlFor="type">Jenis Pengajuan</Label>
          <select id="type" {...register("type")} className="w-full rounded border p-2">
            <option value="kendaraan">Kendaraan</option>
            <option value="perlengkapan">Perlengkapan</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="subType">Sub Jenis</Label>
          <select id="subType" {...register("subType")} className="w-full rounded border p-2">
            {subTypeByType[selectedType].map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
          {errors.subType && <p className="text-sm text-red-600">{errors.subType.message}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Item</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" })}>
              Tambah Item
            </Button>
          </div>
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-2 gap-2 rounded border p-3">
              <Input placeholder="Nama item" {...register(`items.${index}.itemName`)} />
              <Input placeholder="Merk/Tipe" {...register(`items.${index}.brandType`)} />
              {selectedType === "kendaraan" && (
                <Input type="number" placeholder="KM" {...register(`items.${index}.km`, { valueAsNumber: true })} />
              )}
              <Input type="number" placeholder="Jumlah" {...register(`items.${index}.quantity`, { valueAsNumber: true })} />
              <Input placeholder="Satuan" {...register(`items.${index}.unit`)} />
              <Textarea placeholder="Deskripsi" {...register(`items.${index}.description`)} />
              {fields.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>Hapus</Button>
              )}
            </div>
          ))}
          {errors.items && <p className="text-sm text-red-600">{errors.items.message as string}</p>}
        </div>

        <div className="space-y-1">
          <Label>Tanda Tangan</Label>
          <SignaturePad onChange={(dataUrl) => setValue("requesterSignatureUrl", dataUrl ?? "")} />
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

Note: `requesterSignatureUrl` here temporarily holds a base64 data URL, not a Storage URL — Storage upload is out of scope for Fase 1 (brief lists Firebase Storage under a later concern alongside PDF generation). `createSubmissionSchema`'s `.url()` check accepts `data:` URIs since they match the URL grammar Zod validates against; if this causes friction during Task 15 verification, relax that one field to `z.string().min(1)` in both `lib/schemas/submission.ts` and `functions/src/schemas.ts` and note the change in the commit message.

- [ ] **Step 3: Manual verification**

With emulators running and seed data loaded, log in as `admin.who@example.com`, visit `/pengajuan/new`, fill the form, submit.
Expected: no console errors; redirected to `/pengajuan/<id>` (404 is fine until Task 16); check the Emulator UI Firestore tab — a new `submissions` doc exists with `status: "diajukan"`, a matching `items` subcollection doc, and a `statusHistory` doc.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/pengajuan/new/page.tsx" package.json package-lock.json
git commit -m "feat: add buat pengajuan form wired to submitSubmission"
```

---

## Task 16: Pengajuan list + detail/revisi page

**Files:**
- Create: `app/(dashboard)/pengajuan/page.tsx`, `app/(dashboard)/pengajuan/[id]/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/pengajuan/page.tsx`**

```typescript
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { Button } from "@/components/ui/button";

type SubmissionRow = { id: string; submissionNumber: string; type: string; status: string };

export default function PengajuanListPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<SubmissionRow[]>([]);

  useEffect(() => {
    if (!appUser) return;
    const q = query(
      collection(db, "submissions"),
      where("requesterId", "==", appUser.uid),
      orderBy("submittedAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, submissionNumber: d.data().submissionNumber, type: d.data().type, status: d.data().status })));
    });
  }, [appUser]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pengajuan Saya</h1>
        <Link href="/pengajuan/new"><Button>Buat Pengajuan</Button></Link>
      </div>
      <ul className="divide-y rounded border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between p-3">
            <Link href={`/pengajuan/${row.id}`} className="hover:underline">
              {row.submissionNumber} — {row.type}
            </Link>
            <StatusBadge status={row.status} />
          </li>
        ))}
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">Belum ada pengajuan.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Write `app/(dashboard)/pengajuan/[id]/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, collection, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { SubmissionTimeline, StatusHistoryEntry } from "@/components/submission-timeline/SubmissionTimeline";
import { Button } from "@/components/ui/button";

export default function PengajuanDetailPage({ params }: { params: { id: string } }) {
  const [submission, setSubmission] = useState<any>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);

  useEffect(() => {
    const unsubSub = onSnapshot(doc(db, "submissions", params.id), (snap) => {
      setSubmission(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    const historyQuery = query(collection(db, "submissions", params.id, "statusHistory"), orderBy("timestamp", "asc"));
    const unsubHistory = onSnapshot(historyQuery, (snap) => {
      setHistory(snap.docs.map((d) => ({
        id: d.id,
        status: d.data().status,
        note: d.data().note,
        actorRole: d.data().actorRole,
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
      })));
    });
    return () => {
      unsubSub();
      unsubHistory();
    };
  }, [params.id]);

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
            <Button className="mt-2" size="sm">Revisi & Ajukan Ulang</Button>
          </Link>
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

- [ ] **Step 3: Manual verification**

As `admin.who@example.com`, visit `/pengajuan` — the submission created in Task 15 should appear with a `Diajukan` badge and link to its detail page showing one timeline entry.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/pengajuan/page.tsx" "app/(dashboard)/pengajuan/[id]/page.tsx"
git commit -m "feat: add pengajuan list and detail/revisi pages"
```

---

## Task 17: Antrian Persetujuan page

**Files:**
- Create: `app/(dashboard)/persetujuan/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/persetujuan/page.tsx`**

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

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

type QueueRow = { id: string; submissionNumber: string; type: string; branch: string };

export default function PersetujuanPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [noteBySubmission, setNoteBySubmission] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, submissionNumber: d.data().submissionNumber, type: d.data().type, branch: d.data().branch })));
    });
  }, []);

  async function handleDecision(submissionId: string, decision: "approve" | "reject") {
    setBusyId(submissionId);
    try {
      const reviewSubmission = httpsCallable(functions, "reviewSubmission");
      await reviewSubmission({ submissionId, decision, rejectionNote: noteBySubmission[submissionId] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Antrian Persetujuan</h1>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <span>{row.submissionNumber} — {row.type} ({row.branch})</span>
              <StatusBadge status="diajukan" />
            </div>
            <Textarea
              placeholder="Catatan (wajib jika reject)"
              value={noteBySubmission[row.id] ?? ""}
              onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === row.id} onClick={() => handleDecision(row.id, "approve")}>
                Setujui
              </Button>
              <Button size="sm" variant="destructive" disabled={busyId === row.id} onClick={() => handleDecision(row.id, "reject")}>
                Tolak
              </Button>
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-muted-foreground">Tidak ada pengajuan menunggu review.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Log in as `spv@example.com`, visit `/persetujuan` — the submission from Task 15/16 should appear. Click "Setujui"; confirm in the Emulator UI that the submission's `status` becomes `disetujui` and a new `statusHistory` entry appears. Repeat with a fresh submission and "Tolak" + a note; confirm `status` becomes `perlu_revisi` with `rejectionNote` set, and confirm it now shows the revisi banner on `/pengajuan/<id>` when viewed as the requester.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/persetujuan/page.tsx"
git commit -m "feat: add antrian persetujuan page wired to reviewSubmission"
```

---

## Task 18: Full end-to-end manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Run the full stack**

Terminal 1: `npx firebase emulators:start --only auth,firestore,functions`
Terminal 2: `npm run dev`
Terminal 3 (once): `npm run seed`

- [ ] **Step 2: Walk the full Fase 1 loop**

1. Log in as `admin.who@example.com` → `/pengajuan/new` → submit a kendaraan submission.
2. Confirm it shows on `/pengajuan` with `Diajukan`.
3. Log out, log in as `spv@example.com` → `/persetujuan` → reject with a note.
4. Log out, log in as `admin.who@example.com` → open the submission → confirm the revisi banner and note show → click "Revisi & Ajukan Ulang" → change an item → resubmit.
5. Confirm the submission's `submissionNumber` is unchanged and status is back to `Diajukan`, with a 3-entry timeline (diajukan, perlu_revisi, diajukan).
6. Log in as `spv@example.com` again → approve → confirm status becomes `Disetujui`.

Expected: every step completes with no console/emulator errors and Firestore state matches what's described.

- [ ] **Step 3: Run the full automated test suite**

Run: `npm test && npm --prefix functions run test`
Expected: all tests pass (schema, counters, submitSubmission, reviewSubmission, firestore rules).

- [ ] **Step 4: Commit** (only if Step 2/3 surfaced fixes)

```bash
git add -A
git commit -m "fix: address issues found in Fase 1 end-to-end walkthrough"
```

If no fixes were needed, skip this commit — Fase 1 is done.
