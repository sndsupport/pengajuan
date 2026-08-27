# Manajemen User (Superadmin) — Design Spec

**Tanggal:** 2026-08-27
**Status:** Approved

## Latar Belakang

Sub-proyek kedua dari rencana pengerjaan checklist MVP yang tersisa (lihat urutan di `docs/superpowers/specs/2026-08-27-login-username-design.md`). Sejak login beralih ke username (sub-proyek #1), akun tidak lagi disinkronkan dari ERP — dibuat & dikelola manual oleh superadmin. Spec ini membangun halaman untuk itu: Buat User, Edit User, dan Reset Password.

Urutan sub-proyek checklist MVP:
1. Login Username — selesai
2. **Manajemen User (superadmin)** — spec ini
3. `generateSubmissionPdf`
4. Copy Template WA + `confirmSentToGa`
5. Tombol Tandai Selesai + `markAsDone`
6. Dashboard Monitoring

## Keputusan Desain

### 1. Scope aksi

Hanya **Create, Edit, Reset Password**. Nonaktifkan/hapus user di luar scope MVP ini (keputusan eksplisit) — kalau ada user yang keluar, datanya cukup dibiarkan atau role/data-nya diubah manual nanti.

### 2. Username permanen

Username **tidak bisa diubah** setelah user dibuat — bukan bagian dari field yang bisa di-edit. Alasan: mengubah username berarti mengubah email di Firebase Auth juga (butuh `auth.updateUser` email + verifikasi ulang uniqueness), menambah kompleksitas yang tidak sepadan untuk MVP. Salah ketik username saat create berarti buat ulang akun.

### 3. Password awal diisi manual

Form Buat User punya field password biasa (bukan auto-generate) — superadmin mengetik sendiri password awal dan menyampaikannya ke user secara out-of-band (WA/lisan). Minimal 6 karakter (syarat Firebase Auth).

### 4. Aturan branch mengikuti role

Konsisten dengan model data & seed data yang sudah ada (`docs/superpowers/specs/2026-08-27-login-username-design.md` dan `scripts/seed-emulator.ts`):

| role | branch |
|---|---|
| `admin_cabang` | dipilih user: `"WHO"` atau `"WHP"` |
| `snd` | selalu `"SND"`, tidak bisa dipilih lain |
| `spv` / `management` / `superadmin` | selalu `null`, field disembunyikan di form |

### 5. Tidak ada Cloud Function untuk listing

Rule `users/{uid}` sudah mengizinkan `read` untuk pemilik dokumen atau role `spv`/`management`/`superadmin` (lihat `firestore.rules`). Karena rule ini tidak bergantung pada isi dokumen (hanya role si pembaca), query `collection("users")` tanpa filter oleh superadmin otomatis lolos rule per-dokumen. Jadi halaman list user cukup pakai `onSnapshot` langsung dari client, sama seperti pola `submissions` di halaman Antrian Persetujuan — tidak perlu Cloud Function baru untuk ini.

### 6. Tiga Cloud Functions baru (write tetap lewat Admin SDK)

`users/{uid}` write sudah `if false` di rules — tidak berubah. Tiga callable baru, semua fail-fast kalau `context.auth` kosong atau role caller bukan `superadmin`:

- **`createUser`**: input `{ name, username, password, role, branch, department, position, email? }`. Alur: normalisasi username → email sintetis → `auth.createUser({ email, password, displayName: name })` → tulis `users/{uid}` di Firestore. Kalau `auth.createUser` gagal dengan `auth/email-already-exists`, lempar `HttpsError("already-exists", "Username sudah dipakai.")`.
- **`updateUser`**: input `{ uid, name, role, branch, department, position, email? }` (tanpa `username`, tanpa `password`). Update dokumen `users/{uid}` langsung. Tidak menyentuh Firebase Auth (displayName Auth tidak dipakai di alur manapun di aplikasi ini, jadi tidak perlu disinkronkan — YAGNI).
- **`resetUserPassword`**: input `{ uid, newPassword }`. Panggil `auth.updateUser(uid, { password: newPassword })`. Tidak menyentuh Firestore.

### 7. Duplikasi skema & util ke `functions/src/` (mengikuti pola existing)

`functions/src/schemas.ts` sudah menduplikasi `lib/schemas/submission.ts` sejak Fase 1, karena `functions/` adalah proyek TypeScript terpisah dengan `rootDir: src` sendiri dan tidak bisa import lintas folder ke root `lib/`. Spec ini melanjutkan pola yang sama, bukan penyimpangan baru:

- `lib/schemas/user.ts` (client, canonical) — di-duplikasi jadi `functions/src/userSchemas.ts`.
- `lib/auth/username.ts` (client, canonical, sudah ada dari sub-proyek #1) — di-duplikasi jadi `functions/src/username.ts`.

### 8. Halaman baru

- **`/admin`** — tabel semua user: Nama, Username, Role, Cabang, Departemen, Posisi, tombol "Edit" per baris, tombol "Buat User" di atas. Guard: `useEffect` redirect ke `/pengajuan` kalau `appUser.role !== "superadmin"` (pola sama seperti guard di `/persetujuan`).
- **`/admin/new`** — form Buat User. Field branch berubah otomatis/disembunyikan sesuai role yang dipilih (lihat poin 4). Sukses → redirect ke `/admin`.
- **`/admin/[uid]`** — dua form terpisah di satu halaman: "Edit Data User" (tanpa field username) dan "Reset Password" (field password baru, submit terpisah, tidak menyentuh data user lain).
- **`(dashboard)/layout.tsx`** — tambah link nav "Manajemen User" ke `/admin`, tampil hanya kalau `appUser.role === "superadmin"` (pola sama seperti link "Antrian Persetujuan" yang hanya tampil untuk `spv`/`management`).

### 9. Testing

Unit test Cloud Functions baru ditulis dengan pola sama seperti `reviewSubmission.test.ts` (TDD tetap dijalankan: test ditulis lebih dulu, lalu implementasi). **Catatan lingkungan:** mesin development saat ini tidak punya Java, sehingga Firestore/Auth Emulator tidak bisa jalan — test-test ini (dan verifikasi manual UI end-to-end) akan ditulis tapi tidak bisa dieksekusi/diverifikasi hidup di sini, sama seperti sub-proyek Login Username sebelumnya. Verifikasi yang tetap bisa dilakukan: `npm run build` (type-check) dan `lib/schemas/user.test.ts` (schema, tidak butuh emulator).

## Di Luar Scope

- Nonaktifkan/hapus user.
- Mengubah username setelah dibuat.
- Sinkronisasi `displayName` Firebase Auth saat `updateUser`.
- Verifikasi hidup di emulator (blocked oleh ketiadaan Java di mesin ini).
