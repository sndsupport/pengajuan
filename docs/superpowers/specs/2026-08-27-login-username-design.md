# Login Berbasis Username — Design Spec

**Tanggal:** 2026-08-27
**Status:** Approved

## Latar Belakang

Saat ini login memakai email asli Firebase Auth (`signInWithEmailAndPassword`). Kebutuhan baru: pengguna login memakai **username**, bukan email. Ini juga menggantikan opsi "Integrasi Akun ERP" di `CLAUDE.md` — akun akan dibuat & dikelola manual oleh superadmin (dibangun di sub-proyek berikutnya, Manajemen User), bukan disinkronkan dari ERP.

Ini adalah sub-proyek pertama dari rencana pengerjaan checklist MVP yang tersisa, urutan:
1. **Login Username** (spec ini)
2. Manajemen User (superadmin)
3. `generateSubmissionPdf`
4. Copy Template WA + `confirmSentToGa`
5. Tombol Tandai Selesai + `markAsDone`
6. Dashboard Monitoring

## Keputusan Desain

### 1. Pemetaan username → Firebase Auth

Firebase Auth (email/password) tetap dipakai apa adanya — tidak pindah ke custom token/custom auth. Setiap username dipetakan **deterministik** ke sebuah "email sintetis":

```
usernameToSyntheticEmail("admin.who") === "admin.who@pengajuan-tsi.internal"
```

Konsekuensi yang disengaja:
- **Uniqueness gratis**: `auth.createUser` / `auth.updateUser` akan menolak dengan error `email-already-exists` jika username sudah dipakai. Tidak perlu koleksi lookup/registry terpisah untuk cek keunikan username.
- **Tidak ada lookup network call tambahan saat login** — konversi username→email terjadi murni di client, sebelum memanggil `signInWithEmailAndPassword`.
- **Tidak ada risiko enumerasi email asli** karena email asli user tidak pernah dipakai untuk proses login.

Trade-off yang diterima: fitur "lupa password" bawaan Firebase (kirim link ke email) tidak bisa dipakai, karena email di Auth bukan inbox sungguhan. Reset password akan jadi tanggung jawab superadmin lewat Admin SDK di halaman Manajemen User (sub-proyek #2) — di luar scope spec ini.

### 2. Aturan format & normalisasi username

- Tidak boleh mengandung spasi atau karakter `@` (karena jadi local-part email).
- Selalu dinormalisasi ke lowercase sebelum disimpan/dibandingkan/dikonversi ke email sintetis, supaya "Admin.WHO" dan "admin.who" dianggap user yang sama secara konsisten di Auth maupun Firestore.
- Selain dua batasan itu, karakter bebas (sesuai keputusan user — tidak dibatasi ke pola ketat seperti `^[a-z0-9._-]+$`).

Validasi ini hidup di satu tempat: `lib/auth/username.ts`, dipakai oleh login page sekarang dan oleh Manajemen User nanti — supaya tidak ada logic normalisasi yang terduplikasi/divergen.

### 3. Perubahan data model `users/{uid}`

| Field | Sebelum | Sesudah |
|---|---|---|
| `username` | — (tidak ada) | **baru**, `string`, wajib, disimpan lowercase |
| `email` | `string`, wajib | `string \| null`, **opsional** — murni untuk kontak, tidak dipakai untuk auth |

Field lain (`name`, `role`, `branch`, `department`, `position`, `createdAt`) tidak berubah.

### 4. Perubahan kode

- **Baru** — `lib/auth/username.ts`:
  - `normalizeUsername(raw: string): string` — trim + lowercase; throw/return error kalau mengandung spasi atau `@`.
  - `usernameToSyntheticEmail(username: string): string` — `` `${normalizeUsername(username)}@pengajuan-tsi.internal` ``.
- **Modify** — `app/(auth)/login/page.tsx`:
  - Label & state field diganti dari `email` → `username`.
  - `handleSubmit` memanggil `usernameToSyntheticEmail` sebelum `signInWithEmailAndPassword`.
  - Pesan error tetap generik: "Username atau password salah." (tidak membedakan apakah username tidak ditemukan atau password salah, supaya tidak bocor informasi mana yang valid).
- **Modify** — `lib/hooks/useAuth.ts`:
  - Type `AppUser` tambah `username: string`, `email` jadi `string | null`.
- **Modify** — `scripts/seed-emulator.ts`:
  - Tiap seed user ditambah `username` (mis. `admin.who`, `snd`, `spv`, `management`), akun Auth dibuat pakai email sintetis dari username.
  - Tambah satu akun baru dengan role `superadmin` (username `superadmin`) — belum pernah di-seed sebelumnya, disiapkan untuk sub-proyek Manajemen User berikutnya.
  - Field `email` di dokumen Firestore user tetap diisi dengan email contoh yang ada sekarang (sebagai data kontak), sesuai keputusan "field email opsional" — opsional artinya boleh kosong untuk user baru ke depannya, bukan berarti data seed yang sudah ada dihapus emailnya.

### 5. Testing

- Unit test `lib/auth/username.ts` (baru, Vitest):
  - Normalisasi lowercase.
  - Menolak input dengan spasi.
  - Menolak input dengan `@`.
  - `usernameToSyntheticEmail` menghasilkan format yang diharapkan.
- Manual verification: jalankan emulator, `npm run seed`, login lewat UI pakai salah satu username hasil seed (mis. `admin.who` / `password123`), pastikan redirect sesuai role berjalan seperti sebelumnya.

## Di Luar Scope

- Pembuatan/edit user lewat UI (halaman Manajemen User) — sub-proyek #2.
- Reset password oleh superadmin — sub-proyek #2.
- Migrasi data user produksi yang sudah ada (belum ada data produksi saat ini — project masih tahap development dengan emulator).
