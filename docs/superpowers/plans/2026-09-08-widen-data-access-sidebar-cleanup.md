# Widen Pegawai/Kendaraan Access + Sidebar Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `admin` and `spv` (not just `superadmin`) create/edit/delete `employees`/`vehicles` master data, and remove the sidebar's collapse feature while grouping admin nav items under a "Kelola Data" heading.

**Architecture:** Widen the existing 4-layer authorization pattern (Firestore rules → `/lib` CRUD modules → page route guards → nav-config) from a `role === 'superadmin'` check to a `['admin','spv','superadmin'].includes(role)` check, symmetrically for `employees` and `vehicles`. Add two new delete modules following the existing CRUD module pattern, plus an inline two-step delete confirmation in the two edit pages. Separately, strip the sidebar's collapse state/UI entirely and split its nav rendering into two groups.

**Tech Stack:** Next.js 14 App Router, TypeScript, Firebase client SDK (Firestore), Vitest, `@firebase/rules-unit-testing`.

**Reference spec:** `docs/superpowers/specs/2026-09-08-widen-data-access-sidebar-cleanup-design.md`

---

### Task 1: Widen `firestore.rules` for `employees`/`vehicles` + rules tests

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore-rules.test.ts`

- [ ] **Step 1: Replace the `employees rules` describe block (currently lines 1124-1235) with the widened version**

Find the block starting with `describe("employees rules", () => {` and ending at its matching `});` (currently lines 1124-1235 — re-locate by searching if the file has shifted) and replace the ENTIRE block with:

```ts
  describe("employees rules", () => {
    it("allows admin to read employees", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").get());
    });

    it("allows spv to read employees", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
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
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").get());
    });

    it("denies management from reading employees", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(db.collection("employees").doc("emp-1").get());
    });

    it("allows admin to create an employee", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("employees").doc("emp-2").set({
          name: "Siti Aminah",
          branch: "WHP Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        })
      );
    });

    it("allows spv to create an employee", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("employees").doc("emp-2").set({
          name: "Siti Aminah",
          branch: "WHP Bandung",
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
          branch: "WHP Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        })
      );
    });

    it("denies management from creating an employee", async () => {
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(
        db.collection("employees").doc("emp-2").set({
          name: "Siti Aminah",
          branch: "WHP Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        })
      );
    });

    it("allows admin to update an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").update({ position: "Kepala Gudang" }));
    });

    it("allows spv to update an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").update({ position: "Kepala Gudang" }));
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
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").update({ position: "Kepala Gudang" }));
    });

    it("allows admin to delete an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").delete());
    });

    it("allows spv to delete an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").delete());
    });

    it("allows superadmin to delete an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(db.collection("employees").doc("emp-1").delete());
    });

    it("denies management from deleting an employee", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("employees").doc("emp-1").set({
          name: "Rahmat Hidayat",
          branch: "WHO Bandung",
          department: "Operasional",
          position: "Staff Gudang",
        });
      });
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(db.collection("employees").doc("emp-1").delete());
    });
  });
```

- [ ] **Step 2: Replace the `vehicles rules` describe block with the widened version**

Find the block starting with `describe("vehicles rules", () => {` (right before the file's final `});`) and replace the ENTIRE block with:

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

    it("allows spv to read vehicles", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
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

    it("denies management from reading vehicles", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(db.collection("vehicles").doc("veh-1").get());
    });

    it("allows admin to create a vehicle", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("vehicles").doc("veh-2").set({
          plateNumber: "D 8854 FD",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bogor",
          category: "Mobil",
        })
      );
    });

    it("allows spv to create a vehicle", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
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

    it("denies management from creating a vehicle", async () => {
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(
        db.collection("vehicles").doc("veh-2").set({
          plateNumber: "D 8854 FD",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bogor",
          category: "Mobil",
        })
      );
    });

    it("allows admin to update a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").update({ vehicleType: "GRANMAX S402RP-PMRFJJ MU" }));
    });

    it("allows spv to update a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").update({ vehicleType: "GRANMAX S402RP-PMRFJJ MU" }));
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

    it("allows admin to delete a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").delete());
    });

    it("allows spv to delete a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("vehicles").doc("veh-1").delete());
    });

    it("allows superadmin to delete a vehicle", async () => {
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
      await assertSucceeds(db.collection("vehicles").doc("veh-1").delete());
    });

    it("denies management from deleting a vehicle", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("vehicles").doc("veh-1").set({
          plateNumber: "D 8664 FC",
          vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
          branch: "WHO Bandung",
          category: "Mobil",
        });
      });
      const db = testEnv.authenticatedContext("uid-mgmt").firestore();
      await assertFails(db.collection("vehicles").doc("veh-1").delete());
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail against the current (narrower) rules**

```bash
export PATH="$HOME/.tools/jdk-21.0.12.1+1/bin:$PATH"
npx firebase emulators:exec --only firestore,auth "npx vitest run tests/firestore-rules.test.ts"
```

Expected: FAIL — the new "allows spv to read/create/update/delete" and "allows admin to delete" tests fail because `firestore.rules` doesn't grant those yet.

- [ ] **Step 4: Widen `firestore.rules`**

Replace lines 36-46 (the `employees` and `vehicles` match blocks) with:

```
    match /employees/{employeeId} {
      allow read: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
      allow create, update: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
      allow delete: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
    }

    match /vehicles/{vehicleId} {
      allow read: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
      allow create, update: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
      allow delete: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$HOME/.tools/jdk-21.0.12.1+1/bin:$PATH"
npx firebase emulators:exec --only firestore,auth "npx vitest run tests/firestore-rules.test.ts"
```

Expected: PASS — all tests in the file green.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/firestore-rules.test.ts
git commit -m "feat: widen employees/vehicles firestore rules to admin+spv, add delete"
```

---

### Task 2: `deleteEmployee`/`deleteVehicle` lib modules + widen create/update role checks

**Files:**
- Create: `lib/employees/deleteEmployee.ts`
- Create: `lib/vehicles/deleteVehicle.ts`
- Modify: `lib/employees/createEmployee.ts`
- Modify: `lib/employees/updateEmployee.ts`
- Modify: `lib/vehicles/createVehicle.ts`
- Modify: `lib/vehicles/updateVehicle.ts`

- [ ] **Step 1: Create `lib/employees/deleteEmployee.ts`**

```ts
// lib/employees/deleteEmployee.ts
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/lib/hooks/useAuth";

export async function deleteEmployee(id: string, caller: AppUser): Promise<void> {
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk menghapus data pegawai.");
  }
  await deleteDoc(doc(db, "employees", id));
}
```

- [ ] **Step 2: Create `lib/vehicles/deleteVehicle.ts`**

```ts
// lib/vehicles/deleteVehicle.ts
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/lib/hooks/useAuth";

export async function deleteVehicle(id: string, caller: AppUser): Promise<void> {
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk menghapus data kendaraan.");
  }
  await deleteDoc(doc(db, "vehicles", id));
}
```

- [ ] **Step 3: Widen the role check in `lib/employees/createEmployee.ts`**

Change:

```ts
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat data pegawai.");
  }
```

to:

```ts
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk membuat data pegawai.");
  }
```

- [ ] **Step 4: Widen the role check in `lib/employees/updateEmployee.ts`**

Change:

```ts
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah data pegawai.");
  }
```

to:

```ts
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk mengubah data pegawai.");
  }
```

- [ ] **Step 5: Widen the role check in `lib/vehicles/createVehicle.ts`**

Change:

```ts
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa membuat data kendaraan.");
  }
```

to:

```ts
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk membuat data kendaraan.");
  }
```

- [ ] **Step 6: Widen the role check in `lib/vehicles/updateVehicle.ts`**

Change:

```ts
  if (caller.role !== "superadmin") {
    throw new Error("Hanya superadmin yang bisa mengubah data kendaraan.");
  }
```

to:

```ts
  if (!["admin", "spv", "superadmin"].includes(caller.role)) {
    throw new Error("Anda tidak punya akses untuk mengubah data kendaraan.");
  }
```

- [ ] **Step 7: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/employees/deleteEmployee.ts lib/vehicles/deleteVehicle.ts lib/employees/createEmployee.ts lib/employees/updateEmployee.ts lib/vehicles/createVehicle.ts lib/vehicles/updateVehicle.ts
git commit -m "feat: widen employee/vehicle CRUD role checks to admin+spv, add delete modules"
```

---

### Task 3: Widen page route guards + add delete button to edit pages

**Files:**
- Modify: `app/(dashboard)/admin/pegawai/page.tsx`
- Modify: `app/(dashboard)/admin/pegawai/new/page.tsx`
- Modify: `app/(dashboard)/admin/pegawai/edit/page.tsx`
- Modify: `app/(dashboard)/admin/kendaraan/page.tsx`
- Modify: `app/(dashboard)/admin/kendaraan/new/page.tsx`
- Modify: `app/(dashboard)/admin/kendaraan/edit/page.tsx`

- [ ] **Step 1: Widen the route guard in all 6 files**

In each of the 6 files listed above, find:

```ts
  useEffect(() => {
    if (!loading && appUser && appUser.role !== "superadmin") {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);
```

and change the condition to:

```ts
  useEffect(() => {
    if (!loading && appUser && !["admin", "spv", "superadmin"].includes(appUser.role)) {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);
```

(Do NOT touch `app/(dashboard)/admin/page.tsx`, `app/(dashboard)/admin/new/page.tsx`, `app/(dashboard)/admin/edit/page.tsx`, or `app/(dashboard)/admin/data/page.tsx` — those stay superadmin-only, out of scope.)

- [ ] **Step 2: Add the delete button to `app/(dashboard)/admin/pegawai/edit/page.tsx`**

Add the import for `deleteEmployee` next to the `updateEmployee` import:

```ts
import { deleteEmployee } from "@/lib/employees/deleteEmployee";
```

Add two new pieces of state inside `EditEmployeeContent`, right after the existing `serverError` state:

```ts
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
```

Add a `handleDelete` function right after the existing `onSubmit` function:

```ts
  async function handleDelete() {
    if (!appUser || !id) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteEmployee(id, appUser);
      router.push("/admin/pegawai");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus data pegawai.");
      setIsDeleting(false);
    }
  }
```

In the JSX, right after the closing `</form>` tag and before the closing `</CardContent>` tag, add:

```tsx
          <div className="mt-2 border-t pt-4">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Yakin hapus data pegawai ini?</span>
                <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Menghapus..." : "Ya, Hapus"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                >
                  Batal
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Hapus Pegawai
              </Button>
            )}
            {deleteError && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}
          </div>
```

So the full `<CardContent>` block ends up as: `<form>...</form>` followed immediately by this new `<div className="mt-2 border-t pt-4">...</div>`, both direct children of `<CardContent className="pt-6">`.

- [ ] **Step 3: Add the delete button to `app/(dashboard)/admin/kendaraan/edit/page.tsx`**

Same pattern as Step 2, adapted for vehicles. Add the import next to `updateVehicle`:

```ts
import { deleteVehicle } from "@/lib/vehicles/deleteVehicle";
```

Add the same three state variables inside `EditVehicleContent`:

```ts
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
```

Add `handleDelete` after `onSubmit`:

```ts
  async function handleDelete() {
    if (!appUser || !id) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteVehicle(id, appUser);
      router.push("/admin/kendaraan");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus data kendaraan.");
      setIsDeleting(false);
    }
  }
```

Add the same JSX block (with "Yakin hapus data kendaraan ini?" and "Hapus Kendaraan" as the label text instead) right after `</form>`:

```tsx
          <div className="mt-2 border-t pt-4">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Yakin hapus data kendaraan ini?</span>
                <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Menghapus..." : "Ya, Hapus"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                >
                  Batal
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Hapus Kendaraan
              </Button>
            )}
            {deleteError && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}
          </div>
```

- [ ] **Step 4: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/admin/pegawai" "app/(dashboard)/admin/kendaraan"
git commit -m "feat: widen pegawai/kendaraan page guards to admin+spv, add delete UI"
```

---

### Task 4: Widen `nav-config.ts` roles + add `group` field

**Files:**
- Modify: `components/app-shell/nav-config.ts`

- [ ] **Step 1: Add the `group` field to `NavItem` and update `NAV_ITEMS`**

Replace the whole `export type NavItem = {...}` and `export const NAV_ITEMS: NavItem[] = [...]` block with:

```ts
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: AppUser["role"][];
  group?: "data";
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
    group: "data",
  },
  {
    href: "/admin/pegawai",
    label: "Data Pegawai",
    icon: Contact,
    roles: ["admin", "spv", "superadmin"],
    group: "data",
  },
  {
    href: "/admin/kendaraan",
    label: "Data Kendaraan",
    icon: Car,
    roles: ["admin", "spv", "superadmin"],
    group: "data",
  },
  {
    href: "/admin/data",
    label: "Manajemen Data",
    icon: DatabaseBackup,
    roles: ["superadmin"],
    group: "data",
  },
];
```

- [ ] **Step 2: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/app-shell/nav-config.ts
git commit -m "feat: widen pegawai/kendaraan nav roles, add data group field"
```

---

### Task 5: Remove sidebar collapse feature, add "Kelola Data" grouping

**Files:**
- Modify: `components/app-shell/Sidebar.tsx`
- Modify: `components/app-shell/AppShell.tsx`

- [ ] **Step 1: Rewrite `components/app-shell/Sidebar.tsx`**

Replace the entire file with:

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { Car, LogOut, X } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/hooks/useAuth";
import { navItemsForRole, ROLE_LABEL, type NavItem } from "./nav-config";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Sidebar({
  appUser,
  mobileOpen,
  onCloseMobile,
}: {
  appUser: AppUser;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navItemsForRole(appUser.role);
  const mainItems = items.filter((item) => item.group !== "data");
  const dataItems = items.filter((item) => item.group === "data");
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => {
    if (!mobileOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseMobile();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  function renderItem(item: NavItem) {
    const active = item.href === activeHref;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onCloseMobile}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)] shadow-sm"
            : "text-[var(--sidebar-foreground)]/75 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]"
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-64 flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] transition-all duration-200 ease-out md:sticky md:top-0 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-[var(--sidebar-border)] px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Car className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-sm font-bold leading-tight">Pengajuan</p>
            <p className="truncate text-[11px] leading-tight text-[var(--sidebar-foreground)]/60">
              Kendaraan &amp; Perlengkapan
            </p>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] md:hidden"
            aria-label="Tutup menu"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {mainItems.map(renderItem)}
          {dataItems.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--sidebar-foreground)]/50">
                Kelola Data
              </p>
              {dataItems.map(renderItem)}
            </>
          )}
        </nav>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2.5 rounded-lg p-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-semibold">
              {initialsFor(appUser.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{appUser.name}</p>
              <p className="truncate text-[11px] leading-tight text-[var(--sidebar-foreground)]/60">
                {ROLE_LABEL[appUser.role]}
                {appUser.branch ? ` · ${appUser.branch}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Keluar"
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-foreground)]/60 hover:bg-[var(--sidebar-accent)] hover:text-red-300"
              aria-label="Keluar"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Rewrite `components/app-shell/AppShell.tsx`**

Replace the entire file with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { AppUser } from "@/lib/hooks/useAuth";
import { loadGoogleIdentityServices } from "@/lib/drive-upload";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ appUser, children }: { appUser: AppUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    // Preload the Google Identity Services script ahead of time so that when
    // the user later clicks to upload a file, requestAccessToken() fires
    // synchronously within that click's user-activation window instead of
    // after an async script-load delay — Chrome silently blocks the OAuth
    // popup ("Failed to open popup window") once that window has expired.
    loadGoogleIdentityServices().catch(() => {});
  }, []);

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar appUser={appUser} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/app-shell/Sidebar.tsx components/app-shell/AppShell.tsx
git commit -m "feat: remove sidebar collapse, group admin nav under Kelola Data"
```

---

### Task 6: Update `CLAUDE.md`'s "never delete" exception wording

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the delete-exception paragraph**

Find this paragraph in the "Firestore Security Rules (garis besar)" section:

```
- **Satu-satunya pengecualian dari prinsip "tidak pernah ada delete" (keputusan sadar 2026-09-04):** role `superadmin` boleh delete `submissions` (+ subcollection `items`/`attachments`/`statusHistory`-nya) dan `counters`, dipakai oleh panel reset data di `/admin/data` (lihat "Manajemen Data" di bawah). Semua role lain, dan semua collection lain (`users`, `employees`), tetap `allow delete: if false` tanpa pengecualian.
```

Replace it with:

```
- **Pengecualian dari prinsip "tidak pernah ada delete":** (1, 2026-09-04) role `superadmin` boleh delete `submissions` (+ subcollection `items`/`attachments`/`statusHistory`-nya) dan `counters`, dipakai oleh panel reset data di `/admin/data` (lihat "Manajemen Data" di bawah). (2, 2026-09-08) role `admin`/`spv`/`superadmin` boleh delete `employees` dan `vehicles` — dipakai tombol "Hapus" di halaman edit `/admin/pegawai` dan `/admin/kendaraan`; menghapus data pegawai/kendaraan tidak menghapus riwayat pengajuan lama karena nama/plat sudah didenormalisasi ke dokumen submission saat dibuat. `users` dan `counters` tetap `allow delete: if false` tanpa pengecualian.
```

- [ ] **Step 2: Update the `employees` rules summary line, and add a `vehicles` line (currently missing entirely)**

In the same "Firestore Security Rules (garis besar)" section, find this line (currently line 149):

```
- `employees/{employeeId}`: read oleh role `admin`/`superadmin` (admin butuh baca untuk mengisi picker pegawai saat membuat pengajuan); create/update hanya oleh `superadmin`; delete selalu ditolak.
```

Replace it with two lines (the `employees` line updated, plus a new `vehicles` line — `vehicles` was never documented in `CLAUDE.md` at all from when it was first added, this closes that pre-existing gap):

```
- `employees/{employeeId}`: read/create/update/delete oleh role `admin`/`spv`/`superadmin` (admin/spv butuh baca untuk mengisi picker pegawai saat membuat pengajuan, dan bisa kelola datanya sendiri lewat `/admin/pegawai`).
- `vehicles/{vehicleId}`: read/create/update/delete oleh role `admin`/`spv`/`superadmin` (dipakai `VehiclePicker` saat membuat pengajuan kendaraan, dikelola lewat `/admin/kendaraan`) — sama persis polanya dengan `employees`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update never-delete exception note for employees/vehicles"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the non-emulator test suite**

Run: `npm test`
Expected: all non-emulator test files pass (same count as before this plan — this plan doesn't add non-emulator tests).

- [ ] **Step 2: Run the emulator-dependent rules suite**

```bash
export PATH="$HOME/.tools/jdk-21.0.12.1+1/bin:$PATH"
npx firebase emulators:exec --only firestore,auth "npm test"
```

Expected: all tests pass, including the new/updated `employees rules` and `vehicles rules` tests from Task 1.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: build succeeds with no TypeScript or lint errors.

- [ ] **Step 4: Manual verification (if browser/dev-server access is available)**

Run `npm run dev`, log in as an `admin` user and separately as an `spv` user, and confirm:
- Sidebar shows no "Ciutkan" button, and shows "Data Pegawai"/"Data Kendaraan" under a "Kelola Data" heading (for `admin`/`spv`, this heading appears above just those 2 items since "Manajemen User"/"Manajemen Data" stay superadmin-only).
- Both roles can open `/admin/pegawai` and `/admin/kendaraan`, create a new entry, edit an existing entry, and delete an entry (confirm the two-step confirm works — clicking "Hapus..." shows "Ya, Hapus"/"Batal", and only actually deletes after clicking "Ya, Hapus").
- Log in as a `management` user and confirm `/admin/pegawai`/`/admin/kendaraan` redirect away (still denied) and neither nav item appears.

If browser/dev-server access isn't practical, skip this step and note it — Task 1's rules tests already exercise this exact permission matrix at the data layer.

- [ ] **Step 5: Report results**

No commit for this task — it's a verification checkpoint. Report the test/build results back to the user.

---

## Self-Review Notes

- **Spec coverage:** Section 2 (firestore.rules) → Task 1. Section 3 (`/lib` modules) → Task 2. Section 4 (page guards + delete UI) → Task 3. Section 5 (nav-config) → Task 4. Section 6 (Sidebar/AppShell) → Task 5. `CLAUDE.md` update mentioned in spec section 2 → Task 6. Testing section → Tasks 1 and 7.
- **Type consistency checked:** `deleteEmployee(id: string, caller: AppUser)` / `deleteVehicle(id: string, caller: AppUser)` signatures match how they're called in Task 3's `handleDelete` functions (`deleteEmployee(id, appUser)` where `id` is the already-guarded non-null `string` from `useSearchParams` — same pattern the existing `getDoc(doc(db, "employees", id as string))` call already uses in the same file, so `id` being possibly-null at the type level but guarded at runtime by the `if (!appUser || !id) return;` check is consistent with existing code in this file). `NavItem`'s new `group?: "data"` field is used identically in `nav-config.ts` (Task 4) and destructured/filtered identically in `Sidebar.tsx` (Task 5).
- **Out of scope confirmed:** `/admin`, `/admin/new`, `/admin/edit`, `/admin/data` (user management, data reset) are explicitly NOT touched in Task 3 — still superadmin-only, matching the spec.
