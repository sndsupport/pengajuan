# Master Data Branch (WHO/WHP City-level) + Kendaraan + Seed Pegawai Operational Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen `branch` to city-level values, add a `vehicles` master-data collection wired into the kendaraan submission form via a picker, and seed real Operational-department employee + vehicle data into production Firestore.

**Architecture:** `lib/branches.ts` becomes the single source of truth for branch values (consumed by the employee schema/dropdowns and the new vehicle schema/dropdowns). `vehicles` is a new Firestore collection that mirrors the existing `employees` collection pattern exactly (schema → CRUD lib → rules → admin CRUD pages). A new `VehiclePicker` component (mirrors `EmployeePicker`) replaces manual item entry for `type: "kendaraan"` submissions. A one-off Node script signs in as an existing superadmin via the Firebase **client** SDK (no Admin SDK/service account) and inserts the reviewed seed data.

**Tech Stack:** Next.js 14 App Router, TypeScript, Zod, React Hook Form, Firebase client SDK (Auth + Firestore), Vitest, `@firebase/rules-unit-testing`.

**Reference spec:** `docs/superpowers/specs/2026-09-08-master-data-branch-kendaraan-pegawai-design.md`

---

### Task 1: `lib/branches.ts` + widen `employees.branch` enum

**Files:**
- Create: `lib/branches.ts`
- Modify: `lib/schemas/employee.ts`
- Modify: `lib/schemas/employee.test.ts`

- [ ] **Step 1: Create the branch constants file**

```ts
// lib/branches.ts
export const BRANCHES = [
  "WHO Bandung",
  "WHO Bogor",
  "WHO Cibaduyut",
  "WHO Cirebon",
  "WHO Garut",
  "WHO Karawang",
  "WHO Purwakarta",
  "WHO Serang",
  "WHO Sukabumi",
  "WHO Tangerang",
  "WHO Tasikmalaya",
  "WHP Bandung",
  "WHP Tasikmalaya",
  "HO-O Bandung",
  "HO Tasikmalaya",
  "SND",
] as const;

export type Branch = (typeof BRANCHES)[number];
```

- [ ] **Step 2: Update the failing-first tests to use a city-level branch value**

Edit `lib/schemas/employee.test.ts` — change the shared `valid` fixture and the two hardcoded `"WHO"` values in the `updateEmployeeSchema` describe block to `"WHO Bandung"`:

```ts
import { describe, it, expect } from "vitest";
import { createEmployeeSchema, updateEmployeeSchema } from "./employee";

describe("createEmployeeSchema", () => {
  const valid = { name: "Rahmat Hidayat", branch: "WHO Bandung" as const, department: "Operasional", position: "Staff Gudang" };

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
      branch: "WHO Bandung",
      department: "Operasional",
      position: "Staff Gudang",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload with id", () => {
    const result = updateEmployeeSchema.safeParse({
      id: "emp-1",
      name: "Rahmat Hidayat",
      branch: "WHO Bandung",
      department: "Operasional",
      position: "Staff Gudang",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails against the current (unwidened) enum**

Run: `npx vitest run lib/schemas/employee.test.ts`
Expected: FAIL — `"accepts a valid payload"` fails because `"WHO Bandung"` isn't in the current three-value enum.

- [ ] **Step 4: Widen the schema to use `BRANCHES`**

Edit `lib/schemas/employee.ts`:

```ts
import { z } from "zod";
import { BRANCHES } from "@/lib/branches";

export const createEmployeeSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  branch: z.enum(BRANCHES),
  department: z.string().min(1, "Departemen wajib diisi"),
  position: z.string().min(1, "Posisi wajib diisi"),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.extend({
  id: z.string().min(1),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/schemas/employee.test.ts`
Expected: PASS (all 7 tests green)

- [ ] **Step 6: Commit**

```bash
git add lib/branches.ts lib/schemas/employee.ts lib/schemas/employee.test.ts
git commit -m "feat: widen employee branch enum to city-level values"
```

---

### Task 2: Update `/admin/pegawai` branch dropdowns to use `BRANCHES`

**Files:**
- Modify: `app/(dashboard)/admin/pegawai/new/page.tsx`
- Modify: `app/(dashboard)/admin/pegawai/edit/page.tsx`

- [ ] **Step 1: Update the "new" page's dropdown and default value**

In `app/(dashboard)/admin/pegawai/new/page.tsx`, add the import:

```ts
import { BRANCHES } from "@/lib/branches";
```

Change the `defaultValues`:

```ts
defaultValues: { name: "", branch: BRANCHES[0], department: "", position: "" },
```

Replace the hardcoded `<NativeSelect>` options:

```tsx
<NativeSelect id="branch" {...register("branch")}>
  {BRANCHES.map((b) => (
    <option key={b} value={b}>
      {b}
    </option>
  ))}
</NativeSelect>
```

- [ ] **Step 2: Update the "edit" page's dropdown and fallback value**

In `app/(dashboard)/admin/pegawai/edit/page.tsx`, add the same import (`import { BRANCHES } from "@/lib/branches";`).

Change the `defaultValues` in `useForm`:

```ts
defaultValues: { id: id ?? "", name: "", branch: BRANCHES[0], department: "", position: "" },
```

Change the `reset(...)` fallback inside `loadEmployee()`:

```ts
reset({
  id: id as string,
  name: data.name ?? "",
  branch: data.branch ?? BRANCHES[0],
  department: data.department ?? "",
  position: data.position ?? "",
});
```

Replace the hardcoded `<NativeSelect>` options (same as Step 1):

```tsx
<NativeSelect id="branch" {...register("branch")}>
  {BRANCHES.map((b) => (
    <option key={b} value={b}>
      {b}
    </option>
  ))}
</NativeSelect>
```

- [ ] **Step 3: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds (no TypeScript errors from the `branch` type narrowing).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/admin/pegawai/new/page.tsx" "app/(dashboard)/admin/pegawai/edit/page.tsx"
git commit -m "feat: populate branch dropdown from lib/branches in pegawai forms"
```

---

### Task 3: `vehicles` Zod schema

**Files:**
- Create: `lib/schemas/vehicle.ts`
- Create: `lib/schemas/vehicle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/schemas/vehicle.test.ts
import { describe, it, expect } from "vitest";
import { createVehicleSchema, updateVehicleSchema } from "./vehicle";

describe("createVehicleSchema", () => {
  const valid = {
    plateNumber: "D 8664 FC",
    vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
    branch: "WHO Bandung" as const,
    category: "Mobil" as const,
  };

  it("accepts a valid payload", () => {
    expect(createVehicleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty plateNumber", () => {
    expect(createVehicleSchema.safeParse({ ...valid, plateNumber: "" }).success).toBe(false);
  });

  it("rejects an empty vehicleType", () => {
    expect(createVehicleSchema.safeParse({ ...valid, vehicleType: "" }).success).toBe(false);
  });

  it("rejects an invalid branch", () => {
    expect(createVehicleSchema.safeParse({ ...valid, branch: "JKT" }).success).toBe(false);
  });

  it("rejects an invalid category", () => {
    expect(createVehicleSchema.safeParse({ ...valid, category: "Kapal" }).success).toBe(false);
  });

  it("accepts all three valid categories", () => {
    expect(createVehicleSchema.safeParse({ ...valid, category: "Mobil" }).success).toBe(true);
    expect(createVehicleSchema.safeParse({ ...valid, category: "Motor" }).success).toBe(true);
    expect(createVehicleSchema.safeParse({ ...valid, category: "Truk" }).success).toBe(true);
  });
});

describe("updateVehicleSchema", () => {
  it("requires an id in addition to the base fields", () => {
    const result = updateVehicleSchema.safeParse({
      plateNumber: "D 8664 FC",
      vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
      branch: "WHO Bandung",
      category: "Mobil",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload with id", () => {
    const result = updateVehicleSchema.safeParse({
      id: "veh-1",
      plateNumber: "D 8664 FC",
      vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
      branch: "WHO Bandung",
      category: "Mobil",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/schemas/vehicle.test.ts`
Expected: FAIL with a module-not-found error for `./vehicle`.

- [ ] **Step 3: Write the schema**

```ts
// lib/schemas/vehicle.ts
import { z } from "zod";
import { BRANCHES } from "@/lib/branches";

export const VEHICLE_CATEGORIES = ["Mobil", "Motor", "Truk"] as const;

export const createVehicleSchema = z.object({
  plateNumber: z.string().min(1, "Plat nomor wajib diisi"),
  vehicleType: z.string().min(1, "Jenis kendaraan wajib diisi"),
  branch: z.enum(BRANCHES),
  category: z.enum(VEHICLE_CATEGORIES),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = createVehicleSchema.extend({
  id: z.string().min(1),
});

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/schemas/vehicle.test.ts`
Expected: PASS (8 tests green)

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/vehicle.ts lib/schemas/vehicle.test.ts
git commit -m "feat: add vehicle schema"
```

---

### Task 4: `vehicles` CRUD lib

**Files:**
- Create: `lib/vehicles/createVehicle.ts`
- Create: `lib/vehicles/updateVehicle.ts`

- [ ] **Step 1: Write `createVehicle`**

```ts
// lib/vehicles/createVehicle.ts
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createVehicleSchema, CreateVehicleInput } from "@/lib/schemas/vehicle";
import type { AppUser } from "@/lib/hooks/useAuth";

export type CreateVehicleResult = { id: string };

export async function createVehicle(rawInput: unknown, caller: AppUser): Promise<CreateVehicleResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat data kendaraan.");
  }

  const parsed = createVehicleSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: CreateVehicleInput = parsed.data;

  const ref = await addDoc(collection(db, "vehicles"), {
    plateNumber: input.plateNumber,
    vehicleType: input.vehicleType,
    branch: input.branch,
    category: input.category,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id };
}
```

- [ ] **Step 2: Write `updateVehicle`**

```ts
// lib/vehicles/updateVehicle.ts
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateVehicleSchema, UpdateVehicleInput } from "@/lib/schemas/vehicle";
import type { AppUser } from "@/lib/hooks/useAuth";

export type UpdateVehicleResult = { id: string };

export async function updateVehicle(rawInput: unknown, caller: AppUser): Promise<UpdateVehicleResult> {
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah data kendaraan.");
  }

  const parsed = updateVehicleSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input: UpdateVehicleInput = parsed.data;

  const ref = doc(db, "vehicles", input.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Data kendaraan tidak ditemukan.");
  }

  await updateDoc(ref, {
    plateNumber: input.plateNumber,
    vehicleType: input.vehicleType,
    branch: input.branch,
    category: input.category,
  });

  return { id: input.id };
}
```

There's no dedicated unit test file for `createEmployee`/`updateEmployee` in this codebase (they're covered by the firestore-rules tests and manual QA) — `createVehicle`/`updateVehicle` follow the same convention, so no test file here either.

- [ ] **Step 3: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/vehicles/createVehicle.ts lib/vehicles/updateVehicle.ts
git commit -m "feat: add vehicle create/update client modules"
```

---

### Task 5: `firestore.rules` — `vehicles` collection + rules tests

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Write the failing rules tests**

Insert this new `describe` block into `tests/firestore-rules.test.ts` right before the final closing `});` at the end of the file (i.e. after the `"denies a non-superadmin from deleting a counter"` test's closing `});` at line 1322, and before the file's last `});` at line 1324):

```ts
  describe("vehicles rules", () => {
    it("allows admin to read vehicles", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").get());
    });

    it("allows superadmin to read vehicles", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").get());
    });

    it("denies spv from reading vehicles", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(db.collection("vehicles").doc("veh-1").get());
    });

    it("denies admin from creating a vehicle", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("vehicles").doc("veh-2").set({
          plateNumber: "D 8854 FD",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bogor",
          category: "Mobil",
        })
      );
    });

    it("allows superadmin to create a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("vehicles").doc("veh-2").set({
          plateNumber: "D 8854 FD",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bogor",
          category: "Mobil",
        })
      );
    });

    it("allows superadmin to update a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").update({ vehicleType: "GRANMAX S402RP-PMRFJJ MU" }));
    });

    it("denies any client from deleting a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertFails(db.collection("vehicles").doc("veh-1").delete());
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Requires Java 21+ and the Firebase emulator (see `CLAUDE.md` "Local Dev" row for the portable-JDK setup if Java isn't installed). Run:

```bash
firebase emulators:exec --only firestore "npx vitest run tests/firestore-rules.test.ts"
```

Expected: FAIL — every `vehicles` test fails because `firestore.rules` has no `match /vehicles/{vehicleId}` block, so the collection has no rule at all and every request is denied (the `assertSucceeds` cases fail).

- [ ] **Step 3: Add the `vehicles` match block to `firestore.rules`**

Insert immediately after the `employees` block (after line 40, before `match /submissions/{submissionId} {`):

```
    match /vehicles/{vehicleId} {
      allow read: if isSignedIn() && userRole() in ['admin', 'superadmin'];
      allow create, update: if isSignedIn() && userRole() == 'superadmin';
      allow delete: if false;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `firebase emulators:exec --only firestore "npx vitest run tests/firestore-rules.test.ts"`
Expected: PASS — all tests in the file green, including the 7 new `vehicles rules` tests.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: add firestore rules for vehicles collection"
```

---

### Task 6: `/admin/kendaraan` admin CRUD pages + nav entry

**Files:**
- Create: `app/(dashboard)/admin/kendaraan/page.tsx`
- Create: `app/(dashboard)/admin/kendaraan/new/page.tsx`
- Create: `app/(dashboard)/admin/kendaraan/edit/page.tsx`
- Modify: `components/app-shell/nav-config.ts`

- [ ] **Step 1: Create the list page**

```tsx
// app/(dashboard)/admin/kendaraan/page.tsx
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
import { AlertCircle, Car, Pencil, Plus } from "lucide-react";

type VehicleRow = { id: string; plateNumber: string; vehicleType: string; branch: string; category: string };

export default function AdminVehiclesPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "vehicles"), orderBy("plateNumber", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            plateNumber: d.data().plateNumber,
            vehicleType: d.data().vehicleType,
            branch: d.data().branch,
            category: d.data().category,
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
        title="Data Kendaraan"
        description="Kelola data kendaraan yang bisa dipilih admin saat membuat pengajuan kendaraan."
        actions={
          <Button asChild>
            <Link href="/admin/kendaraan/new">
              <Plus className="h-4 w-4" />
              Tambah Kendaraan
            </Link>
          </Button>
        }
      />

      {listError ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat daftar kendaraan"
          description="Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Car}
          title="Belum ada data kendaraan"
          description="Klik &quot;Tambah Kendaraan&quot; untuk menambahkan data baru."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Plat Nomor</TableHead>
                <TableHead>Jenis Kendaraan</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono font-medium">{row.plateNumber}</TableCell>
                  <TableCell>{row.vehicleType}</TableCell>
                  <TableCell>{row.branch}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/kendaraan/edit?id=${row.id}`}
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Edit ${row.plateNumber}`}
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

- [ ] **Step 2: Create the "new" page**

```tsx
// app/(dashboard)/admin/kendaraan/new/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { createVehicleSchema, CreateVehicleInput, VEHICLE_CATEGORIES } from "@/lib/schemas/vehicle";
import { BRANCHES } from "@/lib/branches";
import { createVehicle } from "@/lib/vehicles/createVehicle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

export default function NewVehiclePage() {
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
  } = useForm<z.input<typeof createVehicleSchema>, unknown, CreateVehicleInput>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: { plateNumber: "", vehicleType: "", branch: BRANCHES[0], category: "Mobil" },
  });

  async function onSubmit(data: CreateVehicleInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await createVehicle(data, appUser);
      router.push("/admin/kendaraan");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal membuat data kendaraan.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Tambah Kendaraan" description="Tambahkan data kendaraan baru yang bisa dipilih admin saat membuat pengajuan kendaraan." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plateNumber">Plat Nomor</Label>
              <Input
                id="plateNumber"
                className="font-mono"
                aria-invalid={!!errors.plateNumber}
                aria-describedby={errors.plateNumber ? "plateNumber-error" : undefined}
                {...register("plateNumber")}
              />
              {errors.plateNumber && (
                <p id="plateNumber-error" className="text-sm text-destructive">
                  {errors.plateNumber.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vehicleType">Jenis Kendaraan</Label>
              <Input
                id="vehicleType"
                aria-invalid={!!errors.vehicleType}
                aria-describedby={errors.vehicleType ? "vehicleType-error" : undefined}
                {...register("vehicleType")}
              />
              {errors.vehicleType && (
                <p id="vehicleType-error" className="text-sm text-destructive">
                  {errors.vehicleType.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="branch">Cabang</Label>
                <NativeSelect id="branch" {...register("branch")}>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category">Kategori</Label>
                <NativeSelect id="category" {...register("category")}>
                  {VEHICLE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {serverError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Tambah Kendaraan"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create the "edit" page**

```tsx
// app/(dashboard)/admin/kendaraan/edit/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateVehicleSchema, UpdateVehicleInput, VEHICLE_CATEGORIES } from "@/lib/schemas/vehicle";
import { BRANCHES } from "@/lib/branches";
import { updateVehicle } from "@/lib/vehicles/updateVehicle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { AlertCircle } from "lucide-react";

function EditVehicleContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { appUser, loading } = useAuth();
  const router = useRouter();

  const [isLoadingVehicle, setIsLoadingVehicle] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateVehicleSchema>, unknown, UpdateVehicleInput>({
    resolver: zodResolver(updateVehicleSchema),
    defaultValues: { id: id ?? "", plateNumber: "", vehicleType: "", branch: BRANCHES[0], category: "Mobil" },
  });

  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    if (!id) {
      setIsLoadingVehicle(false);
      setLoadError("Data kendaraan tidak ditemukan.");
      return;
    }
    let cancelled = false;

    async function loadVehicle() {
      setIsLoadingVehicle(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "vehicles", id as string));
        if (!snap.exists()) {
          throw new Error("Data kendaraan tidak ditemukan.");
        }
        const data = snap.data();
        if (cancelled) return;
        reset({
          id: id as string,
          plateNumber: data.plateNumber ?? "",
          vehicleType: data.vehicleType ?? "",
          branch: data.branch ?? BRANCHES[0],
          category: data.category ?? "Mobil",
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat data kendaraan.");
        }
      } finally {
        if (!cancelled) setIsLoadingVehicle(false);
      }
    }

    loadVehicle();
    return () => {
      cancelled = true;
    };
  }, [id, reset]);

  async function onSubmit(data: UpdateVehicleInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      await updateVehicle(data, appUser);
      router.push("/admin/kendaraan");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengubah data kendaraan.");
    }
  }

  if (isLoadingVehicle) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>;
  }

  if (loadError) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-destructive">{loadError}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <PageHeader title="Edit Kendaraan" description="Perbarui data kendaraan." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plateNumber">Plat Nomor</Label>
              <Input
                id="plateNumber"
                className="font-mono"
                aria-invalid={!!errors.plateNumber}
                aria-describedby={errors.plateNumber ? "plateNumber-error" : undefined}
                {...register("plateNumber")}
              />
              {errors.plateNumber && (
                <p id="plateNumber-error" className="text-sm text-destructive">
                  {errors.plateNumber.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vehicleType">Jenis Kendaraan</Label>
              <Input
                id="vehicleType"
                aria-invalid={!!errors.vehicleType}
                aria-describedby={errors.vehicleType ? "vehicleType-error" : undefined}
                {...register("vehicleType")}
              />
              {errors.vehicleType && (
                <p id="vehicleType-error" className="text-sm text-destructive">
                  {errors.vehicleType.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="branch">Cabang</Label>
                <NativeSelect id="branch" {...register("branch")}>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category">Kategori</Label>
                <NativeSelect id="category" {...register("category")}>
                  {VEHICLE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </div>
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

export default function EditVehiclePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Memuat...</div>}>
      <EditVehicleContent />
    </Suspense>
  );
}
```

- [ ] **Step 4: Add the nav entry**

In `components/app-shell/nav-config.ts`, change the icon import line:

```ts
import { Car, ClipboardCheck, Contact, DatabaseBackup, FileStack, LayoutDashboard, Users } from "lucide-react";
```

Add a new entry to `NAV_ITEMS` right after the `/admin/pegawai` entry:

```ts
  {
    href: "/admin/kendaraan",
    label: "Data Kendaraan",
    icon: Car,
    roles: ["superadmin"],
  },
```

- [ ] **Step 5: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/admin/kendaraan" components/app-shell/nav-config.ts
git commit -m "feat: add /admin/kendaraan CRUD pages and nav entry"
```

---

### Task 7: `VehiclePicker` component

**Files:**
- Create: `components/vehicle-picker/VehiclePicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/vehicle-picker/VehiclePicker.tsx
"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type Vehicle = { id: string; plateNumber: string; vehicleType: string; branch: string; category: string };

export function VehiclePicker({
  value,
  onSelect,
}: {
  value: string | null | undefined;
  onSelect: (vehicle: Vehicle | null) => void;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadVehicles() {
      try {
        const snap = await getDocs(query(collection(db, "vehicles"), orderBy("plateNumber", "asc")));
        if (cancelled) return;
        setVehicles(
          snap.docs.map((d) => ({
            id: d.id,
            plateNumber: d.data().plateNumber,
            vehicleType: d.data().vehicleType,
            branch: d.data().branch,
            category: d.data().category,
          }))
        );
      } catch {
        if (!cancelled) setError("Gagal memuat daftar kendaraan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = vehicles.find((v) => v.id === value) ?? null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    onSelect(vehicles.find((v) => v.id === id) ?? null);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Memuat daftar kendaraan...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="vehiclePicker">Kendaraan</Label>
      <NativeSelect id="vehiclePicker" value={value ?? ""} onChange={handleChange}>
        <option value="" disabled>
          Pilih kendaraan
        </option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.plateNumber} — {v.vehicleType}
          </option>
        ))}
      </NativeSelect>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {selected.branch} · {selected.category}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds (the component isn't wired up anywhere yet, so this just checks it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add components/vehicle-picker/VehiclePicker.tsx
git commit -m "feat: add VehiclePicker component"
```

---

### Task 8: Add optional `vehicleId` to `itemSchema`

**Files:**
- Modify: `lib/schemas/submission.ts`
- Modify: `lib/schemas/submission.test.ts`

- [ ] **Step 1: Write the failing test**

Add this new `describe` block to `lib/schemas/submission.test.ts`, right after the closing `});` of the `"createSubmissionSchema — gedung_fasilitas"` describe block (after line 138):

```ts
describe("itemSchema vehicleId", () => {
  const basePayload = {
    type: "kendaraan" as const,
    subType: "service_berkala" as const,
    employeeId: "emp-1",
    requesterSignatureUrl: "https://storage.example.com/sig.png",
    items: [
      { itemName: "D 8664 FC", brandType: "GRANMAX S402RP-PMRFJJ KJ", km: 45000, quantity: 1, unit: "unit", description: "" },
    ],
  };

  it("defaults vehicleId to null when omitted", () => {
    const result = createSubmissionSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].vehicleId).toBeNull();
    }
  });

  it("accepts an explicit vehicleId", () => {
    const payload = {
      ...basePayload,
      items: [{ ...basePayload.items[0], vehicleId: "veh-1" }],
    };
    const result = createSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].vehicleId).toBe("veh-1");
    }
  });

  it("accepts an explicit null vehicleId", () => {
    const payload = {
      ...basePayload,
      items: [{ ...basePayload.items[0], vehicleId: null }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: FAIL — `result.data.items[0].vehicleId` is `undefined`, not `null` (the field doesn't exist on `itemSchema` yet).

- [ ] **Step 3: Add the field to `itemSchema`**

In `lib/schemas/submission.ts`, change:

```ts
export const itemSchema = z.object({
  itemName: z.string().min(1, "Nama item wajib diisi"),
  brandType: z.string().min(1, "Merk/tipe wajib diisi"),
  km: z.number().int().nonnegative().nullable(),
  quantity: z.number().int().positive(),
  unit: z.string().min(1, "Satuan wajib diisi"),
  description: z.string(),
  vehicleId: z.string().nullable().default(null),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/schemas/submission.test.ts`
Expected: PASS — all tests in the file green, including the 3 new `itemSchema vehicleId` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/submission.ts lib/schemas/submission.test.ts
git commit -m "feat: add optional vehicleId to submission itemSchema"
```

---

### Task 9: Wire `VehiclePicker` into the kendaraan submission form

**Files:**
- Modify: `app/(dashboard)/pengajuan/new/page.tsx`

- [ ] **Step 1: Import `VehiclePicker`**

Add the import next to the `EmployeePicker` import:

```ts
import { VehiclePicker } from "@/components/vehicle-picker/VehiclePicker";
```

- [ ] **Step 2: Add `vehicleId: null` everywhere an item's default shape is constructed**

There are three spots in `app/(dashboard)/pengajuan/new/page.tsx` that build a default item object — update all three to include `vehicleId: null`:

In the `useForm` call's `defaultValues.items`:
```ts
items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "", vehicleId: null }],
```

In the "Tambah Item" button's `onClick`:
```ts
onClick={() =>
  append({ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "", vehicleId: null })
}
```

In the resubmit `reset(...)` fallback (the `items.length > 0 ? items : [...]` branch):
```ts
items:
  items.length > 0
    ? items
    : [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "", vehicleId: null }],
```

- [ ] **Step 3: Carry `vehicleId` through when loading items for resubmit**

In the resubmit `loadResubmitData()` function, the `items` map currently reads:

```ts
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
```

Add `vehicleId`:

```ts
const items = itemsSnap.docs.map((itemDoc) => {
  const data = itemDoc.data();
  return {
    itemName: data.itemName ?? "",
    brandType: data.brandType ?? "",
    km: data.km ?? null,
    quantity: data.quantity ?? 1,
    unit: data.unit ?? "",
    description: data.description ?? "",
    vehicleId: data.vehicleId ?? null,
  };
});
```

- [ ] **Step 4: Replace the manual itemName/brandType inputs with `VehiclePicker` for `type: "kendaraan"`**

In the item row's `<div className="grid gap-3 sm:grid-cols-2">`, the current first two cells are the `itemName` and `brandType` `<Input>`s. Wrap both in a conditional so `kendaraan` renders `VehiclePicker` instead:

```tsx
<div className="grid gap-3 sm:grid-cols-2">
  {selectedType === "kendaraan" ? (
    <div className="space-y-1.5 sm:col-span-2">
      <input type="hidden" {...register(`items.${index}.itemName`)} />
      <input type="hidden" {...register(`items.${index}.brandType`)} />
      <VehiclePicker
        value={watch(`items.${index}.vehicleId`)}
        onSelect={(vehicle) => {
          setValue(`items.${index}.vehicleId`, vehicle?.id ?? null, { shouldValidate: true });
          setValue(`items.${index}.itemName`, vehicle?.plateNumber ?? "", { shouldValidate: true });
          setValue(`items.${index}.brandType`, vehicle?.vehicleType ?? "", { shouldValidate: true });
        }}
      />
      {itemErrors?.itemName && (
        <p className="text-sm text-destructive">{itemErrors.itemName.message}</p>
      )}
    </div>
  ) : (
    <>
      <div className="space-y-1.5">
        <Input
          placeholder="Nama item"
          aria-label="Nama item"
          aria-invalid={!!itemErrors?.itemName}
          aria-describedby={itemErrors?.itemName ? `item-${index}-itemName-error` : undefined}
          {...register(`items.${index}.itemName`)}
        />
        {itemErrors?.itemName && (
          <p id={`item-${index}-itemName-error`} className="text-sm text-destructive">
            {itemErrors.itemName.message}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Input
          placeholder="Merk/Tipe"
          aria-label="Merk/Tipe"
          aria-invalid={!!itemErrors?.brandType}
          aria-describedby={itemErrors?.brandType ? `item-${index}-brandType-error` : undefined}
          {...register(`items.${index}.brandType`)}
        />
        {itemErrors?.brandType && (
          <p id={`item-${index}-brandType-error`} className="text-sm text-destructive">
            {itemErrors.brandType.message}
          </p>
        )}
      </div>
    </>
  )}
  {selectedType === "kendaraan" && (
    <div className="space-y-1.5">
      <Input
        type="number"
        placeholder="KM"
        aria-label="KM"
        className="font-mono"
        aria-invalid={!!itemErrors?.km}
        aria-describedby={itemErrors?.km ? `item-${index}-km-error` : undefined}
        {...register(`items.${index}.km`, {
          setValueAs: (v) => (v === "" ? null : Number(v)),
        })}
      />
      {itemErrors?.km && (
        <p id={`item-${index}-km-error`} className="text-sm text-destructive">
          {itemErrors.km.message}
        </p>
      )}
    </div>
  )}
  <div className="space-y-1.5">
    <Input
      type="number"
      placeholder="Jumlah"
      aria-label="Jumlah"
      className="font-mono"
      aria-invalid={!!itemErrors?.quantity}
      aria-describedby={itemErrors?.quantity ? `item-${index}-quantity-error` : undefined}
      {...register(`items.${index}.quantity`, { valueAsNumber: true })}
    />
    {itemErrors?.quantity && (
      <p id={`item-${index}-quantity-error`} className="text-sm text-destructive">
        {itemErrors.quantity.message}
      </p>
    )}
  </div>
  <div className="space-y-1.5">
    <Input
      placeholder="Satuan"
      aria-label="Satuan"
      aria-invalid={!!itemErrors?.unit}
      aria-describedby={itemErrors?.unit ? `item-${index}-unit-error` : undefined}
      {...register(`items.${index}.unit`)}
    />
    {itemErrors?.unit && (
      <p id={`item-${index}-unit-error`} className="text-sm text-destructive">
        {itemErrors.unit.message}
      </p>
    )}
  </div>
</div>
```

This is the entire existing grid block with the `itemName`/`brandType` cells replaced by the conditional — the `km`, `quantity`, and `unit` cells are unchanged from the current file, just reproduced here so the whole `<div className="grid ...">` block can be swapped in one piece.

- [ ] **Step 5: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, log in as an `admin` user, go to "Buat Pengajuan" with category "Kendaraan", and confirm:
- The vehicle picker shows (instead of free-text Nama Item / Merk-Tipe inputs) once at least one vehicle exists in `/admin/kendaraan` (seeded in Task 11).
- Picking a vehicle shows its branch/category caption.
- Switching category to "Perlengkapan" or "Gedung & Fasilitas" still shows the original free-text inputs.
- Submitting a kendaraan request succeeds and the created submission's item shows the picked plate number as its item name on the detail page.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/pengajuan/new/page.tsx"
git commit -m "feat: use VehiclePicker for kendaraan submission items"
```

---

### Task 10: Seed data files (employee + vehicle)

**Files:**
- Create: `scripts/seed-data/employees-operational.json`
- Create: `scripts/seed-data/vehicles.json`

These are the real records transcribed from the spreadsheets the user provided (13 WHO/WHP-city branches, ~46 vehicles, ~100 Operational-department employees). Employee `position` is `"-"` for all rows because the source data has no per-person job title — see spec section 5 ("Seed data ke Firestore produksi").

- [ ] **Step 1: Write `scripts/seed-data/employees-operational.json`**

```json
[
  { "name": "Abdul Hanan", "branch": "WHP Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Abdul Malik Soleh Gumelar", "branch": "WHO Bogor", "department": "Operational", "position": "-" },
  { "name": "Ace Tatang Tahpi", "branch": "WHO Purwakarta", "department": "Operational", "position": "-" },
  { "name": "Ade Syihabuddin", "branch": "WHP Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Adeng Somantri", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Aep Saepulloh", "branch": "WHO Cirebon", "department": "Operational", "position": "-" },
  { "name": "Agus Djafar", "branch": "HO-O Bandung", "department": "Operational", "position": "-" },
  { "name": "Agus Setiawan", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Alawy Muchamad", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Andi Ismail", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Angga Maulana Andalas", "branch": "HO-O Bandung", "department": "Operational", "position": "-" },
  { "name": "Apud Saepudin", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Aria Hendrata Wardhani", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Arie Gunida", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Arif Budiman", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Arif Kurniawan", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Aris Mulyadi", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Arman Nuryaman", "branch": "WHP Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Asep Fahmi Munawar", "branch": "WHP Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Asep Kristiono Priadi", "branch": "WHO Cirebon", "department": "Operational", "position": "-" },
  { "name": "Asep Murdani", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Asep Sarip Hidayatulloh", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Asep Sudinar", "branch": "WHO Bogor", "department": "Operational", "position": "-" },
  { "name": "Dadan Suanda", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Dadang Sunandar", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Dedi", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Dedi Mulyadi", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Didin Hapinudin", "branch": "WHO Bogor", "department": "Operational", "position": "-" },
  { "name": "Donna Henriansyah Arumadireja", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Dudi", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Eki Arip Firmansyah", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Eko Sepriadi", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Esa Maulana", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Fauzan Agus", "branch": "WHO Bogor", "department": "Operational", "position": "-" },
  { "name": "Firman", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Firmansyah", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Fuad Hasyim Al'As'Ari", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Gin Gin Ginanjar", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Hamdan Abdulah", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Hari Suharto", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Haris Riswanto", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Haris Saefulloh", "branch": "WHO Garut", "department": "Operational", "position": "-" },
  { "name": "Hendra Irawan", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Herman Suherman", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Ihsanuddin", "branch": "WHO Garut", "department": "Operational", "position": "-" },
  { "name": "Indra Bernard", "branch": "WHO Purwakarta", "department": "Operational", "position": "-" },
  { "name": "Irwan Setiawan", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Ivan Restu Pebrian", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Iwan Samsul", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Jajang Abdul Rojak", "branch": "WHP Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Jamsa", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Januar Arif", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Joko Sujatmoko", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Juan Budiansyah", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Kuswahyudi", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Lalan Ruslan", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Lutpi Perdiyan", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Mohamad Samsudin", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Mohammad Sehabuddin Al Gifary", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Muhamad Rizki Barokah", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Muhamad Syarif Hidayatuloh", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Nana Supriatna", "branch": "WHO Cirebon", "department": "Operational", "position": "-" },
  { "name": "Nur Arif Jatmiko", "branch": "HO-O Bandung", "department": "Operational", "position": "-" },
  { "name": "Nurunnisa", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Pebi Aviyanti", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Purnama Cahya Gumilang", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Raden Dana Prakasyana", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Rafli Ardiansyah", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Rahmat Agus Tiyan", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Rahmat Nugraha Abdila", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Raihaan Mulya Ramadhan", "branch": "WHO Purwakarta", "department": "Operational", "position": "-" },
  { "name": "Rakhman Hakim", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Ramdan Mulyana", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Reval Alif Fauzi Pristya", "branch": "WHO Cirebon", "department": "Operational", "position": "-" },
  { "name": "Rey Diva Muliyana", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Rizki Firliani Hutami", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Rizki Trihartanto", "branch": "HO-O Bandung", "department": "Operational", "position": "-" },
  { "name": "Rofi Juniarwandi", "branch": "WHO Purwakarta", "department": "Operational", "position": "-" },
  { "name": "Roni", "branch": "WHO Bogor", "department": "Operational", "position": "-" },
  { "name": "Rosihan Anwar", "branch": "WHO Purwakarta", "department": "Operational", "position": "-" },
  { "name": "Rudiansyah Berlin", "branch": "WHO Bogor", "department": "Operational", "position": "-" },
  { "name": "Satrio Sudewo", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Sendi Nopandi", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Sigit Nurdianto", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Siti nur Afriyen", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Suherlan", "branch": "WHO Sukabumi", "department": "Operational", "position": "-" },
  { "name": "Suryana Chandra", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Syarif Achmad Hidayat", "branch": "WHO Garut", "department": "Operational", "position": "-" },
  { "name": "Tamim Abdul Purnama", "branch": "HO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Tantan Taryana", "branch": "HO-O Bandung", "department": "Operational", "position": "-" },
  { "name": "Taufik Nur Iskandar", "branch": "WHO Cirebon", "department": "Operational", "position": "-" },
  { "name": "Teguh Imam Santosa", "branch": "WHO Serang", "department": "Operational", "position": "-" },
  { "name": "Tian Nurtiana", "branch": "HO-O Bandung", "department": "Operational", "position": "-" },
  { "name": "Toni Firmansyah", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Udin Samsudin", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Ujang Rahmat Ramdani", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" },
  { "name": "Virgiawan Zinedia Setiawan", "branch": "WHO Purwakarta", "department": "Operational", "position": "-" },
  { "name": "Waluya", "branch": "WHO Karawang", "department": "Operational", "position": "-" },
  { "name": "Wiwit Saputra", "branch": "WHO Tangerang", "department": "Operational", "position": "-" },
  { "name": "Yana Mulyana", "branch": "WHP Bandung", "department": "Operational", "position": "-" },
  { "name": "Yudiman", "branch": "WHO Bandung", "department": "Operational", "position": "-" },
  { "name": "Zamzam Ahmad Maulida", "branch": "WHO Tasikmalaya", "department": "Operational", "position": "-" }
]
```

- [ ] **Step 2: Write `scripts/seed-data/vehicles.json`**

```json
[
  { "plateNumber": "D 8664 FC", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "D 8854 FD", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Bogor", "category": "Mobil" },
  { "plateNumber": "D 8441 FF", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Purwakarta", "category": "Mobil" },
  { "plateNumber": "D 8477 FF", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Tasikmalaya", "category": "Mobil" },
  { "plateNumber": "D 8691 FF", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "D 8023 FG", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Cirebon", "category": "Mobil" },
  { "plateNumber": "D 1842 AGX", "vehicleType": "GRANMAX S402RP-PMRFJJ MU", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "D 8410 FH", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Karawang", "category": "Mobil" },
  { "plateNumber": "D 8824 FH", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Purwakarta", "category": "Mobil" },
  { "plateNumber": "D 8825 FH", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Bogor", "category": "Mobil" },
  { "plateNumber": "D 8562 FI", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Sukabumi", "category": "Mobil" },
  { "plateNumber": "D 8561 FI", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "D 8560 FI", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Tangerang", "category": "Mobil" },
  { "plateNumber": "D 8915 FJ", "vehicleType": "GRANMAX S402RP-PMRFJJ KJ", "branch": "WHO Karawang", "category": "Mobil" },
  { "plateNumber": "D 8724 FN", "vehicleType": "GRANMAX S402RP-TMRFJJ SF", "branch": "WHO Tasikmalaya", "category": "Mobil" },
  { "plateNumber": "D 8704 FN", "vehicleType": "GRANMAX S402RP-TMRFJJ SF", "branch": "WHO Tasikmalaya", "category": "Mobil" },
  { "plateNumber": "D 8705 FN", "vehicleType": "GRANMAX S402RP-TMRFJJ SF", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "D 8706 FN", "vehicleType": "GRANMAX S402RP-TMRFJJ SF", "branch": "WHO Tangerang", "category": "Mobil" },
  { "plateNumber": "D 8707 FN", "vehicleType": "GRANMAX S402RP-TMRFJJ SF", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "D 8688 FB", "vehicleType": "BLIND VAN S40IRV-EMREJJ HF", "branch": "WHO Serang", "category": "Mobil" },
  { "plateNumber": "D 8117 EZ", "vehicleType": "BLIND VAN S40IRV-EMREJJ HF", "branch": "WHO Bogor", "category": "Mobil" },
  { "plateNumber": "D 8119 EZ", "vehicleType": "BLIND VAN S40IRV-EMREJJ HF", "branch": "WHO Sukabumi", "category": "Mobil" },
  { "plateNumber": "D 8032 FG", "vehicleType": "COLT DIESEL FE 71 L", "branch": "WHP Bandung", "category": "Truk" },
  { "plateNumber": "D 8083 FH", "vehicleType": "COLT DIESEL FE 71 L", "branch": "WHP Bandung", "category": "Truk" },
  { "plateNumber": "Z 1623 KJ", "vehicleType": "S40IRV-ZMDEJJ-HJ", "branch": "WHO Tasikmalaya", "category": "Mobil" },
  { "plateNumber": "D 8869 FN", "vehicleType": "COLT DIESEL FE 71 L", "branch": "WHP Bandung", "category": "Truk" },
  { "plateNumber": "D 1256 AAE", "vehicleType": "TERIOS F700RG TX MT", "branch": "WHO Bandung", "category": "Mobil" },
  { "plateNumber": "Z 4358 IA", "vehicleType": "MIO 2", "branch": "WHO Garut", "category": "Motor" },
  { "plateNumber": "Z 2325 IC", "vehicleType": "MIO 2", "branch": "WHO Bandung", "category": "Motor" },
  { "plateNumber": "Z 3776 IG", "vehicleType": "MIO - SE 88", "branch": "WHO Cibaduyut", "category": "Motor" },
  { "plateNumber": "Z 3775 IG", "vehicleType": "SE 88", "branch": "WHO Bandung", "category": "Motor" },
  { "plateNumber": "Z 5298 IE", "vehicleType": "SE 88", "branch": "WHO Tasikmalaya", "category": "Motor" },
  { "plateNumber": "Z 5092 IE", "vehicleType": "SE 88", "branch": "WHO Bogor", "category": "Motor" },
  { "plateNumber": "Z 4318 MN", "vehicleType": "SE 88", "branch": "WHO Garut", "category": "Motor" },
  { "plateNumber": "Z 3821 IF", "vehicleType": "SE 88", "branch": "WHO Bandung", "category": "Motor" },
  { "plateNumber": "D 3911 JP", "vehicleType": "54P (CASH WHEEL) A/T", "branch": "WHO Bandung", "category": "Motor" },
  { "plateNumber": "Z 5297 IE", "vehicleType": "SE 88", "branch": "WHO Karawang", "category": "Motor" },
  { "plateNumber": "Z 2028 IE", "vehicleType": "SE 88", "branch": "WHO Serang", "category": "Motor" },
  { "plateNumber": "Z 6052 IF", "vehicleType": "2 BU", "branch": "WHO Purwakarta", "category": "Motor" },
  { "plateNumber": "Z 5881 MM", "vehicleType": "SE 88", "branch": "WHO Sukabumi", "category": "Motor" },
  { "plateNumber": "Z 5546 IC", "vehicleType": "SE 88", "branch": "WHO Sukabumi", "category": "Motor" },
  { "plateNumber": "D 2810 ACY", "vehicleType": "BEAT CBS HIBO2N4L LO A/T", "branch": "WHO Sukabumi", "category": "Motor" },
  { "plateNumber": "Z 3036 II", "vehicleType": "SE 88", "branch": "WHO Cirebon", "category": "Motor" },
  { "plateNumber": "Z 3091 ADF", "vehicleType": "HIBO2N4L LO A/T", "branch": "WHO Bandung", "category": "Motor" },
  { "plateNumber": "Z 3093 ADF", "vehicleType": "HIBO2N4L LO A/T", "branch": "WHO Garut", "category": "Motor" },
  { "plateNumber": "Z 3064 ADF", "vehicleType": "HIBO2N4L LO A/T", "branch": "WHO Bandung", "category": "Motor" },
  { "plateNumber": "D 6788 ADI", "vehicleType": "H1BO2N4L LO A/T", "branch": "WHO Tangerang", "category": "Motor" },
  { "plateNumber": "D 1136 ABR", "vehicleType": "TOYOTA/RUSH 1.5S AT (F700RE-GQMFJJ)", "branch": "WHO Tasikmalaya", "category": "Mobil" },
  { "plateNumber": "D 3190 AED", "vehicleType": "H1BO2N4L LO A/T", "branch": "WHO Cirebon", "category": "Motor" }
]
```

- [ ] **Step 3: MANDATORY — show both files to the user and get explicit confirmation before Task 11**

Print both files' contents (or point the user at the two file paths) and ask them to confirm every row is correct — plate numbers, vehicle model spelling, employee names, and branch assignments — before running the seed script in Task 11. This is real production data transcribed from spreadsheet screenshots (OCR/manual-reading risk on ambiguous characters like `1`/`l`/`I` and `0`/`O` in model codes such as `HIBO2N4L`). **Do not proceed to Task 11 until the user has confirmed.**

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-data/employees-operational.json scripts/seed-data/vehicles.json
git commit -m "data: add transcribed seed data for operational employees and vehicles"
```

---

### Task 11: Seed script (production, client-SDK, superadmin sign-in)

**Files:**
- Create: `scripts/seed-master-data.ts`
- Modify: `package.json`

**Precondition:** Task 10 Step 3's user confirmation must be complete before this task's Step 4 (actually running the script against production) is executed.

- [ ] **Step 1: Write the script**

```ts
// scripts/seed-master-data.ts
import { readFileSync } from "fs";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../lib/firebase/client";
import { usernameToSyntheticEmail } from "../lib/auth/username";
import { createEmployee } from "../lib/employees/createEmployee";
import { createVehicle } from "../lib/vehicles/createVehicle";
import type { AppUser } from "../lib/hooks/useAuth";

type EmployeeSeed = { name: string; branch: string; department: string; position: string };
type VehicleSeed = { plateNumber: string; vehicleType: string; branch: string; category: "Mobil" | "Motor" | "Truk" };

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD environment variables before running this script.");
  }

  const credential = await signInWithEmailAndPassword(auth, usernameToSyntheticEmail(username), password);
  const userSnap = await getDocs(
    query(collection(db, "users"), where("username", "==", username.trim().toLowerCase()))
  );
  const userDoc = userSnap.docs[0];
  if (!userDoc || userDoc.data().role !== "superadmin") {
    throw new Error(`User "${username}" is not a superadmin — aborting.`);
  }
  const caller: AppUser = { uid: credential.user.uid, ...(userDoc.data() as Omit<AppUser, "uid">) };

  const employees: EmployeeSeed[] = JSON.parse(
    readFileSync("scripts/seed-data/employees-operational.json", "utf8")
  );
  const vehicles: VehicleSeed[] = JSON.parse(readFileSync("scripts/seed-data/vehicles.json", "utf8"));

  const existingEmployeeNames = new Set(
    (await getDocs(collection(db, "employees"))).docs.map((d) => d.data().name as string)
  );
  for (const employee of employees) {
    if (existingEmployeeNames.has(employee.name)) {
      console.log(`Skip employee (already exists): ${employee.name}`);
      continue;
    }
    const result = await createEmployee(employee, caller);
    console.log(`Seeded employee ${employee.name} (${result.id})`);
  }

  const existingPlateNumbers = new Set(
    (await getDocs(collection(db, "vehicles"))).docs.map((d) => d.data().plateNumber as string)
  );
  for (const vehicle of vehicles) {
    if (existingPlateNumbers.has(vehicle.plateNumber)) {
      console.log(`Skip vehicle (already exists): ${vehicle.plateNumber}`);
      continue;
    }
    const result = await createVehicle(vehicle, caller);
    console.log(`Seeded vehicle ${vehicle.plateNumber} (${result.id})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the `package.json` script entry**

In `package.json`, add to `"scripts"` (after `"seed"`):

```json
    "seed:master-data": "tsx --env-file=.env.local scripts/seed-master-data.ts"
```

`--env-file` is a native Node 20.6+ flag (this machine runs Node v24.16.0) that loads `.env.local`'s `NEXT_PUBLIC_FIREBASE_*` values into `process.env` for the script — the same values `lib/firebase/client.ts` reads to initialize the Firebase app. The script never calls `connectToEmulatorsIfConfigured()`, so it always talks to the real production Firebase project regardless of `NEXT_PUBLIC_USE_FIREBASE_EMULATORS`.

- [ ] **Step 3: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds (the script isn't part of the Next.js build graph, but this confirms nothing else broke).

Run: `npx tsc --noEmit scripts/seed-master-data.ts`
Expected: no TypeScript errors in the new script itself.

- [ ] **Step 4: Confirm with the user, then run against production**

**Do not run this step without the user's explicit go-ahead** — it writes real data to the live `sndsupportapps` Firestore project. Ask the user for:
1. Confirmation that Task 10's JSON files are correct (per Task 10 Step 3).
2. An existing superadmin username + password to run the script as.

Then run (values supplied by the user, not hardcoded anywhere):

```bash
SEED_ADMIN_USERNAME=<username> SEED_ADMIN_PASSWORD=<password> npm run seed:master-data
```

Expected output: one `Seeded employee ...` or `Skip employee (already exists): ...` line per row in `employees-operational.json`, followed by one `Seeded vehicle ...` or `Skip vehicle (already exists): ...` line per row in `vehicles.json` — 102 employee lines and 46 vehicle lines total, no errors.

- [ ] **Step 5: Verify in the live app**

Log into https://sndsupportapps.web.app as a superadmin, open `/admin/pegawai` and `/admin/kendaraan`, and spot-check a handful of rows (e.g. search for "Tamim Abdul Purnama" and confirm branch shows `HO Tasikmalaya`; confirm `D 8032 FG` shows branch `WHP Bandung`, category `Truk`).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-master-data.ts package.json
git commit -m "feat: add production master-data seed script"
```

---

### Task 12: Full test suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the non-emulator test suite**

Run: `npm test`
Expected: all tests pass, including the new `lib/schemas/vehicle.test.ts` and the updated `lib/schemas/employee.test.ts` / `lib/schemas/submission.test.ts`.

- [ ] **Step 2: Run the emulator-dependent rules suite**

Run: `firebase emulators:exec --only firestore,auth "npm test"`
Expected: all tests pass, including the 7 new `vehicles rules` tests added in Task 5. If Java 21+ isn't installed on this machine, follow the portable-JDK setup documented in `CLAUDE.md` under "Local Dev" first.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: build succeeds with no TypeScript or lint errors.

- [ ] **Step 4: Report results to the user**

No commit for this task — it's a verification checkpoint. Report the test/build results (and, if Task 11 was completed, that seeding is confirmed live) back to the user.

---

## Self-Review Notes

- **Spec coverage:** Section 1 (branch model) → Tasks 1–2. Section 3 (vehicles collection) → Tasks 3–5. Section 3 admin UI → Task 6. Section 4 (VehiclePicker + form) → Tasks 7–9. Section 5 (seed) → Tasks 10–11. Section 6 (testing) → Tasks 5 and 12.
- **Type consistency checked:** `Vehicle` type (id/plateNumber/vehicleType/branch/category) used identically in `VehiclePicker.tsx`, `admin/kendaraan/page.tsx`, `createVehicle.ts`/`updateVehicle.ts`, and `vehicle.ts` schema. `BRANCHES`/`Branch` imported from the same `lib/branches.ts` everywhere a branch value is validated or listed. `vehicleId` field name matches across `itemSchema`, the pengajuan form's `register`/`setValue` calls, and the seed script's `VehicleSeed` type (which intentionally omits `vehicleId` — vehicles seeded here aren't tied to any submission).
- **Out of scope carried over from spec:** no migration of pre-existing submissions/employees with old bare `WHO`/`WHP`/`SND` branch values; no delete UI for vehicles/employees; no PDF/WA template changes (they already read `itemName`/`brandType`, which stay populated the same way).
