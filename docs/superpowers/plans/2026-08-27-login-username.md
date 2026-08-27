# Login Berbasis Username Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/password login with username/password login, per `docs/superpowers/specs/2026-08-27-login-username-design.md`.

**Architecture:** Firebase Auth stays email/password under the hood. Username is deterministically mapped to a synthetic email (`{username}@pengajuan-tsi.internal`) client-side, before calling `signInWithEmailAndPassword` — no extra network lookup, and Firebase Auth's own uniqueness constraint on email doubles as uniqueness enforcement for username. `users/{uid}.email` becomes optional/contact-only; `users/{uid}.username` is the new required field.

**Tech Stack:** TypeScript, Vitest, Firebase Auth (client SDK), firebase-admin (seed script only — no Cloud Function changes needed for this plan).

---

## File Structure

```
/lib
  /auth
    username.ts          # new — normalizeUsername, usernameToSyntheticEmail
    username.test.ts      # new
  /hooks
    useAuth.ts             # modify — AppUser.username added, email optional
/app
  /(auth)/login/page.tsx   # modify — username field instead of email field
/scripts
  seed-emulator.ts         # modify — seed users get username, add superadmin
```

`lib/auth/username.ts` is the single place username normalization/validation and the synthetic-email format live — both the login page and the seed script import from it, so the two never drift apart.

---

## Task 1: `lib/auth/username.ts` — normalization + synthetic email

**Files:**
- Create: `lib/auth/username.ts`
- Test: `lib/auth/username.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/auth/username.test.ts
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

Run: `npx vitest run lib/auth/username.test.ts`
Expected: FAIL — `Cannot find module './username'`.

- [ ] **Step 3: Write `lib/auth/username.ts`**

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

Run: `npx vitest run lib/auth/username.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/username.ts lib/auth/username.test.ts
git commit -m "feat: add username normalization and synthetic email mapping"
```

---

## Task 2: Update login page to use username

**Files:**
- Modify: `app/(auth)/login/page.tsx`

- [ ] **Step 1: Replace the email field and submit handler**

Replace the full contents of `app/(auth)/login/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import { usernameToSyntheticEmail, InvalidUsernameError } from "@/lib/auth/username";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const syntheticEmail = usernameToSyntheticEmail(username);
      const credential = await signInWithEmailAndPassword(auth, syntheticEmail, password);
      const snap = await getDoc(doc(db, "users", credential.user.uid));
      const role = snap.exists() ? (snap.data().role as string) : null;
      router.push(role === "spv" || role === "management" ? "/persetujuan" : "/pengajuan");
    } catch (err) {
      if (err instanceof InvalidUsernameError) {
        setError("Username tidak boleh kosong, mengandung spasi, atau '@'.");
      } else {
        setError("Username atau password salah.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Masuk</h1>
        <div className="space-y-1">
          <Label htmlFor="username">Username</Label>
          <Input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
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

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(auth\)/login/page.tsx
git commit -m "feat: switch login page to username instead of email"
```

---

## Task 3: Update `AppUser` type for `username` and optional `email`

**Files:**
- Modify: `lib/hooks/useAuth.ts`

- [ ] **Step 1: Update the `AppUser` type**

In `lib/hooks/useAuth.ts`, replace the `AppUser` type definition:

```typescript
export type AppUser = {
  uid: string;
  name: string;
  username: string;
  email: string | null;
  role: "admin_cabang" | "snd" | "spv" | "management" | "superadmin";
  branch: string | null;
  department: string;
  position: string;
};
```

(The rest of the file — `useAuth()` itself — is unchanged; it already spreads `snap.data()` into `AppUser`, so no logic change is needed, only the type.)

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors. If any other file constructs an `AppUser` object literal (rather than reading Firestore data), it will now fail to compile because `username` is required — check the build output for such errors and fix by adding the missing field at the call site.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/useAuth.ts
git commit -m "feat: add username to AppUser type, make email optional"
```

---

## Task 4: Update seed script — usernames + superadmin account

**Files:**
- Modify: `scripts/seed-emulator.ts`

- [ ] **Step 1: Replace the seed list and creation loop**

Replace the full contents of `scripts/seed-emulator.ts`:

```typescript
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { usernameToSyntheticEmail } from "../lib/auth/username";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = initializeApp({ projectId: "pengajuan-kendaraan-perlengkapan" });
const auth = getAuth(app);
const db = getFirestore(app);

const SEED_USERS = [
  { username: "admin.who", email: "admin.who@example.com", password: "password123", name: "Admin WHO", role: "admin_cabang", branch: "WHO", department: "Operasional", position: "Admin Cabang" },
  { username: "snd", email: "snd@example.com", password: "password123", name: "Staff SND", role: "snd", branch: "SND", department: "SND", position: "Staff" },
  { username: "spv", email: "spv@example.com", password: "password123", name: "AWS Supervisor", role: "spv", branch: null, department: "AWS", position: "Supervisor" },
  { username: "management", email: "management@example.com", password: "password123", name: "Management", role: "management", branch: null, department: "Management", position: "Manager" },
  { username: "superadmin", email: null, password: "password123", name: "Superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" },
];

async function seed() {
  for (const u of SEED_USERS) {
    const userRecord = await auth.createUser({
      email: usernameToSyntheticEmail(u.username),
      password: u.password,
      displayName: u.name,
    });
    await db.collection("users").doc(userRecord.uid).set({
      name: u.name,
      username: u.username,
      email: u.email,
      role: u.role,
      branch: u.branch,
      department: u.department,
      position: u.position,
      createdAt: new Date(),
    });
    console.log(`Seeded ${u.username} (${u.role})`);
  }
}

seed().then(() => process.exit(0));
```

- [ ] **Step 2: Run it against the emulator and verify**

Run (with the Auth + Firestore emulator already running, per `README.md`): `npm run seed`
Expected: five `Seeded <username> (<role>)` lines, including `Seeded superadmin (superadmin)`, no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-emulator.ts
git commit -m "feat: seed users by username, add superadmin seed account"
```

---

## Task 5: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the emulators**

Run: `npm --prefix functions run build` then `npx firebase emulators:start --only auth,firestore,functions --project pengajuan-kendaraan-perlengkapan`

- [ ] **Step 2: Seed and start the app**

In a second terminal: `npm run seed`
In a third terminal: `npm run dev`

- [ ] **Step 3: Log in with a username**

Open `http://localhost:3000/login`, enter username `admin.who` and password `password123`.
Expected: redirected to `/pengajuan` (not `/persetujuan`, since `admin_cabang` isn't a reviewer role).

- [ ] **Step 4: Log in with the spv account**

Log out, then log in with username `spv` and password `password123`.
Expected: redirected to `/persetujuan`.

- [ ] **Step 5: Verify wrong-password error message**

Attempt login with username `admin.who` and an incorrect password.
Expected: form shows "Username atau password salah." — no crash, no raw Firebase error text shown.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `lib/auth/username.test.ts`.

---

## Self-Review Notes

- Spec coverage: synthetic email mapping (Task 1), login page (Task 2), `AppUser` type + optional email (Task 3), seed script + superadmin account (Task 4) — all five "Perubahan kode" items from the spec are covered. Reset password and user-management UI are explicitly out of scope per the spec and are not tasked here.
- Type consistency: `usernameToSyntheticEmail` and `InvalidUsernameError` names match between Task 1's implementation and Task 2/4's imports.
