# Manajemen User tanpa Cloud Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `createUser` and `updateUser` from Cloud Functions to direct client-side calls (Auth via a secondary Firebase App instance, Firestore write guarded by Security Rules), and remove `resetUserPassword` entirely since Firebase Auth's client SDK has no way for one user to change another's password. Sub-project 4 of 5 in the Spark-plan architecture migration.

**Architecture:** `lib/users/createUser.ts` creates the Firebase Auth account via a throwaway secondary `FirebaseApp` instance (so it doesn't sign out the acting superadmin's own session), tears that instance down immediately, then writes the `users/{uid}` Firestore profile from the primary app's already-authenticated context. `lib/users/updateUser.ts` is a plain guarded Firestore write. `firestore.rules` gains a `create`/`update` rule on `users/{uid}` restricted to superadmin, with a `role`-enum check (since that field feeds the `userRole()` helper used throughout the rest of the ruleset). The "Reset Password" UI section is removed and replaced with a note pointing to the Firebase Console.

**Tech Stack:** TypeScript, Zod, Firebase client SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`), Vitest.

**Environment note:** Same constraints as every prior plan in this migration — no Java, so `@firebase/rules-unit-testing`/emulator-backed tests cannot run on this machine, and no real browser is available either. `lib/users/username.ts`'s tests are pure functions and genuinely run; everything touching Firebase Auth/Firestore is written per TDD but only verified via `npx tsc --noEmit` / `npm run build`.

---

## File Structure

```
/lib
  /users
    username.ts                 # new — ported from functions/src/username.ts
    username.test.ts              # new — ported from functions/src/username.test.ts, genuinely runs
    createUser.ts                   # new — secondary-app-instance Auth creation + Firestore profile write
    updateUser.ts                     # new — guarded Firestore update
  /schemas
    user.ts                              # modify — remove resetUserPasswordSchema/ResetUserPasswordInput
/app
  /(dashboard)
    /admin/new/page.tsx                    # modify — call lib/users/createUser instead of httpsCallable
    /admin/[uid]/page.tsx                    # modify — call lib/users/updateUser; remove Reset Password section
firestore.rules                                # modify — users/{uid} create/update rule
/tests
  firestore-rules.test.ts                        # modify — add tests for the new users/{uid} rule
/functions
  /src
    createUser.ts, .test.ts                        # delete
    updateUser.ts, .test.ts                          # delete
    resetUserPassword.ts, .test.ts                     # delete
    username.ts, .test.ts                                # delete (ported to lib/users/, no longer needed server-side)
    userSchemas.ts                                         # delete
    admin.ts                                                 # delete (used only by the 3 deleted handlers)
    index.ts                                                   # modify — emptied out, no callables remain
```

---

## Task 1: Port `username.ts` to the client

**Files:**
- Create: `lib/users/username.ts`
- Create: `lib/users/username.test.ts`

- [ ] **Step 1: Write `lib/users/username.ts`**

Verbatim copy of `functions/src/username.ts` — pure functions, no Node-specific APIs:

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

- [ ] **Step 2: Write `lib/users/username.test.ts`**

Verbatim copy of `functions/src/username.test.ts`, importing from the new location:

```typescript
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

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run lib/users/username.test.ts`
Expected: 6/6 tests pass (no DOM/Firebase dependency — genuinely runs).

- [ ] **Step 4: Commit**

```bash
git add lib/users/username.ts lib/users/username.test.ts
git commit -m "feat: port username normalization to the client"
```

---

## Task 2: Remove `resetUserPasswordSchema` from the client schema

**Files:**
- Modify: `lib/schemas/user.ts`

- [ ] **Step 1: Remove the reset-password schema**

Current end of `lib/schemas/user.ts`:
```typescript
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  uid: z.string().min(1),
  newPassword: z.string().min(6, "Password minimal 6 karakter"),
});

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
```

Remove the last two exports, leaving:
```typescript
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

Nothing else in this file changes — `roleSchema`, `branchSchema`, `isValidBranchForRole`, `createUserSchema`/`CreateUserInput`, `updateUserSchema`/`UpdateUserInput` all stay exactly as-is (still used by the forms and by `lib/users/createUser.ts`/`updateUser.ts`, added in later tasks).

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors (confirms nothing else in the codebase currently imports `resetUserPasswordSchema`/`ResetUserPasswordInput` — if this fails, STOP and report back rather than guessing a fix, since it would mean something unexpected still depends on the removed export).

- [ ] **Step 3: Commit**

```bash
git add lib/schemas/user.ts
git commit -m "chore: remove resetUserPasswordSchema, feature is being discontinued"
```

---

## Task 3: Add `users/{uid}` create/update rule to `firestore.rules`

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Replace the `users/{uid}` match block in `firestore.rules`**

Current block:
```
    match /users/{uid} {
      allow read: if isSignedIn() && (request.auth.uid == uid || userRole() in ['spv', 'management', 'superadmin']);
      allow write: if false;
    }
```

Replace with:
```
    match /users/{uid} {
      allow read: if isSignedIn() && (request.auth.uid == uid || userRole() in ['spv', 'management', 'superadmin']);
      allow create, update: if isSignedIn()
        && userRole() == 'superadmin'
        && request.resource.data.role in ['admin_cabang', 'snd', 'spv', 'management', 'superadmin'];
      allow delete: if false;
    }
```

The `role in [...]` check stays in rules (not left to client-side Zod alone) because this field feeds the `userRole()` helper used throughout the rest of the ruleset — an invalid value here risks corrupting rule evaluation elsewhere, a different class of risk than an ordinary data-quality field like `department`/`position`. The `branch`-matches-`role` consistency check (`isValidBranchForRole`) is intentionally NOT replicated here — only superadmin can ever write to this collection at all, so there's no cross-user risk, just a data-quality concern already covered by client-side Zod, consistent with this migration's established "rules enforce authorization, not full data quality" approach.

Nothing else in `firestore.rules` changes.

- [ ] **Step 2: Add the new test cases to `tests/firestore-rules.test.ts`**

Add this new `describe` block inside the top-level `describe("firestore.rules", ...)`, after the existing `describe("users rule", ...)` block:

```typescript
  describe("users write rule", () => {
    it("allows superadmin to create a new user", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("users").doc("uid-new").set({
          name: "User Baru",
          username: "user.baru",
          role: "admin_cabang",
          branch: "WHO",
          department: "Operasional",
          position: "Admin Cabang",
          email: null,
        })
      );
    });

    it("allows superadmin to update an existing user", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("users").doc("uid-admin").update({
          name: "Budi Santoso Updated",
          role: "admin_cabang",
          branch: "WHP",
          department: "Operasional",
          position: "Admin Cabang",
          email: null,
        })
      );
    });

    it("denies a non-superadmin from creating a user", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("users").doc("uid-new2").set({
          name: "User Baru",
          username: "user.baru2",
          role: "admin_cabang",
          branch: "WHO",
          department: "Operasional",
          position: "Admin Cabang",
          email: null,
        })
      );
    });

    it("denies creating a user with an invalid role value", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertFails(
        db.collection("users").doc("uid-new3").set({
          name: "User Baru",
          username: "user.baru3",
          role: "not_a_real_role",
          branch: null,
          department: "Operasional",
          position: "Staff",
          email: null,
        })
      );
    });

    it("denies any client from deleting a user", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertFails(db.collection("users").doc("uid-admin").delete());
    });
  });
```

- [ ] **Step 3 (SKIP — needs emulator, no Java on this machine):** would normally run `npx vitest run tests/firestore-rules.test.ts` here. Skip — write the tests, don't run them. Manually trace each new test against the rule logic to sanity-check correctness before moving on (see this task's self-review note below).

- [ ] **Step 4: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: allow superadmin to create/update users directly from the client"
```

---

## Task 4: `lib/users/createUser.ts`

**Files:**
- Create: `lib/users/createUser.ts`

- [ ] **Step 1: Write `lib/users/createUser.ts`**

```typescript
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, firebaseApp } from "@/lib/firebase/client";
import { createUserSchema, CreateUserInput } from "@/lib/schemas/user";
import { normalizeUsername, usernameToSyntheticEmail } from "./username";
import type { AppUser } from "@/lib/hooks/useAuth";

export type CreateUserResult = { uid: string; username: string };

export async function createUser(rawInput: unknown, caller: AppUser): Promise<CreateUserResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat user.");
  }

  const parsed = createUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateUserInput = parsed.data;
  const normalizedUsername = normalizeUsername(input.username);

  // createUserWithEmailAndPassword signs in as the newly-created user on
  // whichever app instance it's called on — using a throwaway secondary
  // FirebaseApp instance (same project config, different app name) keeps
  // that from replacing the acting superadmin's own session on the primary
  // app instance used everywhere else in this codebase.
  const secondaryApp = initializeApp(firebaseApp.options, `secondary-user-creation-${crypto.randomUUID()}`);
  const secondaryAuth = getAuth(secondaryApp);

  let uid: string;
  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      usernameToSyntheticEmail(input.username),
      input.password
    );
    uid = credential.user.uid;
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "auth/email-already-in-use") {
      throw new Error("Username sudah dipakai.");
    }
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }

  try {
    await setDoc(doc(db, "users", uid), {
      name: input.name,
      username: normalizedUsername,
      email: input.email ?? null,
      role: input.role,
      branch: input.branch,
      department: input.department,
      position: input.position,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    throw new Error(
      `Akun login untuk "${normalizedUsername}" berhasil dibuat, tapi profil usernya gagal tersimpan (uid: ${uid}). Hubungi admin untuk pengecekan manual.`,
      { cause: error }
    );
  }

  return { uid, username: normalizedUsername };
}
```

Note the client SDK's error code for a duplicate email on `createUserWithEmailAndPassword` is `"auth/email-already-in-use"` — this is different from the Admin SDK's `"auth/email-already-exists"` used in the now-being-deleted `functions/src/createUser.ts`. Get this exact string right; it's easy to copy the wrong one from the old server-side code.

This function depends on Firebase Auth/a real browser environment (the secondary `FirebaseApp`/`Auth` instance dance) so it cannot be run or verified on this machine — written to spec, no test file for this task, matching the precedent set by `uploadToDriveClient` (sub-project 1) and `generateSubmissionPdfClient` (sub-project 3).

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/users/createUser.ts
git commit -m "feat: add client-side createUser via secondary Firebase App instance"
```

---

## Task 5: `lib/users/updateUser.ts`

**Files:**
- Create: `lib/users/updateUser.ts`

- [ ] **Step 1: Write `lib/users/updateUser.ts`**

```typescript
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateUserSchema, UpdateUserInput } from "@/lib/schemas/user";
import type { AppUser } from "@/lib/hooks/useAuth";

export type UpdateUserResult = { uid: string };

export async function updateUser(rawInput: unknown, caller: AppUser): Promise<UpdateUserResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah user.");
  }

  const parsed = updateUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateUserInput = parsed.data;

  const userRef = doc(db, "users", input.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error("User tidak ditemukan.");
  }

  await updateDoc(userRef, {
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

This function needs a live Firestore connection to run meaningfully — cannot be tested on this machine. Written to spec, no test file for this task.

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/users/updateUser.ts
git commit -m "feat: add client-side updateUser"
```

---

## Task 6: Rewire `app/(dashboard)/admin/new/page.tsx`

**Files:**
- Modify: `app/(dashboard)/admin/new/page.tsx`

- [ ] **Step 1: Update the imports**

Remove:
```typescript
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";
```
and the module-level emulator bootstrap block:
```typescript
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
```

Add:
```typescript
import { createUser } from "@/lib/users/createUser";
```

`useAuth` is already imported and used in this file (`const { appUser, loading } = useAuth();`) — no change needed there, and `firebaseApp` was only imported for the emulator bootstrap block, so it's fully removed, not replaced with anything.

- [ ] **Step 2: Update `onSubmit`**

Current:
```typescript
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
```

Replace with:
```typescript
  async function onSubmit(data: CreateUserInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await createUser({ ...data, email: data.email || null }, appUser);
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat user.");
    }
  }
```

Everything else in the file (the form, `useForm`, role/branch fields) is unchanged.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build` (temporarily `cp .env.local.example .env.local` if needed for the prerender stage, delete it afterward, confirm `git status` shows it untracked).
Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/admin/new/page.tsx"
git commit -m "feat: create users directly from the client instead of via Cloud Function"
```

---

## Task 7: Rewire `app/(dashboard)/admin/[uid]/page.tsx` and remove Reset Password

**Files:**
- Modify: `app/(dashboard)/admin/[uid]/page.tsx`

- [ ] **Step 1: Update the imports**

Remove:
```typescript
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { db, firebaseApp } from "@/lib/firebase/client";
```
and the module-level emulator bootstrap block (same shape as Task 6).

Replace that import line with:
```typescript
import { db } from "@/lib/firebase/client";
```
(keep `db`, drop `firebaseApp` — it was only used for the emulator bootstrap).

Add:
```typescript
import { updateUser } from "@/lib/users/updateUser";
```

- [ ] **Step 2: Remove the Reset Password state**

Delete these 4 lines from the `useState` declarations:
```typescript
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
```

- [ ] **Step 3: Update `onSubmit`, delete `handleResetPassword`**

Current `onSubmit`:
```typescript
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
```

Replace with:
```typescript
  async function onSubmit(data: UpdateUserInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await updateUser({ ...data, email: data.email || null }, appUser);
      router.push("/admin");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah user.");
    }
  }
```

Delete the entire `handleResetPassword` function that currently follows it:
```typescript
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
```

- [ ] **Step 4: Replace the Reset Password JSX block**

Current:
```tsx
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
```

Replace with:
```tsx
      <div className="space-y-2 border-t pt-6">
        <h2 className="text-lg font-semibold">Reset Password</h2>
        <p className="text-sm text-muted-foreground">
          Reset password tidak bisa dilakukan lewat aplikasi ini. Gunakan tab Authentication di Firebase Console
          untuk mereset password user.
        </p>
      </div>
```

Everything else in the file (the load-user `useEffect`, the edit form itself, the route guard) is unchanged.

- [ ] **Step 5: Verify it compiles**

Run: `npm run build` (same `.env.local` fallback as Task 6 if needed).
Expected: build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/admin/[uid]/page.tsx"
git commit -m "feat: update users directly from the client; remove Reset Password feature"
```

---

## Task 8: Remove the now-dead Cloud Functions and their dependencies

**Files:**
- Delete: `functions/src/createUser.ts`, `functions/src/createUser.test.ts`
- Delete: `functions/src/updateUser.ts`, `functions/src/updateUser.test.ts`
- Delete: `functions/src/resetUserPassword.ts`, `functions/src/resetUserPassword.test.ts`
- Delete: `functions/src/username.ts`, `functions/src/username.test.ts`
- Delete: `functions/src/userSchemas.ts`
- Delete: `functions/src/admin.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Delete the 9 files**

```bash
git rm functions/src/createUser.ts functions/src/createUser.test.ts
git rm functions/src/updateUser.ts functions/src/updateUser.test.ts
git rm functions/src/resetUserPassword.ts functions/src/resetUserPassword.test.ts
git rm functions/src/username.ts functions/src/username.test.ts
git rm functions/src/userSchemas.ts
git rm functions/src/admin.ts
```

`functions/src/admin.ts` (the Admin SDK init module) is safe to delete here — confirmed by grep before writing this plan that it's imported ONLY by `createUser.ts`, `updateUser.ts`, and `resetUserPassword.ts`, all being deleted in this same step. Once those are gone, nothing in `functions/src/` references it.

- [ ] **Step 2: Replace `functions/src/index.ts` with an empty file**

```typescript
// Semua Cloud Functions sudah dipindah ke client-side (lihat lib/submissions/,
// lib/pdf/, lib/users/). File ini sengaja kosong -- firebase deploy tetap
// valid dijalankan terhadap index.ts tanpa export function sama sekali.
```

This is the last Cloud Function to go — after this, `functions/src/` contains only this one placeholder file. Fully removing the `functions/` directory's scaffolding (package.json, firebase.json config, etc.) is explicitly sub-project 5's job, not this one.

- [ ] **Step 3: Verify the functions project still type-checks**

Run: `npm --prefix functions run build`.
Expected: succeeds, no type errors.

- [ ] **Step 4: Verify the whole repo type-checks**

Run: `npx tsc --noEmit` from repo root.
Expected: no output, no errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "chore: remove Cloud Functions now replaced by client-side user management"
```

(The 9 deletions from Step 1's `git rm` are already staged and must be part of this same commit — verify via `git status` before committing that all 10 changes, 9 deletions plus the 1 modification, are staged together.)

---

## Task 9: Manual end-to-end verification (needs browser + emulator — cannot run on this machine)

**Files:** none (verification only)

- [ ] **Step 1: Once a real browser and Java/emulator are available, verify manually**

As superadmin, create a new user (confirm the created user can log in with their username/password, confirm the superadmin's own session is untouched throughout — no unexpected sign-out or redirect during the creation flow), then edit that user's role/branch/department/position and confirm the change persists. Try creating a user with a duplicate username and confirm the friendly "Username sudah dipakai." message appears rather than a raw Firebase error. Confirm the "Reset Password" section on the edit page now shows the Firebase-Console-redirect note instead of a form. As a non-superadmin, confirm `/admin`, `/admin/new`, and `/admin/[uid]` all redirect away (existing route-guard behavior, unchanged by this plan, but worth re-confirming nothing regressed).

---

## Self-Review Notes

- Spec coverage: secondary-Firebase-App-instance trick for `createUser` (with immediate teardown), plain guarded Firestore write for `updateUser`, full removal of `resetUserPassword` (Cloud Function, schema, UI section, replaced with a Firebase Console pointer), the `users/{uid}` rules change (superadmin-only, `role`-enum check, no `branch`-consistency replication per the established "authorization not data quality" philosophy), full deletion of `functions/src/createUser.ts`/`updateUser.ts`/`resetUserPassword.ts`/`username.ts`/`userSchemas.ts`/`admin.ts` and emptying `index.ts` — all covered.
- Type consistency: `CreateUserResult`/`UpdateUserResult` (Task 4/5) match how Task 6/7's pages use them (`await createUser(...)`/`await updateUser(...)`, return values not otherwise consumed beyond the `router.push`). `createUserSchema`/`CreateUserInput` and `updateUserSchema`/`UpdateUserInput` (Task 2, unmodified aside from the `resetUserPasswordSchema` removal) are imported identically in Task 4/5 and in the two page components — no drift. `normalizeUsername`/`usernameToSyntheticEmail` (Task 1) signatures match exactly how Task 4 calls them.
- The `firestore.rules` field written by `lib/users/createUser.ts`'s `setDoc` (Task 4: `name`, `username`, `email`, `role`, `branch`, `department`, `position`, `createdAt`) and `lib/users/updateUser.ts`'s `updateDoc` (Task 5: `name`, `role`, `branch`, `department`, `position`, `email`) both satisfy the new rule's only real constraint (`role in [...]`, caller is superadmin) — no `hasOnly()` restriction was added for this collection, a deliberate choice (see Task 3) since superadmin is already the most-trusted role in the app and there's no second, narrower-purpose actor to protect against here, unlike the `submissions` rules.
- The `auth/email-already-in-use` (client SDK) vs. `auth/email-already-exists` (Admin SDK) error-code distinction is called out explicitly in Task 4, since copying the wrong one from the deleted server-side code would silently break the duplicate-username error message.
