# Master Data Branch (WHO/WHP City-level) + Kendaraan + Seed Pegawai Operational — Design Spec

**Tanggal:** 2026-09-08
**Status:** Approved

## Latar Belakang

User (superadmin) punya tiga sumber data operasional nyata yang perlu masuk ke aplikasi:

1. Daftar 13 kombinasi cabang WHO/WHP per kota (mis. "Who Bandung", "Whp Tasikmalaya") — dipakai untuk mengkategorikan pengajuan itu berasal dari WHO/WHP kota mana.
2. Database kendaraan (~46 unit): plat nomor, jenis kendaraan, cabang WHO/WHP+kota, dan kategori (Mobil/Motor/Truk) — untuk pengajuan `type: "kendaraan"`.
3. Database pegawai departemen Operational (~100 orang): nama, org (WHO/WHP/HO/HO-O), kota.

Saat ini `employees.branch` cuma enum tiga nilai (`WHO`/`WHP`/`SND`), tanpa kota, dan tidak ada collection `vehicles` sama sekali — form pengajuan kendaraan masih 100% freeform (ketik nama item, merk/tipe, km manual), tidak terhubung ke data aset apa pun.

## Keputusan Desain

### 1. Model `branch` — city-level, sebagai konstanta kode (bukan collection baru)

`branch` (di `employees`, dan otomatis kebawa ke `submission.branch` saat submission dibuat dari data employee) berubah dari enum WHO/WHP/SND jadi kombinasi org+kota. Nilai baru didefinisikan sebagai satu daftar konstanta `BRANCHES` di `lib/branches.ts`:

```
WHO Bandung, WHO Bogor, WHO Cibaduyut, WHO Cirebon, WHO Garut, WHO Karawang,
WHO Purwakarta, WHO Serang, WHO Sukabumi, WHO Tangerang, WHO Tasikmalaya,
WHP Bandung, WHP Tasikmalaya,
HO-O Bandung, HO Tasikmalaya,
SND   // dipertahankan, nilai lama — tidak ada karyawan yang di-seed ke sini lewat data ini
```

Alasan pakai konstanta kode, bukan collection Firestore baru: nilai ini cuma dipakai untuk dropdown + validasi Zod, tidak ada kebutuhan CRUD terpisah lewat UI (beda dengan `employees`/`vehicles` yang memang perlu ditambah/diedit satu-satu oleh superadmin dari waktu ke waktu). `firestore.rules` tidak memvalidasi isi string `branch` (sudah dicek, tidak ada `in [...]` untuk branch di rules manapun), jadi perubahan ini murni di layer Zod schema + UI, tidak menyentuh rules.

Perubahan kode:
- `lib/branches.ts` (baru): export `BRANCHES` (array of string) + turunan type.
- `lib/schemas/employee.ts`: `branch: z.enum(["WHO","WHP","SND"])` → `z.enum(BRANCHES as [string, ...string[]])` (generate dari `lib/branches.ts`, satu sumber).
- `app/(dashboard)/admin/pegawai/new/page.tsx` dan `.../edit/page.tsx`: dropdown branch baca dari `BRANCHES`, bukan tiga opsi hardcoded.

### 2. Collection baru `employees` — sudah ada, tidak berubah struktur

Tidak ada perubahan struktur `employees` selain nilai `branch` di atas. `department`/`position` tetap freeform string seperti sekarang.

### 3. Collection baru `vehicles/{vehicleId}`

```
plateNumber: string     // "D 8664 FC"
vehicleType: string     // "GRANMAX S402RP-PMRFJJ KJ" (jenis kendaraan/model)
branch: string          // salah satu nilai lib/branches.ts, mis. "WHO Bandung"
category: "Mobil" | "Motor" | "Truk"
createdAt: Timestamp
```

Mengikuti pola persis `employees`:
- `lib/schemas/vehicle.ts` (baru): `createVehicleSchema`, `updateVehicleSchema` (mirip `employee.ts`).
- `lib/vehicles/createVehicle.ts` + `updateVehicle.ts` (baru): mirip `lib/employees/createEmployee.ts`/`updateEmployee.ts` — fail-fast cek `caller.role === "superadmin"` di baris pertama.
- `firestore.rules` tambahan:
  ```
  match /vehicles/{vehicleId} {
    allow read: if isSignedIn() && userRole() in ['admin', 'superadmin'];
    allow create, update: if isSignedIn() && userRole() == 'superadmin';
    allow delete: if false;
  }
  ```
- Admin UI baru: `/admin/kendaraan` (list), `/admin/kendaraan/new`, `/admin/kendaraan/edit?id=` — struktur halaman mirroring `/admin/pegawai/*` persis (tabel + form create/edit). `components/app-shell/nav-config.ts` ditambah entry nav baru untuk superadmin.

### 4. `VehiclePicker` di form pengajuan kendaraan

Komponen baru `components/vehicle-picker/VehiclePicker.tsx`, mirip `EmployeePicker` (load semua `vehicles` via `getDocs`, native `<select>`, tampilkan plat nomor + jenis kendaraan).

Di `app/(dashboard)/pengajuan/new/page.tsx`, khusus baris item saat `type === "kendaraan"`: field `itemName` + `brandType` yang sekarang `<input>` manual diganti jadi `VehiclePicker` — memilih kendaraan otomatis mengisi `itemName` = `plateNumber`, `brandType` = `vehicleType` (read-only, didenormalisasi, sama seperti pola `EmployeePicker` mengisi `branch`/`department`/`position` dari `employees`). Field `km`, `quantity`, `unit`, `description` tetap input manual seperti sekarang, tidak berubah. Type `perlengkapan`/`gedung_fasilitas` tidak tersentuh — tetap freeform seperti sekarang.

`itemSchema` di `lib/schemas/submission.ts` dapat tambahan field opsional:
```ts
vehicleId: z.string().nullable().default(null),  // hanya diisi untuk type: kendaraan
```
Dipakai untuk jejak ke master vehicle (laporan/monitoring ke depan), tidak mengubah validasi field lain. Untuk type selain kendaraan, tetap `null`.

### 5. Seed data ke Firestore produksi

Project ini sengaja tidak menyimpan service account/Admin SDK credential untuk produksi (lihat catatan arsitektur di `CLAUDE.md`). Konsisten dengan itu, script seed **pakai Firebase Client SDK, sign-in sebagai akun superadmin yang sudah ada** (bukan Admin SDK) — persis cara `createEmployee`/`createVehicle` menulis dari client biasa, cuma dijalankan sekali lewat Node (`scripts/seed-master-data.ts`), lalu loop panggil modul yang sama yang dipakai UI (`createEmployee`, `createVehicle`).

- Kredensial superadmin dibaca dari environment variable saat dijalankan (`SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`) — tidak di-hardcode, tidak dikomit ke git.
- Data mentah (hasil transkripsi dari data yang diberikan user) disimpan sebagai file JSON yang di-commit ke repo: `scripts/seed-data/employees-operational.json`, `scripts/seed-data/vehicles.json`, supaya bisa direview sebagai teks biasa sebelum script dijalankan — **bukan langsung ditulis ke Firestore dari transkripsi tanpa direview**, karena ini data produksi asli (nama orang, plat kendaraan) dan sumbernya screenshot yang berisiko salah baca (OCR manual: karakter `l`/`1`, `O`/`0`, dsb).
- Alur eksekusi: (1) tulis file JSON dari transkripsi, (2) tampilkan isinya untuk direview user, (3) baru jalankan script setelah user konfirmasi datanya benar, (4) script idempotent-check by nama/plat (skip kalau sudah ada dokumen dengan nama/plat yang sama, supaya aman kalau dijalankan ulang).
- Employee yang di-seed: `department: "Operational"` untuk semua, `position: "-"` (placeholder — tidak ada data jabatan per orang, user akan edit manual lewat `/admin/pegawai` belakangan), `branch` sesuai kombinasi Org+Kota (termasuk kasus khusus "Tamim Abdul Purnama" → `HO Tasikmalaya`, dikonfirmasi user sebagai data valid, bukan typo).
- Vehicle yang di-seed: `branch` diturunkan dari kolom WHO/WHP di sumber data — kalau selnya cuma nama kota (mis. "BANDUNG") → `WHO Bandung`; kalau eksplisit "WHP BANDUNG" → `WHP Bandung`. `category` dari kolom TYPE (Mobil/Motor/Truk).

### 6. Testing

`tests/firestore-rules.test.ts` ditambah test case untuk rule `vehicles` baru — pola sama seperti test `employees` yang sudah ada: role `admin`/`superadmin` bisa read, role lain ditolak; create/update cuma `superadmin`; delete selalu ditolak untuk semua role termasuk superadmin.

## Di Luar Scope

- Tidak membuat collection Firestore terpisah untuk daftar branch (cukup konstanta kode) — lihat alasan di bagian 1.
- Tidak ada perubahan pada alur approve/PDF/WA template — `vehicleId` di item cuma data tambahan untuk jejak, tidak dipakai di PDF/WA saat ini.
- Delete kendaraan/karyawan dari UI tidak ditambahkan (`allow delete: if false` sudah pola standar di seluruh app, employees juga begitu) — kalau data salah, edit, bukan hapus-buat-ulang.
- Migrasi data submission lama yang sudah terlanjur pakai `branch` nilai lama (WHO/WHP/SND tanpa kota) — tidak diubah, submission historis biarkan apa adanya, cuma submission baru yang pakai nilai city-level.
