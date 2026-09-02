# Restrukturisasi Role: Admin Terpusat + Data Master Pegawai — Design Spec

**Tanggal:** 2026-09-02
**Status:** Approved

## Latar Belakang

Role `admin_cabang` (WHO/WHP) dan `snd` selama ini dipakai oleh staf cabang untuk submit pengajuan mereka sendiri langsung di app. Perubahan bisnis: staf cabang **tidak lagi punya akun/login di app**. Mereka mengirim permintaan (data + tanda tangan yang sudah ada) ke satu admin terpusat lewat kanal di luar app (WA/telepon/dsb). Admin memfilter secara manual di luar app, lalu **menginput pengajuan ke app atas nama pegawai tersebut** untuk keperluan approval dan monitoring.

Ini mengganti dua role (`admin_cabang`, `snd`) dengan satu role `admin`, dan menambah konsep baru: **data master pegawai** (bukan akun login) yang dipilih admin saat membuat pengajuan.

## Keputusan Desain

### 1. Role: satu `admin` terpusat

`roleSchema` (`lib/schemas/user.ts`) berubah dari `["admin_cabang", "snd", "spv", "management", "superadmin"]` menjadi `["admin", "spv", "management", "superadmin"]`. Role `admin` tidak terikat cabang — `branch` di dokumen usernya `null`, mengikuti pola `spv`/`management`/`superadmin` yang sudah ada di `isValidBranchForRole()`. Cukup satu akun `admin` untuk seluruh perusahaan (keputusan sadar — bukan satu admin per cabang).

### 2. Koleksi baru `employees/{employeeId}` — data master pegawai

Bukan akun Firebase Auth, murni data referensi yang dipilih admin saat membuat pengajuan:

```
employees/{employeeId}
  name: string
  branch: "WHO" | "WHP" | "SND"
  department: string
  position: string
  createdAt: Timestamp
```

Dikelola superadmin lewat halaman baru `/admin/pegawai` (list) + `/admin/pegawai/new` + `/admin/pegawai/edit?id=` — pola sama seperti manajemen user sekarang (create + edit, tanpa hapus, konsisten dengan `users` yang juga tidak punya delete).

Firestore rules `employees/{id}`: `read` untuk role `admin`/`superadmin` (admin butuh baca untuk mengisi picker); `create`/`update` hanya `superadmin`; `delete` selalu ditolak.

Database kendaraan (disebut sekilas dalam diskusi) **di luar scope** — proyek terpisah untuk nanti.

### 3. Submission model — field baru untuk identitas pemohon

Field `requesterId` pada `submissions/{id}` **tetap diisi uid admin** (bukan uid pegawai — pegawai tidak punya uid). Ini dipertahankan karena `requesterId` dipakai untuk ownership checks di alur berikutnya (retry generate PDF, konfirmasi kirim GA, tandai selesai) yang semuanya tetap dilakukan admin atas nama pegawai.

Identitas pemohon asli (untuk ditampilkan di PDF & dashboard) disimpan terpisah, didenormalisasi saat submission dibuat — pola yang sama seperti `employeeName` yang sudah ada di submission `personalia`:

- **Tipe operasional** (`kendaraan`/`perlengkapan`/`gedung_fasilitas`): tambah field baru `employeeId` (ref) dan `employeeName` (snapshot nama) ke `createSubmissionSchema` & dokumen submission. `branch`/`department`/`position` submission diisi dari data `employees/{employeeId}` yang dipilih, bukan dari profil admin (yang `branch`-nya `null`).
- **Tipe `personalia`**: field `employeeName` sudah ada (selama ini teks bebas). Tambah field opsional `employeeId` — diisi kalau pemohon di-pick lewat data master (path admin), dibiarkan kosong kalau `spv` submit permintaan cuti/izin miliknya sendiri (path lama, tidak berubah — lihat poin 5).

`generateAndAttachSubmissionPdf.ts` yang saat ini `getDoc(users/{requesterId})` untuk ambil `requesterName` untuk PDF, diganti baca langsung `submission.employeeName` — tidak perlu lookup lagi, dan sekaligus benar secara semantik (nama pemohon, bukan nama admin yang login).

### 4. Nomor pengajuan pakai cabang pegawai, bukan cabang admin

`getNextSubmissionNumber()` di `submitSubmission.ts`/`submitPersonaliaSubmission.ts` saat ini dipanggil dengan `caller.branch!`. Karena admin `branch`-nya `null`, ini harus diganti jadi cabang dari `employees/{employeeId}` yang dipilih (untuk path admin) — nomor pengajuan tetap mencerminkan cabang pemohon asli, bukan admin.

### 5. Form Buat Pengajuan — picker pegawai + upload tanda tangan (sudah ada mekanismenya)

`/pengajuan/new` untuk tipe operasional: hanya bisa diakses role `admin` (ganti dari `admin_cabang`/`snd`). Tambah picker pegawai (pilih dari `employees`) di awal form — begitu dipilih, tampilkan (read-only) branch/departemen/posisi milik pegawai itu.

Tanda tangan pemohon: form **sudah punya** toggle "Gambar" (canvas `SignaturePad`) vs "Upload File" (`FileUpload` dengan `purpose="signature"`, upload lewat `uploadToDriveClient`) — dibangun untuk kasus persis ini. Yang perlu diubah: `PURPOSE_CONFIG.signature.acceptedTypes` di `components/file-upload/FileUpload.tsx` saat ini cuma `image/png` — perlu ditambah `image/jpeg` karena tanda tangan yang dikirim pegawai lewat WA kemungkinan besar berupa foto JPEG, bukan PNG transparan.

Untuk `personalia`: tidak ada perubahan mekanisme upload (personalia memang tidak punya field tanda tangan terpisah — cuma 1 attachment dokumen, sudah sesuai pola "dokumen yang dikirim pegawai sudah lengkap").

### 6. Personalia — admin dapat akses penuh, spv tidak berubah

`ALLOWED_ROLES_BY_SUBTYPE` di `submitPersonaliaSubmission.ts` berubah:
```
lembur: ["admin"],           // sebelumnya ["admin_cabang", "snd"]
cuti:   ["admin", "spv"],    // sebelumnya ["admin_cabang", "snd", "spv"]
izin:   ["admin", "spv"],
```
Untuk role `admin`: employeeName dipilih lewat picker pegawai (employeeId terisi), branch/department/position diambil dari data pegawai. Untuk role `spv` yang submit cuti/izin miliknya sendiri: **path lama dipertahankan apa adanya** — employeeName tetap input teks bebas, branch/department/position tetap dari profil spv sendiri, employeeId dibiarkan kosong. Ini sesuai keputusan bahwa alur spv tidak berubah.

### 7. PDF template — kotak tanda tangan ukuran tetap

`lib/pdf/pdfTemplate.ts` saat ini `.signature-block img { max-height: 60px; margin: 8px 0; }` tanpa batas lebar — aman untuk tanda tangan hasil canvas (rasio kecil & konsisten), tapi berisiko untuk foto tanda tangan yang di-upload (rasio bisa lebar, ada background kertas). Perbaikan: bungkus `<img>` tiap blok tanda tangan dalam kotak berukuran tetap (mis. 180×60px) dengan `object-fit: contain`, supaya gambar rasio apa pun muat proporsional tanpa merusak layout dua kolom "Pemohon"/"Mengetahui".

### 8. Firestore Rules

- `isRequesterRole()` (baris 13-15 `firestore.rules`) — satu titik perubahan: `userRole() in ['admin_cabang', 'snd']` → `userRole() == 'admin'`. Karena helper ini dipakai di rule create submissions, items, attachments, dan counters, perubahan di satu tempat ini otomatis berlaku di semua jalur itu.
- `users/{uid}` update rule (baris 21) — daftar role valid: `['admin_cabang', 'snd', 'spv', 'management', 'superadmin']` → `['admin', 'spv', 'management', 'superadmin']`.
- Resubmit rule (`hasOnly` di baris 45) — tambah `employeeId`, `employeeName`, `branch`, `department`, `position` ke daftar field yang boleh berubah saat resubmit setelah revisi (admin mungkin perlu koreksi pegawai/cabang saat revisi).
- Rules baru untuk `employees/{id}`: seperti dijelaskan di poin 2.

### 9. UI lain yang ikut berubah

- `components/app-shell/nav-config.ts`: array `roles` di menu "Pengajuan Saya" (`["admin_cabang", "snd", "spv"]` → `["admin", "spv"]`) dan `ROLE_LABEL` (`admin_cabang`+`snd` → `admin: "Admin"`).
- `/admin/new`, `/admin/edit` (form kelola user): pilihan role di dropdown diganti, field cabang otomatis disembunyikan/dikunci `null` untuk role `admin` (sudah ada pola ini untuk `spv`/`management`).
- Halaman monitoring/list yang menampilkan label role diikutkan menyesuaikan.

### 10. Migrasi data existing (bukan kode, catatan operasional)

App sudah live dengan user asli ber-role `admin_cabang`/`snd`. Perubahan skema role **tidak otomatis memigrasikan dokumen `users` yang sudah ada** — dokumen lama akan lolos baca (rules baca tidak divalidasi ulang), tapi tidak akan lolos schema kalau di-edit ulang lewat form (karena role lama sudah tidak ada di enum). Langkah pasca-deploy (manual, dilakukan superadmin, di luar scope implementasi kode):
1. Buat 1 akun baru role `admin`.
2. Re-entry data staf cabang yang sebelumnya jadi user `admin_cabang`/`snd` sebagai data `employees`.
3. Nonaktifkan/hapus akun `admin_cabang`/`snd` lama secara manual (lewat Firebase Console, karena app tidak punya fitur hapus user).

Tidak dibangun script migrasi otomatis untuk langkah ini kecuali diminta terpisah.

## Testing

- `lib/schemas/user.test.ts`: update test role enum & `isValidBranchForRole` untuk `admin`.
- `lib/schemas/submission.test.ts`: tambah test `employeeId` wajib untuk `createSubmissionSchema`; test `employeeId` opsional untuk personalia.
- `tests/firestore-rules.test.ts`: update test create submission (role `admin` bukan `admin_cabang`/`snd`); tambah test collection `employees` (read admin/superadmin, write hanya superadmin, delete selalu ditolak); update test resubmit `hasOnly`.
- Manual QA end-to-end (emulator): admin pilih pegawai → isi item → upload tanda tangan (JPEG) → submit → approve → generate PDF → cek `employeeName` & tanda tangan tampil benar dan proporsional di PDF, nomor pengajuan pakai cabang pegawai yang dipilih (bukan kosong/error).

## Di Luar Scope

- Database kendaraan (plat nomor, jenis, dll) — proyek terpisah.
- Fitur hapus data pegawai atau hapus akun user dari dalam app.
- Script migrasi otomatis untuk user `admin_cabang`/`snd` existing ke `employees`.
- Perubahan alur approval, WA template, konfirmasi kirim GA, tandai selesai — semua tetap seperti sekarang, hanya sumber identitas pemohon yang berubah.
