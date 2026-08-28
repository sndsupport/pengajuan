# Manajemen User tanpa Cloud Functions — Design Spec

**Tanggal:** 2026-08-28
**Status:** Approved

## Latar Belakang

Sub-proyek 4 dari 5 dalam migrasi arsitektur ke Firebase plan Spark. Sub-proyek 1 (upload file), 2 (Firestore Rules — 4 transisi status), dan 3 (generate PDF di client, transisi terakhir) sudah selesai. Sub-proyek ini memindahkan manajemen user (`createUser`, `updateUser`, `resetUserPassword`) yang masih berupa Cloud Functions — satu-satunya bagian aplikasi yang masih bergantung Cloud Functions setelah sub-proyek ini selesai adalah tidak ada; setelah ini seluruh folder `functions/` (kecuali sisa yang memang tidak lagi terpakai) siap dibersihkan di sub-proyek 5.

Keputusan inti sub-proyek ini — pakai trik instance Firebase App kedua untuk `createUser`, dan hapus `resetUserPassword` sepenuhnya — sudah disepakati user di awal sesi migrasi ini (sebelum eksekusi sub-proyek 1 dimulai), saat konsekuensi penuh perpindahan ke plan Spark pertama kali dijelaskan.

Urutan sub-proyek migrasi:
1. Migrasi upload file ke client-side Google Drive — selesai
2. Rewrite Firestore Rules (4 transisi status) — selesai
3. Generate PDF di client (transisi ke-5, terakhir) — selesai
4. **Manajemen user tanpa Cloud Functions (spec ini)**
5. Bersih-bersih: hapus folder `functions/` sisa, update CLAUDE.md

## Keputusan Desain

### 1. `createUser` — trik Firebase App instance kedua

Memanggil `createUserWithEmailAndPassword` pada instance Auth client biasa akan otomatis login sebagai user yang baru dibuat, menggantikan sesi superadmin yang sedang aktif — tidak bisa dipakai langsung. Solusinya: buat instance Firebase App KEDUA (`initializeApp(firebaseConfig, "secondary-user-creation")`) khusus untuk operasi ini, dengan config project yang sama tapi nama app berbeda, supaya sesi baru yang otomatis dibuat terisolasi di situ saja.

Alur `lib/users/createUser.ts`:
1. Validasi caller adalah superadmin (fail-fast, cek `caller.role`) dan validasi input lewat `createUserSchema` (sudah ada, tidak berubah).
2. Buat instance app kedua, ambil Auth-nya.
3. `createUserWithEmailAndPassword(secondaryAuth, usernameToSyntheticEmail(username), password)` — sinkron dengan pola `functions/src/username.ts` yang sudah ada, di-port ke client (`lib/users/username.ts`).
4. `signOut(secondaryAuth)` lalu `deleteApp(secondaryApp)` — bersihkan sesi & instance kedua segera setelah user berhasil dibuat, supaya tidak ada state nyangkut antar pemanggilan.
5. Tulis dokumen `users/{uid}` lewat `db` (instance Firestore utama, dalam konteks sesi superadmin yang tetap aktif) — kalau langkah ini gagal setelah Auth user berhasil dibuat, lempar error yang menyebutkan `uid` secara eksplisit supaya bisa ditelusuri manual (pola yang sama seperti kegagalan parsial di `submitSubmission.ts`, sub-proyek 2), bukan cuma "Gagal membuat user."

Keunikan username (lewat email sintetis `username@pengajuan-tsi.internal`) tetap terjaga gratis — itu constraint bawaan Firebase Auth di levelnya sendiri, tidak berubah baik dipanggil dari Admin SDK maupun client SDK.

### 2. `updateUser` — write Firestore langsung

Tidak melibatkan Firebase Auth sama sekali (Admin SDK sebelumnya juga cuma menulis Firestore untuk operasi ini) — jadi ini murni pindah ke `updateDoc` langsung dari client, dijaga oleh Firestore Rules (superadmin-only). Validasi field lengkap (branch cocok dengan role, dll.) tetap di Zod client-side (`updateUserSchema`, sudah ada, tidak berubah) — konsisten dengan keputusan desain "rules fokus otorisasi, bukan kualitas data" dari sub-proyek 2.

### 3. `resetUserPassword` — dihapus sepenuhnya, tanpa pengganti

Firebase Auth client SDK tidak punya API untuk satu user mengubah password user LAIN (`updatePassword()` hanya berlaku untuk akun yang sedang login sendiri, dan butuh re-autentikasi baru-baru ini). Tidak ada cara client-side yang setara di plan Spark. Dihapus total:
- `functions/src/resetUserPassword.ts` + test
- `resetUserPasswordSchema`/`ResetUserPasswordInput` dari `functions/src/userSchemas.ts`
- Bagian "Reset Password" di `app/(dashboard)/admin/[uid]/page.tsx`, diganti catatan singkat: reset password sekarang harus manual lewat tab Authentication di Firebase Console.

### 4. Firestore Rules — `users/{uid}`

Rule saat ini: `allow write: if false;`. Diganti:

```
allow create, update: if isSignedIn()
  && userRole() == 'superadmin'
  && request.resource.data.role in ['admin_cabang', 'snd', 'spv', 'management', 'superadmin'];
```

Cek `role in [...]` dipertahankan di rules (bukan cuma Zod) karena field ini dipakai di HAMPIR SEMUA rule lain lewat helper `userRole()` — nilai yang tidak valid di sini berisiko bikin evaluasi rule di tempat lain jadi rusak/membingungkan, beda kelas risiko dibanding validasi field biasa seperti `department`/`position` yang murni soal kualitas data dan cukup di Zod saja. Kecocokan `branch` dengan `role` (`isValidBranchForRole`) TIDAK direplikasi ke rules — hanya superadmin yang bisa menulis ke sini sama sekali, jadi risiko cross-user tidak ada, cuma potensi data kotor yang gampang ketahuan lewat review manual.

`allow delete` tetap `if false` (tidak ada fitur hapus user saat ini, di luar scope).

### 5. File client-side baru

- `lib/users/username.ts` — porting `functions/src/username.ts` (fungsi murni, tidak ada dependency Node-spesifik, aman disalin nyaris tanpa perubahan).
- `lib/users/createUser.ts` — alur di atas.
- `lib/users/updateUser.ts` — `updateDoc` langsung + Zod validasi.

### 6. Halaman yang dirombak

`app/(dashboard)/admin/new/page.tsx`, `app/(dashboard)/admin/[uid]/page.tsx` — ganti pemanggilan `httpsCallable(functions, "...")` jadi panggil fungsi baru di `lib/users/` langsung. Bagian "Reset Password" di halaman edit dihapus, diganti catatan singkat seperti di poin 3.

### 7. Dihapus sepenuhnya

`functions/src/createUser.ts`, `updateUser.ts`, `resetUserPassword.ts` + semua test file-nya, `functions/src/username.ts` + test (di-port, bukan dipakai lagi di functions). `functions/src/userSchemas.ts` disederhanakan — `resetUserPasswordSchema`/`ResetUserPasswordInput` dihapus, sisanya (`createUserSchema`, `updateUserSchema`, `roleSchema`, `isValidBranchForRole`) TETAP ADA karena masih dipakai `lib/schemas/user.ts` di client... 

**Catatan penting:** `lib/schemas/user.ts` (client) dan `functions/src/userSchemas.ts` (server) ternyata SUDAH terpisah sejak awal (bukan file yang sama) — begitu `functions/src/createUser.ts`/`updateUser.ts`/`resetUserPassword.ts` dihapus, `functions/src/userSchemas.ts` jadi 100% tidak terpakai di `functions/`, sama seperti kasus `functions/src/schemas.ts` di sub-proyek 2 — dihapus utuh, bukan cuma sebagian export.

`functions/src/index.ts` disederhanakan jadi file kosong (tidak ada Cloud Function tersisa sama sekali setelah sub-proyek ini) dengan satu komentar penjelas — `firebase deploy --only functions` tetap valid dijalankan terhadap index.ts tanpa export sama sekali (cuma berarti tidak ada function yang di-deploy), jadi tidak perlu placeholder export apa pun.

### 8. Testing

`lib/users/username.ts` — porting test yang sudah ada, fungsi murni, bisa dijalankan penuh di Vitest tanpa emulator.

`lib/users/createUser.ts` — bergantung pada Firebase Auth client SDK (instance app kedua) yang tidak bisa disimulasikan tanpa emulator/browser sungguhan di mesin ini. Ditulis lengkap tapi tidak dijalankan, mengikuti pola yang sama seperti `uploadToDriveClient` (sub-proyek 1) dan `generateSubmissionPdfClient` (sub-proyek 3).

`lib/users/updateUser.ts` — murni Firestore write, sama seperti fungsi-fungsi `lib/submissions/*.ts` lain, ditulis tapi tidak dijalankan (butuh emulator).

`tests/firestore-rules.test.ts` — ditambah test untuk rule `users/{uid}` yang baru (allow superadmin create/update, deny role lain, deny role dengan nilai tidak valid) — mengikuti pola yang sudah ada, tidak bisa dijalankan di mesin ini.

## Di Luar Scope

- Fitur hapus user — tidak ada di aplikasi saat ini, tetap di luar scope.
- Sinkronisasi akun ERP (opsi yang disebut di CLAUDE.md bagian "Integrasi Akun ERP") — keputusan terpisah yang belum diambil, tidak terpengaruh migrasi ini.
- Mekanisme reset password pengganti (misal lewat email reset link Firebase Auth) — bisa jadi ide masa depan, tapi bukan bagian dari migrasi Spark plan ini; keputusan sudah diambil untuk menghapus fitur ini sepenuhnya untuk sekarang.
