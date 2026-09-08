# Perluasan Akses Kelola Data Pegawai/Kendaraan + Rapikan Sidebar — Design Spec

**Tanggal:** 2026-09-08
**Status:** Approved

## Latar Belakang

`/admin/pegawai` (employees) dan `/admin/kendaraan` (vehicles) — dua master-data collection yang dipakai admin saat membuat pengajuan (lihat `docs/superpowers/specs/2026-09-08-master-data-branch-kendaraan-pegawai-design.md`) — sekarang dikunci **superadmin-only** di empat lapis: `firestore.rules` (read/create/update), modul `/lib` (`createEmployee`/`updateEmployee`/`createVehicle`/`updateVehicle`), guard halaman admin, dan entry nav. User (superadmin) minta role `admin` dan `spv` (AWS Supervisor) juga bisa create/update/delete kedua master-data ini — sebelumnya `admin` cuma bisa baca (`read`), `spv` bahkan tidak bisa baca sama sekali.

Terpisah, user juga minta sidebar dirapikan: hapus tombol "Ciutkan" (collapse), dan kelompokkan menu terkait data-management di bawah judul kecil.

## Keputusan Desain

### 1. Role yang dapat create/update/delete `employees`/`vehicles`

`admin`, `spv`, `superadmin` — ketiganya diperlakukan sama persis (tidak ada tingkatan izin berbeda antar tiga role ini untuk kedua collection ini). Role `management` **tidak** ikut diperluas — tetap tidak bisa akses menu ini sama sekali, sesuai konfirmasi user.

### 2. `firestore.rules`

Untuk `match /employees/{employeeId}` dan `match /vehicles/{vehicleId}` (dua block terpisah, perubahan identik di masing-masing):

```
allow read: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
allow create, update: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
allow delete: if isSignedIn() && userRole() in ['admin', 'spv', 'superadmin'];
```

`delete` berubah dari `if false` — ini **exception kedua** terhadap prinsip "tidak pernah hapus" yang selama ini cuma punya satu exception (reset submissions oleh superadmin di `/admin/data`, lihat komentar `isSuperadmin()` di `firestore.rules`). `CLAUDE.md` bagian "Firestore Security Rules (garis besar)" punya baris eksplisit yang jadi tidak akurat setelah ini: "Semua role lain, dan semua collection lain (`users`, `employees`), tetap `allow delete: if false` tanpa pengecualian" — baris ini diupdate untuk menyebutkan exception baru ini (dan judul frasa "Satu-satunya pengecualian..." di atasnya juga perlu disesuaikan karena sudah bukan satu-satunya lagi).

Hapus data pegawai/kendaraan **tidak** menghapus riwayat pengajuan lama — `employeeName`/`itemName` (untuk vehicle) sudah didenormalisasi ke dokumen submission saat dibuat, jadi tetap utuh di pengajuan yang sudah ada. Hanya `EmployeePicker`/`VehiclePicker` yang tidak akan menampilkan entri yang sudah dihapus untuk pengajuan baru.

`users` dan `counters` tidak berubah — tetap `allow delete: if false` tanpa pengecualian, di luar scope ini.

### 3. Modul `/lib`

`lib/employees/createEmployee.ts`, `updateEmployee.ts`, `lib/vehicles/createVehicle.ts`, `updateVehicle.ts`: baris fail-fast diubah dari

```ts
if (caller.role !== "superadmin") {
  throw new Error("Hanya superadmin yang bisa ...");
}
```

jadi

```ts
if (!["admin", "spv", "superadmin"].includes(caller.role)) {
  throw new Error("Anda tidak punya akses untuk ...");
}
```

Dua modul baru dengan pola identik: `lib/employees/deleteEmployee.ts`, `lib/vehicles/deleteVehicle.ts` — fail-fast role check yang sama, lalu `deleteDoc(doc(db, "employees"/"vehicles", id))`. Tidak perlu validasi Zod (tidak ada payload selain id).

### 4. Halaman admin

Guard `useEffect` di `/admin/pegawai/page.tsx`, `new/page.tsx`, `edit/page.tsx`, dan `/admin/kendaraan/page.tsx`, `new/page.tsx`, `edit/page.tsx` — dari:

```ts
if (!loading && appUser && appUser.role !== "superadmin") {
  router.replace("/pengajuan");
}
```

jadi:

```ts
if (!loading && appUser && !["admin", "spv", "superadmin"].includes(appUser.role)) {
  router.replace("/pengajuan");
}
```

**Tombol Hapus** ditambah di kedua halaman edit (`/admin/pegawai/edit`, `/admin/kendaraan/edit`), di bawah tombol "Simpan Perubahan": pola konfirmasi inline dua-langkah dengan local state `boolean` (mis. `confirmingDelete`) — klik "Hapus" pertama kali menampilkan `Button variant="destructive"` "Ya, Hapus" + tombol "Batal" di sampingnya; klik "Ya, Hapus" memanggil `deleteEmployee`/`deleteVehicle` lalu redirect ke halaman list. Tidak pakai dialog modal (belum ada komponen dialog di `components/ui/`) atau pola ketik-frasa (skala risiko satu-baris beda jauh dari reset massal di `/admin/data`).

### 5. `components/app-shell/nav-config.ts`

Entry `/admin/pegawai` dan `/admin/kendaraan`: `roles` dari `["superadmin"]` jadi `["admin", "spv", "superadmin"]`. Entry `/admin` (manajemen user) dan `/admin/data` (export/reset) **tidak berubah** — tetap `["superadmin"]`, di luar scope permintaan ini.

Tambah field opsional `group?: "data"` ke tipe `NavItem`, diisi di keempat entry admin (`/admin`, `/admin/pegawai`, `/admin/kendaraan`, `/admin/data`). Entry lain (`/pengajuan`, `/persetujuan`, `/monitoring`) tidak diberi `group` (tetap `undefined`).

### 6. `components/app-shell/Sidebar.tsx` + `AppShell.tsx`

**Hapus fitur ciutkan sepenuhnya:**
- `AppShell.tsx`: hapus state `collapsed`, `setCollapsed`, `toggleCollapsed`, `useEffect` yang baca `localStorage.getItem("sidebar-collapsed")`, dan prop `collapsed`/`onToggleCollapsed` yang dioper ke `<Sidebar>`.
- `Sidebar.tsx`: hapus prop `collapsed`/`onToggleCollapsed` dari signature, hapus tombol "Ciutkan" (`<button onClick={onToggleCollapsed}>...Ciutkan</button>`), hapus semua render kondisional `collapsed ? ... : ...` / `{!collapsed && (...)}` (header teks "Pengajuan Kendaraan & Perlengkapan", label nav item, kartu profil nama+role) — konten-konten itu SELALU dirender sekarang, tidak lagi disembunyikan. Class `collapsed ? "md:w-[76px]" : "md:w-64"` disederhanakan jadi `"md:w-64"` tetap (fixed width, tidak ada state lain untuk width).
- Import `ChevronsLeft`, `ChevronsRight` dari `lucide-react` dihapus (tidak dipakai lagi).

**Kelompokkan menu:** `Sidebar.tsx` merender `items` (hasil `navItemsForRole`) dalam dua bagian: item dengan `group !== "data"` dirender seperti biasa di `<nav>` pertama; kalau ada item dengan `group === "data"` yang lolos filter role, dirender di `<nav>` kedua didahului judul kecil `<p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--sidebar-foreground)]/50">Kelola Data</p>` — heading ini cuma dirender kalau array item grup itu tidak kosong (supaya role `admin`/`spv` yang cuma lihat 2 dari 4 item grup tetap dapat heading di atas 2 item itu, tapi role tanpa item grup sama sekali — kalau ada di masa depan — tidak dapat heading kosong).

## Testing

- `firestore-rules.test.ts`: update test case existing yang mengasumsikan "denies admin from creating an employee/vehicle" dan "denies spv from reading employees/vehicles" — dibalik jadi "allows". Tambah test baru: `spv` bisa create/update/delete employee & vehicle (mirror test yang sudah ada untuk superadmin), `admin` bisa delete, `management` tetap ditolak read/create/update/delete untuk kedua collection ini (test baru, belum ada sebelumnya).
- Tidak ada test file untuk `Sidebar.tsx`/`AppShell.tsx` (tidak ada test UI komponen lain di codebase ini juga) — verifikasi manual/build only, konsisten dengan konvensi yang sudah ada.

## Di Luar Scope

- Role `management` tidak ikut diperluas aksesnya ke `employees`/`vehicles` (konfirmasi eksplisit user).
- `/admin` (manajemen user, akun login) dan `/admin/data` (export Excel/reset) tidak diubah — tetap superadmin-only.
- Delete `users`/`counters` tidak diubah — tetap `allow delete: if false` tanpa pengecualian.
- Spacing/visual polish sidebar di luar pengelompokan menu (user konfirmasi cukup pengelompokan + hapus tombol ciutkan).
