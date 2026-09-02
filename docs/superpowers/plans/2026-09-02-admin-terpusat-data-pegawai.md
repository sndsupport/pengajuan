# Admin Terpusat + Data Master Pegawai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace roles `admin_cabang`/`snd` with a single centralized `admin` role that creates submissions on behalf of employees picked from a new `employees` master-data collection, instead of staff self-submitting.

**Architecture:** One role-enum change ripples through `lib/schemas`, `firestore.rules`, and the submission-creation modules. A new `employees` Firestore collection (managed by `superadmin`) supplies `branch`/`department`/`position`/`name` that used to come from the submitter's own profile. `requesterId` keeps meaning "who is authenticated and owns follow-up actions" (now always the admin); a new denormalized `employeeName` field means "whose request this is" for display/PDF purposes.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Zod, React Hook Form, Firestore client SDK, `@firebase/rules-unit-testing`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-admin-terpusat-data-pegawai-design.md`

---

### Task 1: Employee schema

**Files:**
- Create: `lib/schemas/employee.ts`
- Test: `lib/schemas/employee.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/schemas/employee.test.ts
import { describe, it, expect } from "vitest";
import { createEmployeeSchema, updateEmployeeSchema } from "./employee";

describe("createEmployeeSchema", () => {
  const valid = { name: "Rahmat Hidayat", branch: "WHO" as const, department: "Operasional", position: "Staff Gudang" };

  it("accepts a valid payload", () => {
    expect(createEmployeeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects an invalid branch", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, branch: "JKT" }).success).toBe(false);
  });

  it("rejects an empty department", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, department: "" }).success).toBe(false);
  });

  it("rejects an empty position", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, position: "" }).success).toBe(false);
  });
});

describe("updateEmployeeSchema", () => {
  it("requires an id in addition to the base fields", () => {
    const result = updateEmployeeSchema.safeParse({
      name: "Rahmat Hidayat",
      branch: "WHO",
      department: "Operasional",
      position: "Staff Gudang",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload with id", () => {
    const result = updateEmployeeSchema.safeParse({
      id: "emp-1",
      name: "Rahmat Hidayat",
      branch: "WHO",
      department: "Operasional",
      position: "Staff Gudang",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/employee.test.ts`
Expected: FAIL — `Cannot find module './employee'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/schemas/employee.ts
import { z } from "zod";

export const createEmployeeSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  branch: z.enum(["WHO", "WHP", "SND"]),
  department: z.string().min(1, "Departemen wajib diisi"),
  position: z.string().min(1, "Posisi wajib diisi"),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.extend({
  id: z.string().min(1),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/employee.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/employee.ts lib/schemas/employee.test.ts
git commit -m "feat: add employee schema"
```

---

### Task 2: Replace admin_cabang/snd with a single admin role

**Files:**
- Modify: `lib/schemas/user.ts`
- Modify: `lib/schemas/user.test.ts`

- [ ] **Step 1: Update the schema**

In `lib/schemas/user.ts`, replace the whole file with:

```ts
import { z } from "zod";

export const roleSchema = z.enum(["admin", "spv", "management", "superadmin"]);
export type Role = z.infer<typeof roleSchema>;

export const branchSchema = z.enum(["WHO", "WHP", "SND"]).nullable();

export function isValidBranchForRole(_role: Role, branch: string | null): boolean {
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
    username: z
      .string()
      .min(1, "Username wajib diisi")
      .refine((v) => !/\s/.test(v) && !v.includes("@"), {
        message: "Username tidak boleh mengandung spasi atau '@'.",
      }),
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
```

(`isValidBranchForRole` keeps the `role` parameter for call-site compatibility, but every valid role now requires a `null` branch, so the body no longer branches on it.)

- [ ] **Step 2: Update the tests**

Replace `lib/schemas/user.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { createUserSchema, updateUserSchema, isValidBranchForRole } from "./user";

describe("isValidBranchForRole", () => {
  it("requires null branch for every role", () => {
    expect(isValidBranchForRole("admin", null)).toBe(true);
    expect(isValidBranchForRole("admin", "WHO")).toBe(false);
    expect(isValidBranchForRole("spv", null)).toBe(true);
    expect(isValidBranchForRole("spv", "WHO")).toBe(false);
    expect(isValidBranchForRole("management", null)).toBe(true);
    expect(isValidBranchForRole("superadmin", null)).toBe(true);
  });
});

describe("createUserSchema", () => {
  const valid = {
    name: "Admin Utama",
    username: "admin",
    password: "password123",
    role: "admin" as const,
    branch: null,
    department: "GA",
    position: "Admin",
  };

  it("accepts a valid admin payload", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-null branch for admin", () => {
    expect(createUserSchema.safeParse({ ...valid, branch: "WHO" }).success).toBe(false);
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

  it("rejects a username containing a space", () => {
    expect(createUserSchema.safeParse({ ...valid, username: "admin cabang" }).success).toBe(false);
  });

  it("rejects a username containing @", () => {
    expect(createUserSchema.safeParse({ ...valid, username: "admin@cabang" }).success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  const valid = {
    uid: "abc",
    name: "Admin Utama",
    role: "admin" as const,
    branch: null,
    department: "GA",
    position: "Admin",
  };

  it("accepts a valid payload without username or password fields", () => {
    expect(updateUserSchema.safeParse(valid).success).toBe(true);
  });

  it("strips an unexpected username field rather than accepting it", () => {
    const result = updateUserSchema.safeParse({ ...valid, username: "should-be-ignored" });
    expect(result.success).toBe(true);
    expect(result.success && "username" in result.data).toBe(false);
  });

  it("rejects a non-null branch for admin", () => {
    expect(updateUserSchema.safeParse({ ...valid, branch: "WHO" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run lib/schemas/user.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/user.ts lib/schemas/user.test.ts
git commit -m "feat: replace admin_cabang/snd roles with a single centralized admin role"
```

---

### Task 3: Update AppUser type

**Files:**
- Modify: `lib/hooks/useAuth.ts:8-17`

- [ ] **Step 1: Edit the role union**

In `lib/hooks/useAuth.ts`, change:

```ts
  role: "admin_cabang" | "snd" | "spv" | "management" | "superadmin";
```

to:

```ts
  role: "admin" | "spv" | "management" | "superadmin";
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: New errors appear in every file still referencing `"admin_cabang"`/`"snd"` — that's expected; each is fixed in a later task. Confirm this file itself introduces no new error at line 13.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/useAuth.ts
git commit -m "feat: update AppUser role type for centralized admin role"
```

---

### Task 4: Add employeeId to submission schemas

**Files:**
- Modify: `lib/schemas/submission.ts:34-50` (operational) and `lib/schemas/submission.ts:104-116` (personalia)
- Modify: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Edit `createSubmissionSchema`**

In `lib/schemas/submission.ts`, change:

```ts
export const createSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    type: submissionTypeSchema,
    subType: z.string(),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1, "Minimal 1 item"),
    attachments: z.array(attachmentSchema).default([]),
  })
```

to:

```ts
export const createSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    type: submissionTypeSchema,
    subType: z.string(),
    employeeId: z.string().min(1, "Pegawai wajib dipilih"),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1, "Minimal 1 item"),
    attachments: z.array(attachmentSchema).default([]),
  })
```

- [ ] **Step 2: Edit `createPersonaliaSubmissionSchema`**

Change:

```ts
export const createPersonaliaSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    subType: personaliaSubTypeSchema,
    employeeName: z.string().min(1, "Nama karyawan wajib diisi"),
    periodStart: z.string().min(1, "Tanggal mulai wajib diisi"),
    periodEnd: z.string().min(1, "Tanggal selesai wajib diisi"),
    attachment: attachmentSchema,
  })
```

to:

```ts
export const createPersonaliaSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    subType: personaliaSubTypeSchema,
    employeeId: z.string().nullish(),
    employeeName: z.string().min(1, "Nama karyawan wajib diisi"),
    periodStart: z.string().min(1, "Tanggal mulai wajib diisi"),
    periodEnd: z.string().min(1, "Tanggal selesai wajib diisi"),
    attachment: attachmentSchema,
  })
```

(`employeeId` is required for the operational schema — only `admin` submits those now — but optional for personalia, since `spv` still self-submits cuti/izin without picking from the employee list.)

- [ ] **Step 3: Update the tests**

In `lib/schemas/submission.test.ts`:

Change the top-level `validPayload` (used by most `createSubmissionSchema` tests via spread) from:

```ts
  const validPayload = {
    type: "kendaraan" as const,
    subType: "service_berkala" as const,
    requesterSignatureUrl: "https://storage.example.com/sig.png",
    items: [
      { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service 40rb km" },
    ],
  };
```

to:

```ts
  const validPayload = {
    type: "kendaraan" as const,
    subType: "service_berkala" as const,
    employeeId: "emp-1",
    requesterSignatureUrl: "https://storage.example.com/sig.png",
    items: [
      { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service 40rb km" },
    ],
  };
```

Add a new test right after `"rejects an empty items array"`:

```ts
  it("rejects a missing employeeId", () => {
    const { employeeId, ...rest } = validPayload;
    expect(createSubmissionSchema.safeParse(rest).success).toBe(false);
  });
```

In the `"allows km to be null for perlengkapan"` test, add `employeeId: "emp-1"` to its inline payload:

```ts
  it("allows km to be null for perlengkapan", () => {
    const payload = {
      type: "perlengkapan" as const,
      subType: "pengadaan_baru" as const,
      employeeId: "emp-1",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "Kertas A4", brandType: "Sinar Dunia", km: null, quantity: 10, unit: "rim", description: "" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });
```

In the `"gedung_fasilitas"` describe block, add `employeeId: "emp-1"` to the valid payload:

```ts
  it("accepts a valid gedung_fasilitas payload without km", () => {
    const payload = {
      type: "gedung_fasilitas" as const,
      subType: "perbaikan" as const,
      employeeId: "emp-1",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "AC ruang meeting", brandType: "Daikin 1PK", km: null, quantity: 1, unit: "unit", description: "Bocor freon" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });
```

Leave the other gedung_fasilitas/personalia-rejection tests as-is (they assert `success: false` for reasons unrelated to `employeeId`, so they stay valid either way).

In the `createPersonaliaSubmissionSchema` describe block, add a new test after `"accepts a valid cuti payload"`:

```ts
  it("accepts employeeId when provided (admin picking from master data)", () => {
    const result = createPersonaliaSubmissionSchema.safeParse({ ...validPayload, employeeId: "emp-1" });
    expect(result.success).toBe(true);
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add employeeId to submission schemas"
```

---

### Task 5: Employee CRUD modules

**Files:**
- Create: `lib/employees/createEmployee.ts`
- Create: `lib/employees/updateEmployee.ts`

(No dedicated unit tests — same as `lib/users/createUser.ts`/`updateUser.ts`, these write to Firestore via the client SDK and are covered by the Firestore-rules emulator tests in Task 7 plus manual QA in Task 20, not unit tests.)

- [ ] **Step 1: Write `createEmployee.ts`**

```ts
// lib/employees/createEmployee.ts
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createEmployeeSchema, CreateEmployeeInput } from "@/lib/schemas/employee";
import type { AppUser } from "@/lib/hooks/useAuth";

export type CreateEmployeeResult = { id: string };

export async function createEmployee(rawInput: unknown, caller: AppUser): Promise<CreateEmployeeResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat data pegawai.");
  }

  const parsed = createEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateEmployeeInput = parsed.data;

  const ref = await addDoc(collection(db, "employees"), {
    name: input.name,
    branch: input.branch,
    department: input.department,
    position: input.position,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id };
}
```

- [ ] **Step 2: Write `updateEmployee.ts`**

```ts
// lib/employees/updateEmployee.ts
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateEmployeeSchema, UpdateEmployeeInput } from "@/lib/schemas/employee";
import type { AppUser } from "@/lib/hooks/useAuth";

export type UpdateEmployeeResult = { id: string };

export async function updateEmployee(rawInput: unknown, caller: AppUser): Promise<UpdateEmployeeResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah data pegawai.");
  }

  const parsed = updateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateEmployeeInput = parsed.data;

  const ref = doc(db, "employees", input.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Data pegawai tidak ditemukan.");
  }

  await updateDoc(ref, {
    name: input.name,
    branch: input.branch,
    department: input.department,
    position: input.position,
  });

  return { id: input.id };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/employees/createEmployee.ts lib/employees/updateEmployee.ts
git commit -m "feat: add employee CRUD modules"
```

---

### Task 6: Firestore rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Collapse `isRequesterRole()` to the single admin role**

Change:

```
    function isRequesterRole() {
      return isSignedIn() && userRole() in ['admin_cabang', 'snd'];
    }
```

to:

```
    function isRequesterRole() {
      return isSignedIn() && userRole() == 'admin';
    }
```

This one change propagates correctly to every rule that calls `isRequesterRole()` (submissions create, items/attachments create via the parent submission's requesterId, counters).

- [ ] **Step 2: Update the valid role list on `users`**

Change:

```
      allow create, update: if isSignedIn()
        && userRole() == 'superadmin'
        && request.resource.data.role in ['admin_cabang', 'snd', 'spv', 'management', 'superadmin'];
```

to:

```
      allow create, update: if isSignedIn()
        && userRole() == 'superadmin'
        && request.resource.data.role in ['admin', 'spv', 'management', 'superadmin'];
```

- [ ] **Step 3: Add rules for the new `employees` collection**

Insert a new `match` block right after the `users/{uid}` block closes (i.e. right before `match /submissions/{submissionId} {`):

```
    match /employees/{employeeId} {
      allow read: if isSignedIn() && userRole() in ['admin', 'superadmin'];
      allow create, update: if isSignedIn() && userRole() == 'superadmin';
      allow delete: if false;
    }

```

- [ ] **Step 4: Widen the resubmit `hasOnly` for operational submissions**

Change:

```
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'perlu_revisi'
          && request.resource.data.status == 'diajukan'
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['type', 'subType', 'requesterSignatureUrl', 'status', 'rejectionNote']))
```

to:

```
        (resource.data.requesterId == request.auth.uid
          && resource.data.status == 'perlu_revisi'
          && request.resource.data.status == 'diajukan'
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['type', 'subType', 'employeeId', 'employeeName', 'branch', 'department', 'position', 'requesterSignatureUrl', 'status', 'rejectionNote']))
```

- [ ] **Step 5: Widen the resubmit `hasOnly` for personalia submissions**

Change:

```
          && (userRole() != 'spv' || request.resource.data.subType in ['cuti', 'izin'])
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['subType', 'employeeName', 'periodStart', 'periodEnd', 'status', 'rejectionNote', 'spvApproval', 'managerApproval']))
```

to:

```
          && (userRole() != 'spv' || request.resource.data.subType in ['cuti', 'izin'])
          && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['subType', 'employeeId', 'employeeName', 'branch', 'department', 'position', 'periodStart', 'periodEnd', 'status', 'rejectionNote', 'spvApproval', 'managerApproval']))
```

- [ ] **Step 6: Commit**

```bash
git add firestore.rules
git commit -m "feat: update firestore rules for centralized admin role and employees collection"
```

(Rules are exercised by Task 7's emulator tests — nothing to run standalone here.)

---

### Task 7: Update Firestore rules tests

**Files:**
- Modify: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Replace the old role-value literals**

Using find-and-replace across the whole file:

1. Replace every bare occurrence of `admin_cabang` with `admin` (this hits both `role: "admin_cabang"` / `approverRole: "admin_cabang"` / `actorRole: "admin_cabang"` value assignments AND a few test-title strings that mention it in prose — both are fine to update this way, 11 occurrences total).
2. Replace every occurrence of the quoted literal `"snd"` (with the surrounding quotes) with `"admin"` — this must use the **quoted** form, not a bare `snd` replace, because the seeded test user id `uid-snd` also contains the substring `snd` and must NOT be touched (only 2 occurrences: `role: "snd"` and `actorRole: "snd"`).

- [ ] **Step 2: Clean up three test titles left slightly awkward by the bare replace**

Change:

```ts
    it("allows an admin/snd user to create a submission as themselves in status diajukan", async () => {
```

to:

```ts
    it("allows an admin user to create a submission as themselves in status diajukan", async () => {
```

Change:

```ts
    it("denies create when the caller's role is not admin/snd", async () => {
```

to:

```ts
    it("denies create when the caller's role is not admin", async () => {
```

Change:

```ts
    it("allows an admin/snd user to create a new counter at 1", async () => {
```

to:

```ts
    it("allows an admin user to create a new counter at 1", async () => {
```

- [ ] **Step 3: Add tests for the new `employees` collection**

Insert this new `describe` block right before the final closing `});` of the outer `describe("firestore.rules", ...)` block (i.e. after the `describe("submissions update rule — resubmit personalia after rejection", ...)` block's closing `});`):

```ts
  describe("employees rules", () => {
    it("allows admin to read employees", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").get());
    });

    it("allows superadmin to read employees", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").get());
    });

    it("denies spv from reading employees", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(db.collection("employees").doc("emp-1").get());
    });

    it("denies admin from creating an employee", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("employees").doc("emp-2").set({
          name: "Siti Aminah",
          branch: "WHP",
          department: "Operasional",
          position: "Staff Gudang",
        })
      );
    });

    it("allows superadmin to create an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("employees").doc("emp-2").set({
          name: "Siti Aminah",
          branch: "WHP",
          department: "Operasional",
          position: "Staff Gudang",
        })
      );
    });

    it("allows superadmin to update an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").update({ position: "Kepala Gudang" }));
    });

    it("denies any client from deleting an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertFails(db.collection("employees").doc("emp-1").delete());
    });
  });
```

- [ ] **Step 4: Run the emulator test suite**

Requires Java 21+ on PATH (see `CLAUDE.md` "Local Dev" note for the portable-JDK path if not installed).

Run: `firebase emulators:exec --only firestore "npx vitest run tests/firestore-rules.test.ts"`
Expected: All tests PASS, including the 7 new `employees rules` tests.

- [ ] **Step 5: Commit**

```bash
git add tests/firestore-rules.test.ts
git commit -m "test: update firestore rules tests for centralized admin role and employees collection"
```

---

### Task 8: submitSubmission.ts — derive branch/department/position from the picked employee

**Files:**
- Modify: `lib/submissions/submitSubmission.ts`

- [ ] **Step 1: Edit `createNewSubmission`**

Change:

```ts
async function createNewSubmission(input: CreateSubmissionInput, caller: AppUser): Promise<SubmitSubmissionResult> {
  // NOTE: unlike the old Cloud Function (server clock, trustworthy), this now runs
  // client-side — a misconfigured device clock/timezone could stamp the wrong
  // month/year on submissionNumber. Accepted risk: no cheap way to get a trusted
  // server time synchronously before the counter transaction without Cloud Functions.
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
```

to:

```ts
async function createNewSubmission(input: CreateSubmissionInput, caller: AppUser): Promise<SubmitSubmissionResult> {
  const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
  const employee = employeeSnap.data();
  if (!employee) {
    throw new Error("Data pegawai tidak ditemukan.");
  }

  // NOTE: unlike the old Cloud Function (server clock, trustworthy), this now runs
  // client-side — a misconfigured device clock/timezone could stamp the wrong
  // month/year on submissionNumber. Accepted risk: no cheap way to get a trusted
  // server time synchronously before the counter transaction without Cloud Functions.
  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, employee.branch, now.getFullYear(), now.getMonth() + 1);

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
    employeeId: input.employeeId,
    employeeName: employee.name,
    requesterSignatureUrl: input.requesterSignatureUrl,
    approverId: null,
    approverRole: null,
    approverSignatureUrl: null,
    branch: employee.branch,
    department: employee.department,
    position: employee.position,
    rejectionNote: null,
    pdfUrl: null,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    approvedAt: null,
    sentToGaAt: null,
    completedAt: null,
  });
```

- [ ] **Step 2: Edit `resubmitAfterRevisi`**

Change:

```ts
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
```

to:

```ts
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

  const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
  const employee = employeeSnap.data();
  if (!employee) {
    throw new Error("Data pegawai tidak ditemukan.");
  }

  const existingItemsSnap = await getDocs(collection(submissionRef, "items"));
```

And change:

```ts
  batch.update(submissionRef, {
    type: input.type,
    subType: input.subType,
    requesterSignatureUrl: input.requesterSignatureUrl,
    status: "diajukan",
    rejectionNote: null,
  });
```

to:

```ts
  batch.update(submissionRef, {
    type: input.type,
    subType: input.subType,
    employeeId: input.employeeId,
    employeeName: employee.name,
    branch: employee.branch,
    department: employee.department,
    position: employee.position,
    requesterSignatureUrl: input.requesterSignatureUrl,
    status: "diajukan",
    rejectionNote: null,
  });
```

- [ ] **Step 3: Commit**

```bash
git add lib/submissions/submitSubmission.ts
git commit -m "feat: derive submission branch/department/position from picked employee"
```

(No dedicated unit test file exists for this module today — coverage comes from Task 7's rules tests plus the manual QA pass in Task 20.)

---

### Task 9: submitPersonaliaSubmission.ts — admin picks an employee, spv keeps self-submit

**Files:**
- Modify: `lib/submissions/submitPersonaliaSubmission.ts`

- [ ] **Step 1: Update `ALLOWED_ROLES_BY_SUBTYPE`**

Change:

```ts
const ALLOWED_ROLES_BY_SUBTYPE: Record<CreatePersonaliaSubmissionInput["subType"], AppUser["role"][]> = {
  lembur: ["admin_cabang", "snd"],
  cuti: ["admin_cabang", "snd", "spv"],
  izin: ["admin_cabang", "snd", "spv"],
};
```

to:

```ts
const ALLOWED_ROLES_BY_SUBTYPE: Record<CreatePersonaliaSubmissionInput["subType"], AppUser["role"][]> = {
  lembur: ["admin"],
  cuti: ["admin", "spv"],
  izin: ["admin", "spv"],
};
```

- [ ] **Step 2: Edit `createNewSubmission`**

Change:

```ts
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
```

to:

```ts
async function createNewSubmission(
  input: CreatePersonaliaSubmissionInput,
  caller: AppUser
): Promise<SubmitPersonaliaSubmissionResult> {
  let branch = caller.branch;
  let department = caller.department;
  let position = caller.position;

  if (input.employeeId) {
    const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
    const employee = employeeSnap.data();
    if (!employee) {
      throw new Error("Data pegawai tidak ditemukan.");
    }
    branch = employee.branch;
    department = employee.department;
    position = employee.position;
  }
  if (!branch) {
    throw new Error("Cabang tidak ditemukan untuk pengajuan ini.");
  }

  const now = new Date();
  const submissionNumber = await getNextSubmissionNumber(db, branch, now.getFullYear(), now.getMonth() + 1);

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
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    spvApproval: null,
    managerApproval: null,
    branch,
    department,
    position,
    rejectionNote: null,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    completedAt: null,
  });
```

- [ ] **Step 3: Edit `resubmitAfterRevisi`**

Change:

```ts
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
```

to:

```ts
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

  let branch = caller.branch;
  let department = caller.department;
  let position = caller.position;

  if (input.employeeId) {
    const employeeSnap = await getDoc(doc(db, "employees", input.employeeId));
    const employee = employeeSnap.data();
    if (!employee) {
      throw new Error("Data pegawai tidak ditemukan.");
    }
    branch = employee.branch;
    department = employee.department;
    position = employee.position;
  }
  if (!branch) {
    throw new Error("Cabang tidak ditemukan untuk pengajuan ini.");
  }

  const existingAttachmentsSnap = await getDocs(collection(submissionRef, "attachments"));

  const batch = writeBatch(db);
  existingAttachmentsSnap.forEach((d) => batch.delete(d.ref));
  const attachmentRef = doc(collection(submissionRef, "attachments"));
  batch.set(attachmentRef, { ...input.attachment, uploadedAt: serverTimestamp() });
  batch.update(submissionRef, {
    subType: input.subType,
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName,
    branch,
    department,
    position,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: "diajukan",
    rejectionNote: null,
    spvApproval: null,
    managerApproval: null,
  });
```

- [ ] **Step 4: Commit**

```bash
git add lib/submissions/submitPersonaliaSubmission.ts
git commit -m "feat: let admin submit personalia on behalf of a picked employee"
```

---

### Task 10: generateAndAttachSubmissionPdf.ts — use denormalized employeeName instead of a users lookup

**Files:**
- Modify: `lib/pdf/generateAndAttachSubmissionPdf.ts`

- [ ] **Step 1: Remove the requester lookup and use `submission.employeeName`**

Change:

```ts
  const [itemsSnap, requesterSnap] = await Promise.all([
    getDocs(collection(submissionRef, "items")),
    getDoc(doc(db, "users", submission.requesterId)),
  ]);
  const requester = requesterSnap.data();
  if (!requester) {
    throw new Error("Data pengaju tidak ditemukan.");
  }
```

to:

```ts
  const itemsSnap = await getDocs(collection(submissionRef, "items"));
```

Change:

```ts
    requesterName: requester.name,
```

to:

```ts
    requesterName: submission.employeeName,
```

(`SubmissionPdfData.requesterName` stays as the field name — it's the PDF template's generic "name to show as pemohon" shape; only the *source* of the value changes, from a `users` lookup to the submission's own denormalized `employeeName`.)

- [ ] **Step 2: Commit**

```bash
git add lib/pdf/generateAndAttachSubmissionPdf.ts
git commit -m "feat: read pemohon name from submission.employeeName instead of a users lookup"
```

(No dedicated test file exists for this module — it depends on Firestore + `generateSubmissionPdfClient`'s DOM/canvas rendering, same as noted in `CLAUDE.md`'s testing section. Covered by manual QA in Task 20.)

---

### Task 11: pdfTemplate.ts — fixed-size signature boxes

**Files:**
- Modify: `lib/pdf/pdfTemplate.ts:96-99, 139-150`

- [ ] **Step 1: Update the CSS**

Change:

```
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
  .signature-block { width: 45%; text-align: center; }
  .signature-block img { max-height: 60px; margin: 8px 0; }
  .signature-line { border-top: 1px solid #1f2937; margin-top: 4px; padding-top: 4px; }
```

to:

```
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
  .signature-block { width: 45%; text-align: center; }
  .signature-img-box { width: 180px; height: 60px; margin: 8px auto; display: flex; align-items: center; justify-content: center; }
  .signature-img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .signature-line { border-top: 1px solid #1f2937; margin-top: 4px; padding-top: 4px; }
```

- [ ] **Step 2: Wrap both signature `<img>` tags in the new box**

Change:

```html
  <div class="signatures">
    <div class="signature-block">
      <div>Pemohon</div>
      <img src="${escapeHtml(data.requesterSignatureUrl)}" alt="Tanda tangan pemohon" />
      <div class="signature-line">${escapeHtml(data.requesterName)}</div>
    </div>
    <div class="signature-block">
      <div>Mengetahui</div>
      <img src="${escapeHtml(data.approverSignatureUrl)}" alt="Tanda tangan approver" />
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
  </div>
```

to:

```html
  <div class="signatures">
    <div class="signature-block">
      <div>Pemohon</div>
      <div class="signature-img-box"><img src="${escapeHtml(data.requesterSignatureUrl)}" alt="Tanda tangan pemohon" /></div>
      <div class="signature-line">${escapeHtml(data.requesterName)}</div>
    </div>
    <div class="signature-block">
      <div>Mengetahui</div>
      <div class="signature-img-box"><img src="${escapeHtml(data.approverSignatureUrl)}" alt="Tanda tangan approver" /></div>
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
  </div>
```

- [ ] **Step 3: Run the existing template tests**

Run: `npx vitest run lib/pdf/pdfTemplate.test.ts`
Expected: PASS — the existing tests only assert on substring presence (submission number, item names, signature URLs, names, labels), none of which check the exact signature markup, so no test changes are needed.

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/pdfTemplate.ts
git commit -m "fix: bound signature images to a fixed box so uploaded photos don't break PDF layout"
```

---

### Task 12: FileUpload.tsx — accept JPEG for signature uploads

**Files:**
- Modify: `components/file-upload/FileUpload.tsx:18-24`

- [ ] **Step 1: Widen the signature purpose config**

Change:

```ts
  signature: {
    acceptedTypes: ["image/png"],
    maxSizeBytes: 2 * 1024 * 1024,
    maxSizeLabel: "2MB",
    accept: "image/png",
    hint: "PNG · maks. 2MB",
  },
```

to:

```ts
  signature: {
    acceptedTypes: ["image/png", "image/jpeg"],
    maxSizeBytes: 2 * 1024 * 1024,
    maxSizeLabel: "2MB",
    accept: "image/png,image/jpeg",
    hint: "PNG atau JPG · maks. 2MB",
  },
```

(Employees typically send their signature to the admin as a phone photo, which is JPEG — PNG-only was too strict for that source.)

- [ ] **Step 2: Commit**

```bash
git add components/file-upload/FileUpload.tsx
git commit -m "feat: accept JPEG for uploaded signature images"
```

---

### Task 13: nav-config.ts — roles, labels, and a new nav entry

**Files:**
- Modify: `components/app-shell/nav-config.ts`

- [ ] **Step 1: Update imports and NAV_ITEMS roles**

Change:

```ts
import type { LucideIcon } from "lucide-react";
import { ClipboardCheck, FileStack, LayoutDashboard, Users } from "lucide-react";
import type { AppUser } from "@/lib/hooks/useAuth";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: AppUser["role"][];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/pengajuan",
    label: "Pengajuan Saya",
    icon: FileStack,
    roles: ["admin_cabang", "snd", "spv"],
  },
  {
    href: "/persetujuan",
    label: "Antrian Persetujuan",
    icon: ClipboardCheck,
    roles: ["spv", "management"],
  },
  {
    href: "/monitoring",
    label: "Monitoring",
    icon: LayoutDashboard,
    roles: ["admin_cabang", "snd", "spv", "management", "superadmin"],
  },
  {
    href: "/admin",
    label: "Manajemen User",
    icon: Users,
    roles: ["superadmin"],
  },
];

export const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin_cabang: "Admin Cabang",
  snd: "SND",
  spv: "AWS Supervisor",
  management: "Operational Manager",
  superadmin: "Superadmin",
};
```

to:

```ts
import type { LucideIcon } from "lucide-react";
import { ClipboardCheck, Contact, FileStack, LayoutDashboard, Users } from "lucide-react";
import type { AppUser } from "@/lib/hooks/useAuth";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: AppUser["role"][];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/pengajuan",
    label: "Pengajuan Saya",
    icon: FileStack,
    roles: ["admin", "spv"],
  },
  {
    href: "/persetujuan",
    label: "Antrian Persetujuan",
    icon: ClipboardCheck,
    roles: ["spv", "management"],
  },
  {
    href: "/monitoring",
    label: "Monitoring",
    icon: LayoutDashboard,
    roles: ["admin", "spv", "management", "superadmin"],
  },
  {
    href: "/admin",
    label: "Manajemen User",
    icon: Users,
    roles: ["superadmin"],
  },
  {
    href: "/admin/pegawai",
    label: "Data Pegawai",
    icon: Contact,
    roles: ["superadmin"],
  },
];

export const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin: "Admin",
  spv: "AWS Supervisor",
  management: "Operational Manager",
  superadmin: "Superadmin",
};
```

- [ ] **Step 2: Commit**

```bash
git add components/app-shell/nav-config.ts
git commit -m "feat: update nav roles/labels for centralized admin role, add Data Pegawai nav entry"
```

---

### Task 14: EmployeePicker component

**Files:**
- Create: `components/employee-picker/EmployeePicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/employee-picker/EmployeePicker.tsx
"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type Employee = { id: string; name: string; branch: string; department: string; position: string };

export function EmployeePicker({
  value,
  onSelect,
}: {
  value: string | null | undefined;
  onSelect: (employee: Employee | null) => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployees() {
      try {
        const snap = await getDocs(query(collection(db, "employees"), orderBy("name", "asc")));
        if (cancelled) return;
        setEmployees(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            branch: d.data().branch,
            department: d.data().department,
            position: d.data().position,
          }))
        );
      } catch {
        if (!cancelled) setError("Gagal memuat daftar pegawai.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadEmployees();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = employees.find((e) => e.id === value) ?? null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    onSelect(employees.find((e) => e.id === id) ?? null);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Memuat daftar pegawai...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="employeeId">Pegawai</Label>
      <NativeSelect id="employeeId" value={value ?? ""} onChange={handleChange}>
        <option value="" disabled>
          Pilih pegawai
        </option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} — {e.branch}
          </option>
        ))}
      </NativeSelect>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {selected.branch} · {selected.department} · {selected.position}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/employee-picker/EmployeePicker.tsx
git commit -m "feat: add EmployeePicker component"
```

---

### Task 15: admin/new + admin/edit pages — drop admin_cabang/snd role handling

**Files:**
- Modify: `app/(dashboard)/admin/new/page.tsx`
- Modify: `app/(dashboard)/admin/edit/page.tsx`

- [ ] **Step 1: `app/(dashboard)/admin/new/page.tsx` — replace ROLE_OPTIONS and drop `defaultBranchForRole`**

Change:

```ts
const ROLE_OPTIONS = [
  { value: "admin_cabang", label: "Admin Cabang" },
  { value: "snd", label: "SND" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Operational Manager" },
  { value: "superadmin", label: "Superadmin" },
] as const;

function defaultBranchForRole(role: CreateUserInput["role"]): CreateUserInput["branch"] {
  if (role === "admin_cabang") return "WHO";
  if (role === "snd") return "SND";
  return null;
}
```

to:

```ts
const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "spv", label: "AWS Supervisor" },
  { value: "management", label: "Operational Manager" },
  { value: "superadmin", label: "Superadmin" },
] as const;
```

- [ ] **Step 2: Simplify the form hook and role handler**

Change:

```ts
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
```

to:

```ts
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createUserSchema>, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      username: "",
      password: "",
      role: "admin",
      branch: null,
      department: "",
      position: "",
      email: "",
    },
  });

  const roleField = register("role");
```

- [ ] **Step 3: Drop the conditional Cabang select**

Change:

```tsx
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <NativeSelect id="role" {...roleField} onChange={handleRoleChange}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {selectedRole === "admin_cabang" && (
                <div className="space-y-1.5">
                  <Label htmlFor="branch">Cabang</Label>
                  <NativeSelect id="branch" {...register("branch")}>
                    <option value="WHO">WHO</option>
                    <option value="WHP">WHP</option>
                  </NativeSelect>
                </div>
              )}
            </div>
```

to:

```tsx
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <NativeSelect id="role" {...roleField}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
```

- [ ] **Step 4: Apply the identical set of changes to `app/(dashboard)/admin/edit/page.tsx`**

Same `ROLE_OPTIONS` replacement and `defaultBranchForRole` removal. Change its form hook from:

```ts
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateUserSchema>, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { uid: uid ?? "", name: "", role: "admin_cabang", branch: "WHO", department: "", position: "", email: "" },
  });
```

to:

```ts
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateUserSchema>, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { uid: uid ?? "", name: "", role: "admin", branch: null, department: "", position: "", email: "" },
  });
```

Then remove the same `selectedRole`/`roleField`/`handleRoleChange` block (identical to Step 2 above) and the same conditional Cabang-select JSX (identical to Step 3 above). The `loadUser()` effect's `reset({...})` call already reads `branch: data.branch ?? null` generically — no change needed there.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors from either file.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/admin/new/page.tsx" "app/(dashboard)/admin/edit/page.tsx"
git commit -m "feat: simplify user role selection to the centralized admin role"
```

---

### Task 16: New /admin/pegawai pages (list, create, edit)

**Files:**
- Create: `app/(dashboard)/admin/pegawai/page.tsx`
- Create: `app/(dashboard)/admin/pegawai/new/page.tsx`
- Create: `app/(dashboard)/admin/pegawai/edit/page.tsx`

- [ ] **Step 1: List page**

```tsx
// app/(dashboard)/admin/pegawai/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { AlertCircle, Contact, Pencil, Plus } from "lucide-react";

type EmployeeRow = { id: string; name: string; branch: string; department: string; position: string };

export default function AdminEmployeesPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "employees"), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            branch: d.data().branch,
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
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Data Pegawai"
        description="Kelola data pegawai yang bisa dipilih admin saat membuat pengajuan atas nama mereka."
        actions={
          <Button asChild>
            <Link href="/admin/pegawai/new">
              <Plus className="h-4 w-4" />
              Tambah Pegawai
            </Link>
          </Button>
        }
      />

      {listError ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat daftar pegawai"
          description="Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Contact}
          title="Belum ada data pegawai"
          description="Klik &quot;Tambah Pegawai&quot; untuk menambahkan data baru."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nama</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead>Posisi</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.branch}</TableCell>
                  <TableCell>{row.department}</TableCell>
                  <TableCell>{row.position}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/pegawai/edit?id=${row.id}`}
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Edit ${row.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create page**

```tsx
// app/(dashboard)/admin/pegawai/new/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { createEmployeeSchema, CreateEmployeeInput } from "@/lib/schemas/employee";
import { createEmployee } from "@/lib/employees/createEmployee";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

export default function NewEmployeePage() {
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
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createEmployeeSchema>, unknown, CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: { name: "", branch: "WHO", department: "", position: "" },
  });

  async function onSubmit(data: CreateEmployeeInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await createEmployee(data, appUser);
      router.push("/admin/pegawai");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat data pegawai.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Tambah Pegawai" description="Tambahkan data pegawai baru yang bisa dipilih admin saat membuat pengajuan." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nama</Label>
              <Input
                id="name"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "name-error" : undefined}
                {...register("name")}
              />
              {errors.name && (
                <p id="name-error" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="branch">Cabang</Label>
                <NativeSelect id="branch" {...register("branch")}>
                  <option value="WHO">WHO</option>
                  <option value="WHP">WHP</option>
                  <option value="SND">SND</option>
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="department">Departemen</Label>
                <Input
                  id="department"
                  aria-invalid={!!errors.department}
                  aria-describedby={errors.department ? "department-error" : undefined}
                  {...register("department")}
                />
                {errors.department && (
                  <p id="department-error" className="text-sm text-destructive">
                    {errors.department.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="position">Posisi</Label>
              <Input
                id="position"
                aria-invalid={!!errors.position}
                aria-describedby={errors.position ? "position-error" : undefined}
                {...register("position")}
              />
              {errors.position && (
                <p id="position-error" className="text-sm text-destructive">
                  {errors.position.message}
                </p>
              )}
            </div>

            {serverError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Tambah Pegawai"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Edit page**

```tsx
// app/(dashboard)/admin/pegawai/edit/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateEmployeeSchema, UpdateEmployeeInput } from "@/lib/schemas/employee";
import { updateEmployee } from "@/lib/employees/updateEmployee";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

function EditEmployeeContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [isLoadingEmployee, setIsLoadingEmployee] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateEmployeeSchema>, unknown, UpdateEmployeeInput>({
    resolver: zodResolver(updateEmployeeSchema),
    defaultValues: { id: id ?? "", name: "", branch: "WHO", department: "", position: "" },
  });

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    if (!id) {
      setIsLoadingEmployee(false);
      setLoadError("Data pegawai tidak ditemukan.");
      return;
    }
    let cancelled = false;

    async function loadEmployee() {
      setIsLoadingEmployee(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "employees", id as string));
        if (!snap.exists()) {
          throw new Error("Data pegawai tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        reset({
          id: id as string,
          name: data.name ?? "",
          branch: data.branch ?? "WHO",
          department: data.department ?? "",
          position: data.position ?? "",
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat data pegawai.");
        }
      } finally {
        if (!cancelled) setIsLoadingEmployee(false);
      }
    }

    loadEmployee();
    return () => {
      cancelled = true;
    };
  }, [id, reset]);

  async function onSubmit(data: UpdateEmployeeInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await updateEmployee(data, appUser);
      router.push("/admin/pegawai");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah data pegawai.");
    }
  }

  if (isLoadingEmployee) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>;
  }

  if (loadError) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-destructive">{loadError}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Edit Pegawai" description="Perbarui data pegawai." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nama</Label>
              <Input
                id="name"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "name-error" : undefined}
                {...register("name")}
              />
              {errors.name && (
                <p id="name-error" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="branch">Cabang</Label>
                <NativeSelect id="branch" {...register("branch")}>
                  <option value="WHO">WHO</option>
                  <option value="WHP">WHP</option>
                  <option value="SND">SND</option>
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="department">Departemen</Label>
                <Input
                  id="department"
                  aria-invalid={!!errors.department}
                  aria-describedby={errors.department ? "department-error" : undefined}
                  {...register("department")}
                />
                {errors.department && (
                  <p id="department-error" className="text-sm text-destructive">
                    {errors.department.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="position">Posisi</Label>
              <Input
                id="position"
                aria-invalid={!!errors.position}
                aria-describedby={errors.position ? "position-error" : undefined}
                {...register("position")}
              />
              {errors.position && (
                <p id="position-error" className="text-sm text-destructive">
                  {errors.position.message}
                </p>
              )}
            </div>

            {serverError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EditEmployeePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>}>
      <EditEmployeeContent />
    </Suspense>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors from these three files.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/admin/pegawai"
git commit -m "feat: add employee master-data management pages"
```

---

### Task 17: pengajuan/new/page.tsx — wire up the employee picker

**Files:**
- Modify: `app/(dashboard)/pengajuan/new/page.tsx`

- [ ] **Step 1: Import EmployeePicker**

Change:

```ts
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
```

to:

```ts
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
import { EmployeePicker } from "@/components/employee-picker/EmployeePicker";
```

- [ ] **Step 2: Update PERSONALIA_ALLOWED_ROLES**

Change:

```ts
const PERSONALIA_ALLOWED_ROLES: Record<"lembur" | "cuti" | "izin", AppUser["role"][]> = {
  lembur: ["admin_cabang", "snd"],
  cuti: ["admin_cabang", "snd", "spv"],
  izin: ["admin_cabang", "snd", "spv"],
};
```

to:

```ts
const PERSONALIA_ALLOWED_ROLES: Record<"lembur" | "cuti" | "izin", AppUser["role"][]> = {
  lembur: ["admin"],
  cuti: ["admin", "spv"],
  izin: ["admin", "spv"],
};
```

- [ ] **Step 3: Add employeeId to both forms' default values**

Change:

```ts
    defaultValues: {
      submissionId: resubmitId,
      type: "kendaraan",
      subType: "service_berkala",
      requesterSignatureUrl: "",
      items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
      attachments: [],
    },
```

to:

```ts
    defaultValues: {
      submissionId: resubmitId,
      type: "kendaraan",
      subType: "service_berkala",
      employeeId: "",
      requesterSignatureUrl: "",
      items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
      attachments: [],
    },
```

Change:

```ts
    defaultValues: {
      submissionId: resubmitId,
      subType: "cuti",
      employeeName: "",
      periodStart: "",
      periodEnd: "",
    },
```

to:

```ts
    defaultValues: {
      submissionId: resubmitId,
      subType: "cuti",
      employeeId: null,
      employeeName: "",
      periodStart: "",
      periodEnd: "",
    },
```

- [ ] **Step 4: Load employeeId when resubmitting**

Change:

```ts
        setCategory((submissionData?.type as Category) ?? "kendaraan");
        reset({
          submissionId: id,
          type: submissionData?.type ?? "kendaraan",
          subType: submissionData?.subType ?? "service_berkala",
          requesterSignatureUrl: "",
          items:
```

to:

```ts
        setCategory((submissionData?.type as Category) ?? "kendaraan");
        reset({
          submissionId: id,
          type: submissionData?.type ?? "kendaraan",
          subType: submissionData?.subType ?? "service_berkala",
          employeeId: submissionData?.employeeId ?? "",
          requesterSignatureUrl: "",
          items:
```

Change:

```ts
          setCategory(submissionData.subType as Category);
          resetPersonalia({
            submissionId: id,
            subType: submissionData.subType,
            employeeName: submissionData.employeeName ?? "",
            periodStart: submissionData.periodStart ?? "",
            periodEnd: submissionData.periodEnd ?? "",
```

to:

```ts
          setCategory(submissionData.subType as Category);
          resetPersonalia({
            submissionId: id,
            subType: submissionData.subType,
            employeeId: submissionData.employeeId ?? null,
            employeeName: submissionData.employeeName ?? "",
            periodStart: submissionData.periodStart ?? "",
            periodEnd: submissionData.periodEnd ?? "",
```

- [ ] **Step 5: Personalia form — EmployeePicker for admin, free text for spv**

Change:

```tsx
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="employeeName">Nama Karyawan</Label>
                <Input
                  id="employeeName"
                  aria-invalid={!!personaliaErrors.employeeName}
                  aria-describedby={personaliaErrors.employeeName ? "employeeName-error" : undefined}
                  {...registerPersonalia("employeeName")}
                />
                {personaliaErrors.employeeName && (
                  <p id="employeeName-error" className="text-sm text-destructive">
                    {personaliaErrors.employeeName.message}
                  </p>
                )}
              </div>
```

to:

```tsx
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                {appUser?.role === "admin" ? (
                  <EmployeePicker
                    value={watchPersonalia("employeeId")}
                    onSelect={(employee) => {
                      setValuePersonalia("employeeId", employee?.id ?? null);
                      setValuePersonalia("employeeName", employee?.name ?? "");
                    }}
                  />
                ) : (
                  <>
                    <Label htmlFor="employeeName">Nama Karyawan</Label>
                    <Input
                      id="employeeName"
                      aria-invalid={!!personaliaErrors.employeeName}
                      aria-describedby={personaliaErrors.employeeName ? "employeeName-error" : undefined}
                      {...registerPersonalia("employeeName")}
                    />
                  </>
                )}
                {personaliaErrors.employeeName && (
                  <p id="employeeName-error" className="text-sm text-destructive">
                    {personaliaErrors.employeeName.message}
                  </p>
                )}
              </div>
```

- [ ] **Step 6: Operational form — add an EmployeePicker card before "Sub Jenis"**

Change:

```tsx
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Sub Jenis
              </CardTitle>
            </CardHeader>
```

to:

```tsx
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Pegawai
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeePicker value={watch("employeeId")} onSelect={(employee) => setValue("employeeId", employee?.id ?? "")} />
              {errors.employeeId && <p className="text-sm text-destructive">{errors.employeeId.message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Sub Jenis
              </CardTitle>
            </CardHeader>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors from this file.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/pengajuan/new/page.tsx"
git commit -m "feat: add employee picker to the submission form"
```

---

### Task 18: seed-emulator.ts — one admin seed user + sample employees

**Files:**
- Modify: `scripts/seed-emulator.ts`

- [ ] **Step 1: Replace the whole file**

```ts
// scripts/seed-emulator.ts
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { usernameToSyntheticEmail } from "../lib/auth/username";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = initializeApp({ projectId: "sndsupportapps" });
const auth = getAuth(app);
const db = getFirestore(app);

const SEED_USERS = [
  { username: "admin", email: "admin@example.com", password: "password123", name: "Admin", role: "admin", branch: null, department: "GA", position: "Admin" },
  { username: "spv", email: "spv@example.com", password: "password123", name: "AWS Supervisor", role: "spv", branch: null, department: "AWS", position: "Supervisor" },
  { username: "management", email: "management@example.com", password: "password123", name: "Management", role: "management", branch: null, department: "Management", position: "Manager" },
  { username: "superadmin", email: null, password: "password123", name: "Superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" },
];

const SEED_EMPLOYEES = [
  { name: "Rahmat Hidayat", branch: "WHO", department: "Operasional", position: "Staff Gudang" },
  { name: "Siti Aminah", branch: "WHP", department: "Operasional", position: "Staff Gudang" },
  { name: "Dewi Lestari", branch: "SND", department: "SND", position: "Staff" },
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

  for (const e of SEED_EMPLOYEES) {
    const ref = await db.collection("employees").add({
      name: e.name,
      branch: e.branch,
      department: e.department,
      position: e.position,
      createdAt: new Date(),
    });
    console.log(`Seeded employee ${e.name} (${ref.id})`);
  }
}

seed().then(() => process.exit(0));
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-emulator.ts
git commit -m "chore: seed a single admin user and sample employees for local dev"
```

---

### Task 19: CLAUDE.md — document the new role model

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the User Roles table**

Change:

```
| Role | Value di `users.role` | Bisa Mengajukan | Bisa Approve/Reject |
| --- | --- | --- | --- |
| Admin Cabang WHO/WHP | `admin_cabang` | Ya | Tidak |
| SND | `snd` | Ya | Tidak |
| AWS Supervisor | `spv` | Hanya kategori Personalia `cuti`/`izin` (lihat "Ekspansi One Gate" di bawah) | Ya |
| Operational Manager | `management` | Tidak | Ya (backup, jika diperlukan) |
| Superadmin | `superadmin` | Tidak | Tidak (kelola user & sistem, monitoring) |
```

to:

```
| Role | Value di `users.role` | Bisa Mengajukan | Bisa Approve/Reject |
| --- | --- | --- | --- |
| Admin (terpusat) | `admin` | Ya, atas nama pegawai yang dipilih dari data master `employees` (lihat "Restrukturisasi Role Admin" di bawah) | Tidak |
| AWS Supervisor | `spv` | Hanya kategori Personalia `cuti`/`izin` milik sendiri (lihat "Ekspansi One Gate" di bawah) | Ya |
| Operational Manager | `management` | Tidak | Ya (backup, jika diperlukan) |
| Superadmin | `superadmin` | Tidak | Tidak (kelola user, data pegawai, & sistem, monitoring) |
```

- [ ] **Step 2: Add employees to the Firestore Data Model block, and document the new submission fields**

Find the `submissions/{submissionId}` block's comment about denormalized fields:

```
submissions/{submissionId}
  submissionNumber: string        // contoh format: "L.002/TSI-OPR/JB3-TNG/VIII/2026"
  type: "kendaraan" | "perlengkapan" | "gedung_fasilitas" | "personalia"
```

Change to:

```
employees/{employeeId}            // data master, BUKAN akun login — dipilih admin saat membuat pengajuan
  name: string
  branch: "WHO" | "WHP" | "SND"
  department: string
  position: string
  createdAt: Timestamp

submissions/{submissionId}
  submissionNumber: string        // contoh format: "L.002/TSI-OPR/JB3-TNG/VIII/2026"
  type: "kendaraan" | "perlengkapan" | "gedung_fasilitas" | "personalia"
  employeeId: string | null       // ref employees — null hanya untuk personalia yang di-self-submit spv
  employeeName: string            // snapshot nama pemohon asli, dipakai untuk tampilan & PDF
```

- [ ] **Step 3: Append a short new section after "Ekspansi One Gate"**

Add this section right after the "Ekspansi One Gate (Gedung & Fasilitas + Personalia)" section:

```markdown
## Restrukturisasi Role Admin (Admin Terpusat + Data Master Pegawai)

Role `admin_cabang` (WHO/WHP) dan `snd` sudah dihapus, digantikan satu role `admin` terpusat (branch `null`, sama seperti `spv`/`management`/`superadmin`). Staf cabang tidak lagi punya akun di app — mereka mengirim permintaan ke admin di luar app (WA/dsb), admin memfilter manual, lalu menginput pengajuan atas nama pegawai yang dipilih dari koleksi `employees` (data master, dikelola superadmin lewat `/admin/pegawai`, bukan akun login).

`requesterId` pada submission tetap uid admin (dipakai untuk ownership di alur retry PDF/konfirmasi GA/tandai selesai — semua tetap dilakukan admin). `employeeId`+`employeeName` menyimpan identitas pemohon asli, didenormalisasi saat submission dibuat dari data `employees`. `branch`/`department`/`position` pada submission ikut diambil dari `employees`, bukan dari profil admin.

Tanda tangan pemohon sekarang selalu diupload (bukan digambar di app) lewat toggle "Upload File" yang sudah ada di form (`FileUpload` dengan `purpose="signature"`, menerima PNG dan JPEG) — karena pemohon mengirim tanda tangannya sendiri lewat foto/scan ke admin.

Role `spv` yang submit personalia `cuti`/`izin` untuk dirinya sendiri tidak terpengaruh — jalur itu tetap sama seperti sebelumnya (tanpa `employeeId`, `employeeName` tetap teks bebas).

Detail lengkap: `docs/superpowers/specs/2026-09-02-admin-terpusat-data-pegawai-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the centralized admin role and employees master data"
```

---

### Task 20: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run the full non-emulator test suite**

Run: `npx vitest run`
Expected: All tests PASS (schema tests, `pdfTemplate.test.ts`, `wa-template.test.ts`, etc.).

- [ ] **Step 3: Run the emulator-dependent test suite**

Run: `firebase emulators:exec --only firestore,auth "npx vitest run tests/firestore-rules.test.ts lib/counters.test.ts"`
Expected: All tests PASS, including the Task 7 `employees rules` additions.

- [ ] **Step 4: Lint**

Run: `npx eslint .` (or the project's configured lint script — check `package.json` `scripts.lint` if this differs)
Expected: No errors. Watch specifically for unused-variable warnings in the trimmed-down `admin/new` and `admin/edit` pages (Task 15) and the simplified `isValidBranchForRole` (Task 2).

- [ ] **Step 5: Manual QA against the emulator**

Run `firebase emulators:start --only firestore,auth`, then `npx tsx scripts/seed-emulator.ts`, then `npm run dev` with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`. Walk through:

1. Log in as `superadmin` → `/admin/pegawai` → confirm the 3 seeded employees show up → add a new employee → confirm it appears.
2. Log in as `admin` → `/pengajuan/new` → pick "Kendaraan" → confirm the new "Pegawai" card shows the employee list → pick one → confirm branch/department/position preview text appears → fill items → upload a signature image (try a `.jpg`, not just `.png`) → submit → confirm success and that the submission's `branch` matches the picked employee's branch, not `null`.
3. Log in as `spv` → approve that submission (with a drawn or uploaded approver signature) → confirm PDF generates without a blank/crashing page, and that the "Pemohon" signature block shows the uploaded JPEG properly scaled (not overflowing).
4. As `admin`, open the submission detail page → confirm the PDF shows the picked employee's name (not "Admin") → copy WA template → confirm sent to GA → mark as done.
5. Log in as `admin` again → `/pengajuan/new` → pick "Lembur" → confirm the Pegawai picker appears (not a free-text field) → submit.
6. Log in as `spv` → `/pengajuan/new` → pick "Cuti" → confirm the OLD free-text "Nama Karyawan" field still appears (no employee picker) → submit as before.

Expected: All steps succeed with no console errors, and the resulting submissions in the emulator UI (`http://127.0.0.1:4000/firestore`) show the expected `employeeId`/`employeeName`/`branch`/`department`/`position` values.

- [ ] **Step 6: Note the manual production migration step (not part of this plan's code)**

Confirm with the user before deploying that they understand the post-deploy manual step from the design spec's "Migrasi data existing" section: existing `admin_cabang`/`snd` user accounts in production need superadmin to manually re-enter them as `employees` and retire the old accounts. Nothing to commit for this step — it's an operational reminder.

---

## Self-Review Notes

**Spec coverage:** Every numbered decision in the design spec (1–10) maps to a task above — role model (Task 2/3), employees collection (Task 1/5/6/16), submission fields (Task 4/8/9), submission-number branch source (Task 8/9), signature upload (Task 12), personalia admin+spv split (Task 9/17), PDF template box (Task 11), rules (Task 6/7), other UI (Task 13/15), migration note (Task 20 Step 6). Database kendaraan and delete-employee are explicitly out of scope per the spec and are not tasked here.

**Type consistency:** `employeeId`/`employeeName`/`branch`/`department`/`position` field names are used identically across the schema (Task 4), the write modules (Task 8/9), the rules `hasOnly` lists (Task 6), and the rules tests (Task 7). `CreateEmployeeInput`/`UpdateEmployeeInput` names match between the schema (Task 1) and the modules/pages that import them (Task 5/16).
