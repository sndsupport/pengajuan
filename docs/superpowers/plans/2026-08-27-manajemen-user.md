# Manajemen User (Superadmin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Create/Edit/Reset-Password user management for superadmin, per `docs/superpowers/specs/2026-08-27-manajemen-user-design.md`.

**Architecture:** Three new Cloud Functions callables (`createUser`, `updateUser`, `resetUserPassword`), all fail-fast on non-`superadmin` callers, since `users/{uid}` writes are already `if false` in `firestore.rules`. Listing users needs no new function — the existing read rule already lets `superadmin` read any `users/{uid}` doc, so `/admin` queries Firestore directly via `onSnapshot`. Client-side Zod schemas in `lib/schemas/user.ts` are duplicated into `functions/src/` (mirrors the existing `lib/schemas/submission.ts` → `functions/src/schemas.ts` split, since `functions/` is a separate TypeScript project that can't import from root `lib/`).

**Tech Stack:** TypeScript, Zod, React Hook Form, Vitest, Firebase Auth Admin SDK, Firestore Admin SDK, Firebase Functions v2 callable.

**Environment note:** This machine has no Java, so the Firestore/Auth Emulator cannot run. Every step that says "Run: ... (needs emulator)" should be executed by an engineer who has Java installed; on this machine, skip execution of those specific steps but still write the file exactly as shown — do not skip writing the test files themselves. Steps without that note (build, root-only unit tests) must be run and verified normally.

---

## File Structure

```
/lib
  /schemas
    user.ts               # new — createUserSchema, updateUserSchema, resetUserPasswordSchema, isValidBranchForRole
    user.test.ts           # new
/functions
  /src
    admin.ts               # modify — export `auth` alongside `db`
    username.ts             # new — duplicate of lib/auth/username.ts (functions/ can't import root lib/)
    username.test.ts        # new — duplicate of lib/auth/username.test.ts
    userSchemas.ts           # new — duplicate of lib/schemas/user.ts
    createUser.ts             # new
    createUser.test.ts        # new (needs emulator)
    updateUser.ts              # new
    updateUser.test.ts         # new (needs emulator)
    resetUserPassword.ts        # new
    resetUserPassword.test.ts   # new (needs emulator)
    index.ts                    # modify — export the 3 new callables
/app
  /(dashboard)
    layout.tsx                  # modify — nav link "Manajemen User" for superadmin
    /admin
      page.tsx                  # new — list all users
      /new
        page.tsx                 # new — create user form
      /[uid]
        page.tsx                  # new — edit user form + reset password form
```

---

## Task 1: `lib/schemas/user.ts` — Zod schemas for create/update/reset-password

**Files:**
- Create: `lib/schemas/user.ts`
- Test: `lib/schemas/user.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/schemas/user.test.ts
import { describe, it, expect } from "vitest";
import { createUserSchema, updateUserSchema, resetUserPasswordSchema, isValidBranchForRole } from "./user";

describe("isValidBranchForRole", () => {
  it("requires WHO or WHP for admin_cabang", () => {
    expect(isValidBranchForRole("admin_cabang", "WHO")).toBe(true);
    expect(isValidBranchForRole("admin_cabang", "WHP")).toBe(true);
    expect(isValidBranchForRole("admin_cabang", "SND")).toBe(false);
    expect(isValidBranchForRole("admin_cabang", null)).toBe(false);
  });

  it("requires SND for snd role", () => {
    expect(isValidBranchForRole("snd", "SND")).toBe(true);
    expect(isValidBranchForRole("snd", "WHO")).toBe(false);
  });

  it("requires null branch for spv/management/superadmin", () => {
    expect(isValidBranchForRole("spv", null)).toBe(true);
    expect(isValidBranchForRole("spv", "WHO")).toBe(false);
    expect(isValidBranchForRole("management", null)).toBe(true);
    expect(isValidBranchForRole("superadmin", null)).toBe(true);
  });
});

describe("createUserSchema", () => {
  const valid = {
    name: "Admin WHO",
    username: "admin.who",
    password: "password123",
    role: "admin_cabang" as const,
    branch: "WHO" as const,
    department: "Operasional",
    position: "Admin Cabang",
  };

  it("accepts a valid admin_cabang payload", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when branch doesn't match role", () => {
    expect(createUserSchema.safeParse({ ...valid, branch: "SND" }).success).toBe(false);
  });

  it("rejects a password shorter than 6 characters", () => {
    expect(createUserSchema.safeParse({ ...valid, password: "123" }).success).toBe(false);
  });

  it("accepts spv with null branch", () => {
    const result = createUserSchema.safeParse({ ...valid, role: "spv", branch: null, username: "spv1" });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted email", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid email when provided", () => {
    expect(createUserSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  const valid = {
    uid: "abc",
    name: "Admin WHO",
    role: "admin_cabang" as const,
    branch: "WHO" as const,
    department: "Operasional",
    position: "Admin Cabang",
  };

  it("accepts a valid payload without username or password fields", () => {
    expect(updateUserSchema.safeParse(valid).success).toBe(true);
  });

  it("strips an unexpected username field rather than accepting it", () => {
    const result = updateUserSchema.safeParse({ ...valid, username: "should-be-ignored" });
    expect(result.success).toBe(true);
    expect(result.success && "username" in result.data).toBe(false);
  });

  it("rejects mismatched branch/role", () => {
    expect(updateUserSchema.safeParse({ ...valid, role: "snd", branch: "WHO" }).success).toBe(false);
  });
});

describe("resetUserPasswordSchema", () => {
  it("rejects a password shorter than 6 characters", () => {
    expect(resetUserPasswordSchema.safeParse({ uid: "abc", newPassword: "123" }).success).toBe(false);
  });

  it("accepts a 6+ character password", () => {
    expect(resetUserPasswordSchema.safeParse({ uid: "abc", newPassword: "abcdef" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/user.test.ts`
Expected: FAIL — `Cannot find module './user'`.

- [ ] **Step 3: Write `lib/schemas/user.ts`**

```typescript
import { z } from "zod";

export const roleSchema = z.enum(["admin_cabang", "snd", "spv", "management", "superadmin"]);
export type Role = z.infer<typeof roleSchema>;

export const branchSchema = z.enum(["WHO", "WHP", "SND"]).nullable();

export function isValidBranchForRole(role: Role, branch: string | null): boolean {
  if (role === "admin_cabang") return branch === "WHO" || branch === "WHP";
  if (role === "snd") return branch === "SND";
  return branch === null;
}

const baseUserFields = {
  name: z.string().min(1, "Nama wajib diisi"),
  role: roleSchema,
  branch: branchSchema,
  department: z.string().min(1, "Departemen wajib diisi"),
  position: z.string().min(1, "Posisi wajib diisi"),
  email: z.string().email("Email tidak valid").nullish(),
};

export const createUserSchema = z
  .object({
    ...baseUserFields,
    username: z.string().min(1, "Username wajib diisi"),
    password: z.string().min(6, "Password minimal 6 karakter"),
  })
  .refine((data) => isValidBranchForRole(data.role, data.branch), {
    message: "Cabang tidak sesuai dengan role",
    path: ["branch"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    uid: z.string().min(1),
    ...baseUserFields,
  })
  .refine((data) => isValidBranchForRole(data.role, data.branch), {
    message: "Cabang tidak sesuai dengan role",
    path: ["branch"],
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  uid: z.string().min(1),
  newPassword: z.string().min(6, "Password minimal 6 karakter"),
});

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/user.test.ts`
Expected: PASS — 13 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/user.ts lib/schemas/user.test.ts
git commit -m "feat: add Zod schemas for user create/update/reset-password"
```

---

## Task 2: `functions/src/admin.ts` — export `auth` alongside `db`

**Files:**
- Modify: `functions/src/admin.ts`

- [ ] **Step 1: Add the Auth Admin SDK export**

Replace the full contents of `functions/src/admin.ts`:

```typescript
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const adminApp = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(adminApp);
export const auth = getAuth(adminApp);
```

- [ ] **Step 2: Verify functions project still builds**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/admin.ts
git commit -m "feat: export Auth Admin SDK instance from functions/src/admin.ts"
```

---

## Task 3: `functions/src/username.ts` — duplicate of `lib/auth/username.ts`

**Files:**
- Create: `functions/src/username.ts`
- Test: `functions/src/username.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/username.test.ts
import { describe, it, expect } from "vitest";
import { normalizeUsername, usernameToSyntheticEmail, InvalidUsernameError } from "./username";

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  Admin.WHO  ")).toBe("admin.who");
  });

  it("rejects usernames containing a space", () => {
    expect(() => normalizeUsername("admin who")).toThrow(InvalidUsernameError);
  });

  it("rejects usernames containing @", () => {
    expect(() => normalizeUsername("admin@who")).toThrow(InvalidUsernameError);
  });

  it("rejects an empty username", () => {
    expect(() => normalizeUsername("   ")).toThrow(InvalidUsernameError);
  });
});

describe("usernameToSyntheticEmail", () => {
  it("builds the synthetic email from a normalized username", () => {
    expect(usernameToSyntheticEmail("Admin.WHO")).toBe("admin.who@pengajuan-tsi.internal");
  });

  it("propagates normalization errors", () => {
    expect(() => usernameToSyntheticEmail("bad user")).toThrow(InvalidUsernameError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run functions/src/username.test.ts` (from repo root — root `vitest.config.mts` covers `functions/src/**` too)
Expected: FAIL — `Cannot find module './username'`.

- [ ] **Step 3: Write `functions/src/username.ts`**

```typescript
export class InvalidUsernameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsernameError";
  }
}

const SYNTHETIC_EMAIL_DOMAIN = "pengajuan-tsi.internal";

export function normalizeUsername(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new InvalidUsernameError("Username tidak boleh kosong.");
  }
  if (/\s/.test(trimmed)) {
    throw new InvalidUsernameError("Username tidak boleh mengandung spasi.");
  }
  if (trimmed.includes("@")) {
    throw new InvalidUsernameError("Username tidak boleh mengandung '@'.");
  }
  return trimmed;
}

export function usernameToSyntheticEmail(username: string): string {
  return `${normalizeUsername(username)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/username.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/username.ts functions/src/username.test.ts
git commit -m "feat: duplicate username normalization util into functions/src"
```

---

## Task 4: `functions/src/userSchemas.ts` — duplicate of `lib/schemas/user.ts`

**Files:**
- Create: `functions/src/userSchemas.ts`

No dedicated test file for this one — same precedent as `functions/src/schemas.ts` (the submission schemas), which is exercised indirectly through the handler tests (Tasks 5-7) rather than tested standalone.

- [ ] **Step 1: Write `functions/src/userSchemas.ts`**

```typescript
import { z } from "zod";

export const roleSchema = z.enum(["admin_cabang", "snd", "spv", "management", "superadmin"]);
export type Role = z.infer<typeof roleSchema>;

export const branchSchema = z.enum(["WHO", "WHP", "SND"]).nullable();

export function isValidBranchForRole(role: Role, branch: string | null): boolean {
  if (role === "admin_cabang") return branch === "WHO" || branch === "WHP";
  if (role === "snd") return branch === "SND";
  return branch === null;
}

const baseUserFields = {
  name: z.string().min(1, "Nama wajib diisi"),
  role: roleSchema,
  branch: branchSchema,
  department: z.string().min(1, "Departemen wajib diisi"),
  position: z.string().min(1, "Posisi wajib diisi"),
  email: z.string().email("Email tidak valid").nullish(),
};

export const createUserSchema = z
  .object({
    ...baseUserFields,
    username: z.string().min(1, "Username wajib diisi"),
    password: z.string().min(6, "Password minimal 6 karakter"),
  })
  .refine((data) => isValidBranchForRole(data.role, data.branch), {
    message: "Cabang tidak sesuai dengan role",
    path: ["branch"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    uid: z.string().min(1),
    ...baseUserFields,
  })
  .refine((data) => isValidBranchForRole(data.role, data.branch), {
    message: "Cabang tidak sesuai dengan role",
    path: ["branch"],
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  uid: z.string().min(1),
  newPassword: z.string().min(6, "Password minimal 6 karakter"),
});

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
```

- [ ] **Step 2: Verify functions project builds**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/userSchemas.ts
git commit -m "feat: duplicate user Zod schemas into functions/src"
```

---

## Task 5: `createUser` Cloud Function

**Files:**
- Create: `functions/src/createUser.ts`
- Test: `functions/src/createUser.test.ts` (needs emulator — see Environment note)

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/createUser.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-pengajuan-createuser-test";

const fft = functionsTest({ projectId: "demo-pengajuan-createuser-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedCaller(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "Caller",
    username: "caller",
    role,
    branch: null,
    department: "IT",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("createUserHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-createuser-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  const validInput = {
    name: "Admin WHO Baru",
    username: "admin.who2",
    password: "password123",
    role: "admin_cabang",
    branch: "WHO",
    department: "Operasional",
    position: "Admin Cabang",
  };

  it("rejects when caller is not superadmin", async () => {
    await seedCaller("uid-spv", "spv");
    const { createUserHandler } = await import("./createUser");
    await expect(
      createUserHandler(validInput, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("creates a Firebase Auth user and a matching Firestore doc", async () => {
    await seedCaller("uid-super", "superadmin");
    const { createUserHandler } = await import("./createUser");
    const result = await createUserHandler(validInput, { auth: { uid: "uid-super" } } as any);

    expect(result.username).toBe("admin.who2");

    const admin = testEnv.unauthenticatedContext().firestore();
    const createdDoc = await admin.collection("users").doc(result.uid).get();
    expect(createdDoc.data()!.username).toBe("admin.who2");
    expect(createdDoc.data()!.role).toBe("admin_cabang");
    expect(createdDoc.data()!.branch).toBe("WHO");
  });

  it("rejects a duplicate username", async () => {
    await seedCaller("uid-super", "superadmin");
    const { createUserHandler } = await import("./createUser");
    await createUserHandler(validInput, { auth: { uid: "uid-super" } } as any);

    await expect(
      createUserHandler({ ...validInput, name: "Lain" }, { auth: { uid: "uid-super" } } as any)
    ).rejects.toThrow(/sudah dipakai/);
  });

  it("rejects when branch doesn't match role", async () => {
    await seedCaller("uid-super", "superadmin");
    const { createUserHandler } = await import("./createUser");
    await expect(
      createUserHandler({ ...validInput, branch: "SND" }, { auth: { uid: "uid-super" } } as any)
    ).rejects.toThrow(HttpsError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (needs emulator — `npx firebase emulators:start --only firestore,auth` in a separate terminal first): `npx vitest run functions/src/createUser.test.ts`
Expected: FAIL — `Cannot find module './createUser'`.

- [ ] **Step 3: Write `functions/src/createUser.ts`**

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "./admin";
import { createUserSchema, CreateUserInput } from "./userSchemas";
import { normalizeUsername, usernameToSyntheticEmail } from "./username";

interface CallerContext {
  auth?: { uid: string };
}

export async function createUserHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || caller.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Hanya superadmin yang bisa membuat user.");
  }

  const parsed = createUserSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateUserInput = parsed.data;
  const normalizedUsername = normalizeUsername(input.username);

  let uid: string;
  try {
    const userRecord = await auth.createUser({
      email: usernameToSyntheticEmail(input.username),
      password: input.password,
      displayName: input.name,
    });
    uid = userRecord.uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Username sudah dipakai.");
    }
    throw err;
  }

  await db.collection("users").doc(uid).set({
    name: input.name,
    username: normalizedUsername,
    email: input.email ?? null,
    role: input.role,
    branch: input.branch,
    department: input.department,
    position: input.position,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { uid, username: normalizedUsername };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/createUser.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/createUser.ts functions/src/createUser.test.ts
git commit -m "feat: add createUser callable"
```

---

## Task 6: `updateUser` Cloud Function

**Files:**
- Create: `functions/src/updateUser.ts`
- Test: `functions/src/updateUser.test.ts` (needs emulator)

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/updateUser.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-updateuser-test";

const fft = functionsTest({ projectId: "demo-pengajuan-updateuser-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, data: Record<string, unknown>) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ createdAt: new Date(), ...data });
}

describe("updateUserHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-updateuser-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not superadmin", async () => {
    await seedUser("uid-spv", { name: "S", username: "spv", role: "spv", branch: null, department: "AWS", position: "Supervisor" });
    await seedUser("uid-target", { name: "Target", username: "target", role: "snd", branch: "SND", department: "SND", position: "Staff" });
    const { updateUserHandler } = await import("./updateUser");
    await expect(
      updateUserHandler(
        { uid: "uid-target", name: "Target Baru", role: "snd", branch: "SND", department: "SND", position: "Staff" },
        { auth: { uid: "uid-spv" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("rejects updating a user that doesn't exist", async () => {
    await seedUser("uid-super", { name: "Super", username: "superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" });
    const { updateUserHandler } = await import("./updateUser");
    await expect(
      updateUserHandler(
        { uid: "missing-uid", name: "X", role: "snd", branch: "SND", department: "SND", position: "Staff" },
        { auth: { uid: "uid-super" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("updates the target user's editable fields", async () => {
    await seedUser("uid-super", { name: "Super", username: "superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" });
    await seedUser("uid-target", { name: "Target Lama", username: "target", role: "snd", branch: "SND", department: "SND", position: "Staff" });
    const { updateUserHandler } = await import("./updateUser");
    await updateUserHandler(
      { uid: "uid-target", name: "Target Baru", role: "snd", branch: "SND", department: "SND", position: "Staff Senior" },
      { auth: { uid: "uid-super" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updatedDoc = await admin.collection("users").doc("uid-target").get();
    expect(updatedDoc.data()!.name).toBe("Target Baru");
    expect(updatedDoc.data()!.position).toBe("Staff Senior");
    expect(updatedDoc.data()!.username).toBe("target");
  });

  it("rejects when branch doesn't match role", async () => {
    await seedUser("uid-super", { name: "Super", username: "superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" });
    await seedUser("uid-target", { name: "Target", username: "target", role: "snd", branch: "SND", department: "SND", position: "Staff" });
    const { updateUserHandler } = await import("./updateUser");
    await expect(
      updateUserHandler(
        { uid: "uid-target", name: "Target", role: "snd", branch: "WHO", department: "SND", position: "Staff" },
        { auth: { uid: "uid-super" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (needs emulator): `npx vitest run functions/src/updateUser.test.ts`
Expected: FAIL — `Cannot find module './updateUser'`.

- [ ] **Step 3: Write `functions/src/updateUser.ts`**

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";
import { updateUserSchema, UpdateUserInput } from "./userSchemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function updateUserHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || caller.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Hanya superadmin yang bisa mengubah user.");
  }

  const parsed = updateUserSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateUserInput = parsed.data;

  const userRef = db.collection("users").doc(input.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User tidak ditemukan.");
  }

  await userRef.update({
    name: input.name,
    role: input.role,
    branch: input.branch,
    department: input.department,
    position: input.position,
    email: input.email ?? null,
  });

  return { uid: input.uid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/updateUser.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/updateUser.ts functions/src/updateUser.test.ts
git commit -m "feat: add updateUser callable"
```

---

## Task 7: `resetUserPassword` Cloud Function

**Files:**
- Create: `functions/src/resetUserPassword.ts`
- Test: `functions/src/resetUserPassword.test.ts` (needs emulator)

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/resetUserPassword.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-pengajuan-resetpw-test";

const fft = functionsTest({ projectId: "demo-pengajuan-resetpw-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "T",
    username: uid,
    role,
    branch: null,
    department: "IT",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("resetUserPasswordHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-resetpw-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not superadmin", async () => {
    await seedUser("uid-spv", "spv");
    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    await expect(
      resetUserPasswordHandler({ uid: "uid-spv", newPassword: "newpassword123" }, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects a password shorter than 6 characters", async () => {
    await seedUser("uid-super", "superadmin");
    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    await expect(
      resetUserPasswordHandler({ uid: "uid-super", newPassword: "123" }, { auth: { uid: "uid-super" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("resets the target user's Auth password", async () => {
    await seedUser("uid-super", "superadmin");
    const { auth } = await import("./admin");
    const target = await auth.createUser({ email: "target@pengajuan-tsi.internal", password: "oldpassword" });

    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    const result = await resetUserPasswordHandler(
      { uid: target.uid, newPassword: "newpassword123" },
      { auth: { uid: "uid-super" } } as any
    );

    expect(result.uid).toBe(target.uid);
  });

  it("rejects resetting a non-existent Auth user", async () => {
    await seedUser("uid-super", "superadmin");
    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    await expect(
      resetUserPasswordHandler(
        { uid: "does-not-exist", newPassword: "newpassword123" },
        { auth: { uid: "uid-super" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (needs emulator): `npx vitest run functions/src/resetUserPassword.test.ts`
Expected: FAIL — `Cannot find module './resetUserPassword'`.

- [ ] **Step 3: Write `functions/src/resetUserPassword.ts`**

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { auth, db } from "./admin";
import { resetUserPasswordSchema, ResetUserPasswordInput } from "./userSchemas";

interface CallerContext {
  auth?: { uid: string };
}

export async function resetUserPasswordHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || caller.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Hanya superadmin yang bisa mereset password.");
  }

  const parsed = resetUserPasswordSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: ResetUserPasswordInput = parsed.data;

  try {
    await auth.updateUser(input.uid, { password: input.newPassword });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/user-not-found") {
      throw new HttpsError("not-found", "User tidak ditemukan.");
    }
    throw err;
  }

  return { uid: input.uid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run functions/src/resetUserPassword.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/resetUserPassword.ts functions/src/resetUserPassword.test.ts
git commit -m "feat: add resetUserPassword callable"
```

---

## Task 8: Wire the 3 new callables into `functions/src/index.ts`

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add imports and exports**

Replace the full contents of `functions/src/index.ts`:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { submitSubmissionHandler } from "./submitSubmission";
import { reviewSubmissionHandler } from "./reviewSubmission";
import { uploadFileHandler } from "./uploadFile";
import { createUserHandler } from "./createUser";
import { updateUserHandler } from "./updateUser";
import { resetUserPasswordHandler } from "./resetUserPassword";

export const submitSubmission = onCall((request) =>
  submitSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

export const reviewSubmission = onCall((request) =>
  reviewSubmissionHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
);

// Attachments/signatures arrive as base64 (a 10MB file is ~13MB of base64) and
// are held in memory as a decoded Buffer while being streamed to Drive, so this
// needs more headroom than the default 256MiB/60s callable limits.
export const uploadFile = onCall({ memory: "512MiB", timeoutSeconds: 120 }, (request) =>
  uploadFileHandler(request.data, { auth: request.auth ? { uid: request.auth.uid } : undefined })
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
```

- [ ] **Step 2: Verify functions project builds**

Run: `npm --prefix functions run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: export createUser, updateUser, resetUserPassword callables"
```

---

## Task 9: `/admin` — list all users

**Files:**
- Create: `app/(dashboard)/admin/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/admin/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
  branch: string | null;
  department: string;
  position: string;
};

export default function AdminUsersPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            username: d.data().username,
            role: d.data().role,
            branch: d.data().branch ?? null,
            department: d.data().department,
            position: d.data().position,
          }))
        );
      },
      (err) => {
        setListError(err.code);
      }
    );
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manajemen User</h1>
        <Button asChild>
          <Link href="/admin/new">Buat User</Link>
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Cabang</TableHead>
            <TableHead>Departemen</TableHead>
            <TableHead>Posisi</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.username}</TableCell>
              <TableCell>{row.role}</TableCell>
              <TableCell>{row.branch ?? "-"}</TableCell>
              <TableCell>{row.department}</TableCell>
              <TableCell>{row.position}</TableCell>
              <TableCell>
                <Link href={`/admin/${row.id}`} className="text-sm underline">
                  Edit
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {listError && <p className="text-sm text-red-600">Gagal memuat daftar user.</p>}
      {!listError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada user.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/admin/page.tsx"
git commit -m "feat: add user list page at /admin"
```

---

## Task 10: `/admin/new` — create user form

**Files:**
- Create: `app/(dashboard)/admin/new/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/admin/new/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { createUserSchema, CreateUserInput } from "@/lib/schemas/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Management" },
  { value: "superadmin", label: "Superadmin" },
] as const;

function defaultBranchForRole(role: CreateUserInput["role"]): CreateUserInput["branch"] {
  if (role === "admin_cabang") return "WHO";
  if (role === "snd") return "SND";
  return null;
}

export default function NewUserPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createUserSchema>, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      username: "",
      password: "",
      role: "admin_cabang",
      branch: "WHO",
      department: "",
      position: "",
      email: "",
    },
  });

  const selectedRole = watch("role");
  const roleField = register("role");

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    roleField.onChange(event);
    setValue("branch", defaultBranchForRole(event.target.value as CreateUserInput["role"]));
  }

  async function onSubmit(data: CreateUserInput) {
    setServerError(null);
    try {
      const createUser = httpsCallable(functions, "createUser");
      await createUser({ ...data, email: data.email || null });
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat user.");
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-xl font-semibold">Buat User</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Nama</Label>
          <Input id="name" {...register("name")} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="username">Username</Label>
          <Input id="username" {...register("username")} />
          {errors.username && <p className="text-sm text-red-600">{errors.username.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="password">Password Awal</Label>
          <Input id="password" type="password" {...register("password")} />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          <select id="role" {...roleField} onChange={handleRoleChange} className="w-full rounded border p-2">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {selectedRole === "admin_cabang" && (
          <div className="space-y-1">
            <Label htmlFor="branch">Cabang</Label>
            <select id="branch" {...register("branch")} className="w-full rounded border p-2">
              <option value="WHO">WHO</option>
              <option value="WHP">WHP</option>
            </select>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="department">Departemen</Label>
          <Input id="department" {...register("department")} />
          {errors.department && <p className="text-sm text-red-600">{errors.department.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="position">Posisi</Label>
          <Input id="position" {...register("position")} />
          {errors.position && <p className="text-sm text-red-600">{errors.position.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="email">Email (opsional)</Label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Membuat..." : "Buat User"}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/admin/new/page.tsx"
git commit -m "feat: add create-user form at /admin/new"
```

---

## Task 11: `/admin/[uid]` — edit user + reset password

**Files:**
- Create: `app/(dashboard)/admin/[uid]/page.tsx`

- [ ] **Step 1: Write `app/(dashboard)/admin/[uid]/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { doc, getDoc } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateUserSchema, UpdateUserInput } from "@/lib/schemas/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Management" },
  { value: "superadmin", label: "Superadmin" },
] as const;

function defaultBranchForRole(role: UpdateUserInput["role"]): UpdateUserInput["branch"] {
  if (role === "admin_cabang") return "WHO";
  if (role === "snd") return "SND";
  return null;
}

export default function EditUserPage({ params }: { params: { uid: string } }) {
  const { uid } = params;
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState<string | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateUserSchema>, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { uid, name: "", role: "admin_cabang", branch: "WHO", department: "", position: "", email: "" },
  });

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      setIsLoadingUser(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) {
          throw new Error("User tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        setUsername(data.username ?? null);
        reset({
          uid,
          name: data.name ?? "",
          role: data.role,
          branch: data.branch ?? null,
          department: data.department ?? "",
          position: data.position ?? "",
          email: data.email ?? "",
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat data user.");
        }
      } finally {
        if (!cancelled) setIsLoadingUser(false);
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, [uid, reset]);

  const selectedRole = watch("role");
  const roleField = register("role");

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    roleField.onChange(event);
    setValue("branch", defaultBranchForRole(event.target.value as UpdateUserInput["role"]));
  }

  async function onSubmit(data: UpdateUserInput) {
    setServerError(null);
    try {
      const updateUser = httpsCallable(functions, "updateUser");
      await updateUser({ ...data, email: data.email || null });
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah user.");
    }
  }

  async function handleResetPassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    setIsResettingPassword(true);
    try {
      const resetUserPassword = httpsCallable(functions, "resetUserPassword");
      await resetUserPassword({ uid, newPassword: passwordValue });
      setPasswordSuccess(true);
      setPasswordValue("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Gagal reset password.");
    } finally {
      setIsResettingPassword(false);
    }
  }

  if (isLoadingUser) {
    return <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Memuat...</main>;
  }

  if (loadError) {
    return <main className="mx-auto max-w-md p-6 text-sm text-red-600">{loadError}</main>;
  }

  return (
    <main className="mx-auto max-w-md space-y-8 p-6">
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Edit User{username ? ` (${username})` : ""}</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Nama</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="role">Role</Label>
            <select id="role" {...roleField} onChange={handleRoleChange} className="w-full rounded border p-2">
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {selectedRole === "admin_cabang" && (
            <div className="space-y-1">
              <Label htmlFor="branch">Cabang</Label>
              <select id="branch" {...register("branch")} className="w-full rounded border p-2">
                <option value="WHO">WHO</option>
                <option value="WHP">WHP</option>
              </select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="department">Departemen</Label>
            <Input id="department" {...register("department")} />
            {errors.department && <p className="text-sm text-red-600">{errors.department.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="position">Posisi</Label>
            <Input id="position" {...register("position")} />
            {errors.position && <p className="text-sm text-red-600">{errors.position.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">Email (opsional)</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>

          {serverError && <p className="text-sm text-red-600">{serverError}</p>}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </form>
      </div>

      <div className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">Reset Password</h2>
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="newPassword">Password Baru</Label>
            <Input
              id="newPassword"
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          {passwordSuccess && <p className="text-sm text-green-600">Password berhasil direset.</p>}
          <Button type="submit" variant="outline" disabled={isResettingPassword}>
            {isResettingPassword ? "Memproses..." : "Reset Password"}
          </Button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/admin/[uid]/page.tsx"
git commit -m "feat: add edit-user and reset-password page at /admin/[uid]"
```

---

## Task 12: Nav link for superadmin

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

- [ ] **Step 1: Add the "Manajemen User" link**

In `app/(dashboard)/layout.tsx`, find this block:

```typescript
            {(appUser.role === "spv" || appUser.role === "management") && (
              <Link href="/persetujuan" className="hover:underline">
                Antrian Persetujuan
              </Link>
            )}
```

Add immediately after it (still inside the same `<div className="flex gap-4 text-sm">`):

```typescript
            {appUser.role === "superadmin" && (
              <Link href="/admin" className="hover:underline">
                Manajemen User
              </Link>
            )}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat: show Manajemen User nav link for superadmin"
```

---

## Task 13: Manual end-to-end verification (needs emulator + Java)

**Files:** none (verification only)

- [ ] **Step 1: Start the emulators**

Run: `npm --prefix functions run build` then `npx firebase emulators:start --only auth,firestore,functions --project pengajuan-kendaraan-perlengkapan`

- [ ] **Step 2: Seed and start the app**

In a second terminal: `npm run seed`
In a third terminal: `npm run dev`

- [ ] **Step 3: Log in as superadmin and reach the list**

Open `http://localhost:3000/login`, log in with username `superadmin` / password `password123`. Click "Manajemen User" in the nav.
Expected: table shows all 5 seeded users.

- [ ] **Step 4: Create a user**

Click "Buat User". Fill: nama "Test SND Baru", username "snd.test", password "password123", role "SND" (branch auto-fills to SND and the branch field is hidden), departemen "SND", posisi "Staff".
Expected: redirected to `/admin`, new row "Test SND Baru" / "snd.test" appears in the table.

- [ ] **Step 5: Log in as the new user**

Log out, log in with username `snd.test` / password `password123`.
Expected: login succeeds, redirected to `/pengajuan` (role `snd` isn't a reviewer role).

- [ ] **Step 6: Edit a user**

Log back in as `superadmin`, go to `/admin`, click "Edit" on the "Test SND Baru" row. Change posisi to "Staff Senior", submit.
Expected: redirected to `/admin`, table shows updated posisi.

- [ ] **Step 7: Reset a user's password**

On the same edit page (before leaving — reload `/admin/<uid>` if needed), enter a new password in the Reset Password form and submit.
Expected: "Password berhasil direset." message shown. Log out and confirm the new password logs in successfully for `snd.test`.

- [ ] **Step 8: Verify a non-superadmin is blocked from `/admin`**

Log in as `admin.who`, manually navigate to `http://localhost:3000/admin`.
Expected: redirected to `/pengajuan`.

- [ ] **Step 9: Run the full test suite**

Run: `npm test` (root) and `npm --prefix functions run test`
Expected: all tests pass, including the new schema tests and the 3 new Cloud Function test files.

---

## Self-Review Notes

- Spec coverage: create/edit/reset-password (Tasks 5-7, 9-11), branch-follows-role rule (Task 1's `isValidBranchForRole`, reused in the forms via `defaultBranchForRole`), username permanence (updateUserSchema has no `username` field, Task 11's form has no username input), password entered manually (Task 10's plain password field, no generation logic), no Cloud Function needed for listing (Task 9 queries Firestore directly), schema/util duplication into `functions/src` (Tasks 3-4) — all covered.
- Out-of-scope items from the spec (deactivate/delete, username editing, Auth displayName sync) have no corresponding task, as intended.
- Type consistency: `CreateUserInput`/`UpdateUserInput`/`ResetUserPasswordInput` and `isValidBranchForRole` names match between `lib/schemas/user.ts` (Task 1), `functions/src/userSchemas.ts` (Task 4), and their consumers (Tasks 5-7, 9-11). `usernameToSyntheticEmail`/`InvalidUsernameError` match between Task 3's implementation and Task 5's import.
