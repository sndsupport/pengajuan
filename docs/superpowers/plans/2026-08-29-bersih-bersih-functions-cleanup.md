# Bersih-bersih: Hapus functions/ dan Update CLAUDE.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the now-fully-unused `functions/` directory (every Cloud Function it contained was ported to client-side modules in sub-projects 1–4), strip the matching `functions` config from `firebase.json` and `.gitignore`, and rewrite `CLAUDE.md` so it describes the app as it actually works today instead of the pre-migration, Cloud-Functions-based architecture.

**Architecture:** This is sub-project 5 of 5 in the Spark-plan architecture migration (see `docs/superpowers/specs/2026-08-28-client-side-user-management-design.md` and the three other 2026-08-28 design docs for the full migration history). No application code changes — this plan only deletes dead scaffolding and corrects documentation to match the client-side + Firestore Rules + Google Drive architecture that sub-projects 1–4 already built and committed.

**Tech Stack:** No new dependencies. Touches `functions/` (deletion), `firebase.json`, `.gitignore`, `CLAUDE.md`.

**Environment note:** Same constraint as every prior sub-project — no Java on this machine, so the Firestore/Auth emulator cannot run and `npx vitest run tests/firestore-rules.test.ts` / `lib/counters.test.ts` stay unverified here (pre-existing condition, not something this plan changes). This plan touches no emulator-dependent code, so that limitation doesn't block anything in it.

## Global Constraints

- Do not touch any file under `/app`, `/components`, or `/lib` (except `CLAUDE.md` at the repo root, which is documentation, not application code) — this plan is cleanup + docs only, zero application behavior changes.
- After Task 1, nothing in the repo may reference `functions/` except historical entries inside `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md` (those are historical records of already-completed work and must not be edited).
- `npm run build` and `npm run test` (root) must both succeed after every task in this plan, same as they did before Task 1 — deleting `functions/` must not change root build/test behavior since nothing in `/app`, `/components`, or `/lib` imports from it (verified below, before Task 1 begins).

---

## File Structure

```
functions/                          # DELETE entire directory (src/index.ts placeholder,
                                     # lib/ build output, package.json, package-lock.json,
                                     # tsconfig.json, vitest.config.mts — all dead)
firebase.json                       # MODIFY — remove "functions" config block and the
                                     # "functions" emulator port entry
.gitignore                          # MODIFY — remove the two now-meaningless
                                     # /functions/lib and /functions/node_modules lines
CLAUDE.md                           # MODIFY — full rewrite of the stale
                                     # Cloud-Functions-era sections
```

---

## Task 1: Confirm nothing outside `functions/` depends on it, then delete it

**Files:**
- Delete: `functions/` (entire directory — `src/index.ts`, `lib/*`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.mts`)

**Interfaces:**
- Consumes: nothing (this task only removes files; it doesn't change any exported interface consumed elsewhere)
- Produces: nothing (downstream tasks in this plan consume `firebase.json`'s current content, read directly from disk, not from this task)

- [ ] **Step 1: Verify nothing outside `functions/` imports from it**

Run: `git grep -n "from \"@/functions\|from '\\.\\./functions\|require(.*functions/" -- ':!functions' ':!docs'`
Expected: no output. (This confirms `functions/src/index.ts` — already an empty placeholder per the sub-project 4 commit — has zero live importers anywhere in `/app`, `/components`, or `/lib`.)

- [ ] **Step 2: Delete the directory**

```bash
git rm -r functions
```

- [ ] **Step 3: Verify the root project still builds and tests pass**

Run: `npm run build`
Expected: succeeds exactly as before (the Next.js build never touched `functions/` — it has its own separate `package.json`/`tsconfig.json` and was never part of the Next.js module graph).

Run: `npx vitest run`
Expected: same pass/fail counts as on `main` before this task — 83 passing (pure-function/unit tests), `tests/firestore-rules.test.ts` and `lib/counters.test.ts` still failing with `ECONNREFUSED 127.0.0.1:8080` (pre-existing, emulator/Java unavailable on this machine, unrelated to this deletion).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove functions/ directory, fully replaced by client-side modules"
```

---

## Task 2: Remove the `functions` config from `firebase.json`

**Files:**
- Modify: `firebase.json`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (Task 3/CLAUDE.md doesn't reference `firebase.json`'s exact contents, only describes the setup steps in prose)

- [ ] **Step 1: Replace the file contents**

Current `firebase.json`:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "functions",
    "predeploy": ["npm --prefix functions run build"]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

Replace with:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

(Removes the top-level `functions` block — source dir no longer exists — and the `functions` port entry under `emulators`, since there is no Cloud Function to emulate anymore. `firestore` and `auth` emulator config, and `singleProjectMode`, are untouched.)

- [ ] **Step 2: Verify the file is valid JSON and Firebase CLI accepts it**

Run: `node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8'))"`
Expected: no output (parses cleanly).

Run: `firebase deploy --only firestore:rules --project sndsupportapps --dry-run`
Expected: dry run completes (`Dry run complete!`), same as it did before this edit — confirms removing the `functions` block didn't break how the CLI reads the rest of the config.

- [ ] **Step 3: Commit**

```bash
git add firebase.json
git commit -m "chore: remove functions config from firebase.json"
```

---

## Task 3: Remove the now-meaningless `functions/` entries from `.gitignore`

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Remove the last two lines**

Current end of `.gitignore`:
```
# firebase
firebase-debug.log
firestore-debug.log
ui-debug.log
/functions/lib
/functions/node_modules
```

Replace with:
```
# firebase
firebase-debug.log
firestore-debug.log
ui-debug.log
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: remove functions/ entries from .gitignore, directory no longer exists"
```

---

## Task 4: Rewrite `CLAUDE.md` to match the current client-side architecture

**Files:**
- Modify: `CLAUDE.md` (full-file rewrite — every section below changes)

**Interfaces:**
- Consumes: nothing
- Produces: nothing (this is the last task in the plan)

- [ ] **Step 1: Replace the entire file contents**

Write this complete file to `CLAUDE.md`, replacing everything currently there:

```markdown
# Aplikasi Pengajuan Kendaraan & Perlengkapan

Project brief ini untuk dibaca Claude Code (atau AI coding agent lain) sebagai konteks awal saat mulai membangun repo. Tech stack di sini pakai **Firebase**, menggantikan opsi Postgres di dokumen spesifikasi sebelumnya.

**Catatan arsitektur (2026-08-29):** Project Firebase (`sndsupportapps`) berjalan di plan **Spark (gratis)**, bukan Blaze — keputusan sadar untuk menghindari biaya. Konsekuensinya, seluruh business logic yang awalnya didesain sebagai Cloud Functions (lihat bagian "Riwayat Migrasi" di bawah) sudah dipindah ke client-side, diamankan lewat Firestore Security Rules yang detail per transisi status, bukan lewat Cloud Function/Admin SDK. File storage juga bukan Firebase Storage (butuh Blaze untuk beberapa operasi terkait), melainkan Google Drive lewat OAuth (Google Identity Services) langsung dari browser. Folder `functions/` sudah dihapus dari repo — tidak ada Cloud Function yang di-deploy sama sekali.

## Ringkasan Bisnis

Aplikasi internal untuk PT Tridaya Sinergi Indonesia. Admin cabang (WHO, WHP) dan SND mengajukan permintaan **Kendaraan** (mobil/motor) atau **Perlengkapan** (di luar ATK & rumah tangga kantor) ke AWS Supervisor (atau Management sebagai backup) untuk direview. Kalau disetujui, sistem generate PDF otomatis (mengikuti layout formulir GA yang sudah berjalan) lengkap dengan tanda tangan digital, lalu pengaju menyalin template pesan WA untuk dikirim manual ke GA. Status pengajuan dipantau lewat dashboard sampai pengaju menandai selesai setelah barang/layanan diterima.

## User Roles

| Role | Value di `users.role` | Bisa Mengajukan | Bisa Approve/Reject |
| --- | --- | --- | --- |
| Admin Cabang WHO/WHP | `admin_cabang` | Ya | Tidak |
| SND | `snd` | Ya | Tidak |
| AWS Supervisor | `spv` | Tidak | Ya |
| Management | `management` | Tidak | Ya (backup, jika diperlukan) |
| Superadmin | `superadmin` | Tidak | Tidak (kelola user & sistem, monitoring) |

## Alur Status

```
diajukan → (spv/management review)
  → perlu_revisi → (pengaju revisi & submit ulang) → diajukan   [loop]
  → disetujui → (pengaju/approver generate PDF client-side) → siap_dikirim
    → (pengaju copy template WA & kirim manual) → on_proses_ga
      → (pengaju terima barang/layanan) → (pengaju klik "Tandai Selesai") → selesai
```

Aturan penting:

- Transisi status ditulis **langsung dari client ke Firestore** (lewat modul di `/lib/submissions`), tapi setiap transisi dijaga ketat oleh `firestore.rules`: rules memvalidasi status lama → status baru yang diizinkan, siapa pemiliknya, field apa saja yang boleh berubah (`diff().affectedKeys().hasOnly([...])` per transisi), dan syarat tambahan (mis. `rejectionNote` wajib diisi saat reject, `pdfUrl` harus link Drive saat lanjut ke `siap_dikirim`). Tidak ada Cloud Function di tengah alur ini.
- `selesai` hanya bisa di-set oleh pemilik pengajuan (`requesterId == auth.uid`), tidak ada aktor lain yang boleh menandainya, termasuk superadmin.
- `disetujui` bisa dilakukan oleh `spv` atau `management` — field `approverRole` menyimpan siapa yang approve, dipakai untuk isi blok tanda tangan "Mengetahui" di PDF.

## Tech Stack

| Layer | Teknologi | Catatan |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui | |
| Hosting | Belum di-deploy. Karena plan Spark (bukan Blaze), Firebase App Hosting (butuh Blaze) tidak dipakai — target deploy adalah static export (`next.config.js` `output: 'export'`) + Firebase Hosting klasik | |
| Auth | Firebase Authentication | Login pakai **username**, bukan email asli — `lib/users/username.ts` mengubah username jadi email sintetis (`username@pengajuan-tsi.internal`) di baliknya. Role & cabang disimpan sebagai field di dokumen `users/{uid}`, bukan cuma custom claims, biar gampang di-query untuk dashboard |
| Database | Cloud Firestore | Realtime listener (`onSnapshot`) langsung dipakai untuk dashboard monitoring — tidak perlu infra websocket tambahan |
| File Storage | Google Drive (OAuth, Google Identity Services) | Dokumen pendukung, tanda tangan digital (PNG), PDF hasil generate — semua diupload langsung dari browser ke Drive lewat `lib/drive-upload.ts`, bukan ke Firebase Storage |
| Business Logic | Modul client-side di `/lib` (lihat bagian "Modul Client-side" di bawah), diamankan lewat `firestore.rules` | Sebelumnya Cloud Functions — sudah dimigrasikan penuh, lihat bagian "Riwayat Migrasi" |
| Generate PDF | `jspdf` + `html2canvas` di client (`lib/pdf/generateSubmissionPdfClient.ts`) | Render template HTML (meniru formulir GA) ke canvas lalu ke PDF, langsung di browser — bukan Puppeteer di Cloud Function |
| Tanda Tangan Digital | `signature_pad` (client, canvas) | Hasil di-upload sebagai PNG ke Google Drive saat submit (pengaju) & saat approve (approver) |
| Validasi | Zod | Schema jadi satu-satunya sumber validasi, taruh di `/lib/schemas`, dipakai di form client dan di modul `/lib` yang menulis ke Firestore |
| Form State | React Hook Form | |
| Data Fetching | Firestore SDK (`onSnapshot`/`getDocs`) + TanStack Query untuk data non-realtime | |
| Local Dev | Firebase Emulator Suite (Auth, Firestore) | Jangan develop langsung ke project Firebase produksi. Emulator Firestore/Auth butuh Java — kalau Java tidak terpasang di mesin dev, test yang bergantung emulator (`tests/firestore-rules.test.ts`, `lib/counters.test.ts`) tidak bisa dijalankan lokal |

### Integrasi Akun

**Tidak** pakai ERP bridge/sync (dua opsi ERP yang pernah direncanakan di draft awal dokumen ini tidak jadi dipakai). Sebagai gantinya: superadmin membuat/mengedit user langsung dari halaman `/admin` di aplikasi (`lib/users/createUser.ts`, `lib/users/updateUser.ts`), dengan username+password manual. `createUser` memakai instance `FirebaseApp` kedua yang sengaja dibuang setelah dipakai (`initializeApp` dengan nama app berbeda), supaya `createUserWithEmailAndPassword` tidak menggantikan sesi login superadmin yang sedang aktif. Reset password tidak bisa dilakukan lewat aplikasi (client SDK Firebase Auth tidak punya API untuk itu) — dilakukan manual lewat tab Authentication di Firebase Console.

## Firestore Data Model

```
users/{uid}
  name: string
  username: string                // dipakai untuk login, lihat lib/users/username.ts
  email: string | null
  role: "admin_cabang" | "snd" | "spv" | "management" | "superadmin"
  branch: "WHO" | "WHP" | "SND" | null
  department: string
  position: string
  createdAt: Timestamp

submissions/{submissionId}
  submissionNumber: string        // contoh format: "L.002/TSI-OPR/JB3-TNG/VIII/2026"
  type: "kendaraan" | "perlengkapan"
  subType: string                 // contoh: "service_berkala", "pengadaan_baru"
  status: "diajukan" | "perlu_revisi" | "disetujui" | "siap_dikirim" | "on_proses_ga" | "selesai"
  requesterId: string             // ref users
  requesterSignatureUrl: string
  approverId: string | null
  approverRole: "spv" | "management" | null
  approverName: string | null     // disalin dari users/{approverId}.name saat approve, dipakai di PDF
  approverSignatureUrl: string | null
  branch: string
  department: string
  position: string
  rejectionNote: string | null
  pdfUrl: string | null           // link Google Drive (https://drive.google.com/...)
  submittedAt: Timestamp
  reviewedAt: Timestamp | null
  approvedAt: Timestamp | null
  sentToGaAt: Timestamp | null
  completedAt: Timestamp | null

submissions/{submissionId}/items/{itemId}
  itemName: string
  brandType: string
  km: number | null               // hanya diisi untuk type == "kendaraan"
  quantity: number
  unit: string
  description: string

submissions/{submissionId}/statusHistory/{historyId}
  status: string
  note: string | null
  actorId: string
  actorRole: string
  timestamp: Timestamp

submissions/{submissionId}/attachments/{attachmentId}
  fileId: string                  // Google Drive file id
  fileUrl: string                 // link Google Drive
  fileName: string
  fileType: string
  uploadedAt: Timestamp

counters/{branchYearMonthKey}     // contoh doc id: "WHO-2026-08"
  lastNumber: number              // increment via Firestore transaction untuk nomor pengajuan otomatis
```

`statusHistory` adalah sumber data untuk durasi per tahap & total durasi di dashboard — hitung selisih timestamp antar entry (lihat `lib/monitoring.ts`), jangan simpan durasi sebagai field statis yang gampang basi.

## Firestore Security Rules (garis besar)

- `users/{uid}`: read oleh pemilik dokumen atau role `spv`/`management`/`superadmin`; create/update hanya oleh `superadmin`, dengan `role` divalidasi masuk enum yang sah (field ini dipakai helper `userRole()` di seluruh ruleset lain, jadi nilai tak valid berisiko merusak evaluasi rule lain); delete selalu ditolak.
- `submissions/{id}`: create diizinkan kalau `role in ['admin_cabang','snd']` dan `requesterId == auth.uid` dengan status awal `diajukan`; read diizinkan kalau pemilik ATAU role in `['spv','management','superadmin']`. Update status dijaga per-transisi secara eksplisit di rules (resubmit setelah revisi, approve, reject, generate PDF, konfirmasi kirim ke GA, tandai selesai) — masing-masing punya syarat pelaku, status lama yang diizinkan, dan `hasOnly()` field yang boleh berubah. **Tidak ada Cloud Function di jalur ini** — rules-lah yang jadi satu-satunya penjaga.
- `submissions/{id}/statusHistory/*`: create diizinkan untuk pemilik/reviewer dengan `actorId`/`actorRole` yang harus cocok dengan caller (mencegah pemalsuan); update/delete selalu ditolak.
- `submissions/{id}/items/*` dan `submissions/{id}/attachments/*`: create/delete hanya oleh pemilik selama status masih `diajukan`/`perlu_revisi`; update selalu ditolak (immutable, hapus-lalu-buat-ulang kalau perlu ganti).
- `counters/{id}`: create hanya di angka 1, update hanya increment persis +1, hanya role `admin_cabang`/`snd` — mencegah lompatan nomor pengajuan.
- Simpan rules di `firestore.rules`, test pakai Firebase Emulator + `@firebase/rules-unit-testing` (`tests/firestore-rules.test.ts`) sebelum deploy — di mesin tanpa Java, test ini tidak bisa dijalankan lokal, jadi verifikasi manual (baca ulang logic rule vs test case) jadi pengganti sementara.

## Modul Client-side (`/lib`)

Pengganti apa yang sebelumnya jadi Cloud Functions callable — sekarang fungsi biasa yang dipanggil langsung dari komponen client, dan validasi otorisasinya didobel di `firestore.rules`:

| Modul | Dipanggil dari | Tugas |
| --- | --- | --- |
| `lib/submissions/submitSubmission.ts` | Form Buat Pengajuan | Generate `submissionNumber` (transaction di `counters`), tulis submission + items + statusHistory dengan status `diajukan` |
| `lib/submissions/reviewSubmission.ts` | Halaman Antrian Persetujuan (`spv`/`management`) | Approve → set `disetujui` + data approver; reject → set `perlu_revisi` + `rejectionNote` wajib diisi |
| `lib/pdf/generateAndAttachSubmissionPdf.ts` + `lib/pdf/generateSubmissionPdfClient.ts` | Halaman detail pengajuan, setelah `disetujui` | Render PDF di browser (jsPDF + html2canvas), upload ke Google Drive, update `pdfUrl` + status `siap_dikirim` |
| `lib/submissions/confirmSentToGa.ts` | Tombol "Sudah Dikirim" setelah copy template WA | Set status `on_proses_ga` |
| `lib/submissions/markAsDone.ts` | Tombol "Tandai Selesai" (hanya pemilik) | Set status `selesai`, `completedAt` |
| `lib/users/createUser.ts` | Halaman `/admin/new` (superadmin) | Buat akun Auth (instance app kedua) + dokumen `users/{uid}` |
| `lib/users/updateUser.ts` | Halaman `/admin/[uid]` (superadmin) | Update dokumen `users/{uid}` |
| `lib/drive-upload.ts` | Form Buat Pengajuan, signature pad | Upload file ke Google Drive lewat OAuth browser, dipakai untuk attachment & tanda tangan |

Semua modul ini menolak request tanpa role yang sesuai di baris pertama (fail-fast, cek `caller.role`), sebelum logic lain jalan — sama seperti pola Cloud Function callable sebelumnya, hanya beda tempat eksekusinya.

## Riwayat Migrasi (Spark-plan architecture migration)

Aplikasi ini awalnya dibangun dengan business logic sensitif di Cloud Functions (lihat riwayat plan `docs/superpowers/plans/2026-08-21-*` dan `2026-08-22-*`). Karena project Firebase dijalankan di plan Spark (bukan Blaze) untuk menghindari biaya, seluruh Cloud Functions dimigrasikan ke client-side dalam 5 sub-project (semua plan & design doc lengkap ada di `docs/superpowers/plans/2026-08-28-*.md` dan `docs/superpowers/specs/2026-08-28-*.md`):

1. Upload file → client-side Google Drive (ganti Cloud Function `uploadFile`)
2. Rewrite `firestore.rules` untuk 4 transisi status (ganti `submitSubmission`/`reviewSubmission`/`confirmSentToGa`/`markAsDone`)
3. Generate PDF di client, transisi status ke-5 (ganti Cloud Function `generateSubmissionPdf` yang pakai Puppeteer)
4. Manajemen user tanpa Cloud Functions (ganti `createUser`/`updateUser`, hapus `resetUserPassword`)
5. Bersih-bersih: hapus folder `functions/`, update dokumen ini (plan ini)

## Struktur Folder

```
/app
  /(auth)/login
  /(dashboard)
    /pengajuan          # list & buat pengajuan (admin_cabang, snd)
    /persetujuan        # antrian approve (spv, management)
    /monitoring          # dashboard semua pengajuan
    /admin               # manajemen user & pengaturan (superadmin)
/components
  /status-badge
  /submission-timeline
  /signature-pad
  /file-upload
  /monitoring-row
/lib
  /firebase
    client.ts            # Firebase SDK init (browser)
  /schemas                # Zod schemas, satu-satunya sumber validasi
  /hooks
  /submissions            # submitSubmission, reviewSubmission, confirmSentToGa, markAsDone
  /pdf                    # generateSubmissionPdfClient, generateAndAttachSubmissionPdf, pdfTemplate
  /users                  # createUser, updateUser, username
  /auth                    # username helpers dipakai form login
  drive-upload.ts          # upload ke Google Drive lewat OAuth browser
  wa-template.ts            # template pesan WA
  monitoring.ts              # hitung durasi per tahap dari statusHistory
  counters.ts                 # nomor pengajuan otomatis
firestore.rules
firestore.indexes.json
firebase.json
```

## Setup Awal

1. `firebase init` — pilih Firestore, Hosting (nanti, saat siap deploy), Emulators (Auth + Firestore saja).
2. Jalankan development di Firebase Emulator Suite (`firebase emulators:start --only firestore,auth`), jangan langsung ke project produksi. Emulator Firestore butuh Java terpasang di mesin dev.
3. Simpan config Firebase client di `.env.local` (`NEXT_PUBLIC_FIREBASE_*`), plus `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` dan `NEXT_PUBLIC_DRIVE_FOLDER_ID` untuk upload ke Drive (lihat `.env.local.example`). Tidak ada service account/Admin SDK credential yang perlu disimpan untuk alur aplikasi sehari-hari (Admin SDK cuma dipakai di `scripts/seed-emulator.ts` untuk seed data emulator lokal).
4. Definisikan Firestore composite indexes di `firestore.indexes.json` untuk query dashboard (filter status + jenis + cabang + sort tanggal).
5. Pastikan project Firebase tetap di plan Spark — jangan upgrade ke Blaze kecuali keputusan itu diubah secara sadar (lihat catatan arsitektur di atas).

## Konvensi Kode

- TypeScript strict mode di seluruh proyek.
- Zod schema jadi satu-satunya sumber validasi — dipakai ulang di form client dan di modul `/lib` yang menulis ke Firestore, jangan duplikasi aturan validasi.
- Named export untuk komponen & util; default export hanya untuk file `page.tsx`/`layout.tsx` Next.js.
- Semua modul di `/lib` yang menulis data sensitif (submissions, users) menolak caller dengan role yang tidak sesuai di baris pertama (fail-fast, cek `caller.role`), sebelum logic lain jalan — dan syarat yang sama didobel di `firestore.rules`, karena modul client bisa saja dilewati oleh caller yang menulis langsung ke Firestore SDK.

## Referensi Desain (ringkas)

Warna status — pakai token ini konsisten di badge, timeline, dan aksen tabel:

| Status | Hex |
| --- | --- |
| `diajukan` | `#64748B` |
| `perlu_revisi` | `#D97706` |
| `disetujui` | `#0891B2` |
| `siap_dikirim` | `#3454D1` |
| `on_proses_ga` | `#7C3AED` |
| `selesai` | `#16A34A` |

Font: Plus Jakarta Sans (heading/UI), Public Sans (body), IBM Plex Mono (nomor pengajuan, KM, tanggal, angka tabel).

Detail lengkap komponen & layout halaman ada di dokumen "Spesifikasi Aplikasi Pengajuan" — bagian tech stack di dokumen itu sudah tidak berlaku (diganti Firebase seperti di atas), tapi bagian UI/UX-nya masih jadi acuan.

## Checklist MVP

- [x] Setup project Firebase (Auth, Firestore, Emulator Suite) — plan Spark, tanpa Functions/App Hosting
- [x] `firestore.rules` + `firestore.indexes.json` sesuai model data di atas
- [x] Integrasi akun — superadmin membuat/mengedit user langsung dari client (bukan ERP bridge)
- [x] Form Buat Pengajuan (Kendaraan/Perlengkapan) + signature pad pengaju
- [x] `lib/submissions/submitSubmission.ts` (nomor otomatis + statusHistory)
- [x] Halaman Antrian Persetujuan (spv/management) + `lib/submissions/reviewSubmission.ts`
- [x] Generate PDF client-side (`lib/pdf/`) sesuai layout formulir GA existing
- [x] Tombol Copy Template WA + `lib/submissions/confirmSentToGa.ts`
- [x] Tombol Tandai Selesai + `lib/submissions/markAsDone.ts`
- [x] Dashboard Monitoring realtime (`onSnapshot`) dengan durasi per tahap & total durasi
- [x] Halaman Manajemen User (superadmin)
- [ ] Deploy: static export (`next.config.js` `output: 'export'`) + Firebase Hosting, project sesuai (`sndsupportapps`, bukan `pengajuan-kendaraan-perlengkapan` yang ada di `.firebaserc` saat ini)
- [ ] QA manual end-to-end di browser sungguhan + emulator (belum pernah dilakukan — mesin dev saat ini tidak punya Java/emulator)
```

- [ ] **Step 2: Verify the checklist and prose match reality**

Re-read the new `CLAUDE.md` once more against: `firestore.rules` (does every rule described actually exist there?), `lib/schemas/user.ts` and `lib/schemas/submission.ts` (do the data model fields match?), and the file tree under `/lib` (does the folder structure section match what's actually there?). Fix any mismatch found before committing.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md for the client-side Spark-plan architecture"
```

---

## Task 5: Final whole-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds, same output shape as before this plan (routes unchanged — this plan touched no `/app` or `/components` files).

- [ ] **Step 2: Full test run**

Run: `npx vitest run`
Expected: same result as the baseline captured in Task 1 Step 3 — 83 passing, `tests/firestore-rules.test.ts` + `lib/counters.test.ts` failing on `ECONNREFUSED` (pre-existing, emulator/Java unavailable).

- [ ] **Step 3: Confirm no stray references remain**

Run: `git grep -n "functions/" -- ':!docs' ':!*.md'`
Expected: no output (only historical plan/spec `.md` files under `docs/` may still mention `functions/`, and those are excluded by the pathspec above).

Run: `ls functions 2>&1` (or `Test-Path functions` on PowerShell)
Expected: directory does not exist.

- [ ] **Step 4: Nothing to commit here** — this task is verification-only; if Step 1 or 2 fail, stop and fix the regression in a new commit before considering this plan complete (do not amend prior commits).

---

## Self-Review Notes

- Spec coverage: both bullets from the shared "Bersih-bersih" scope (present verbatim in all four 2026-08-28 design docs: "hapus folder `functions/` yang sudah tidak terpakai, update CLAUDE.md") are covered — Task 1 deletes `functions/`, Task 4 rewrites `CLAUDE.md`. Task 2/3 (firebase.json, .gitignore) are the necessary follow-through of deleting `functions/` cleanly, not scope creep — leaving dangling config pointing at a deleted directory would itself be a documentation/config accuracy bug of the same kind this sub-project exists to fix.
- Type consistency: n/a — no code interfaces are introduced or changed by this plan, only deletions and prose/config edits.
- Verified the new `CLAUDE.md` content against current source: `username` field (from `lib/schemas/user.ts`), `approverName`/`fileId` fields (from `firestore.rules` and `lib/schemas/submission.ts`'s `attachmentSchema`), and the actual `/lib` subfolder names (`submissions`, `pdf`, `users`, `auth`) were all cross-checked against the real files before writing the plan, not guessed.
- Did not include actually performing the deploy (static export config, `.firebaserc` fix, Hosting setup) in this plan — user asked specifically for sub-project 5 (functions/ cleanup + CLAUDE.md) first; deploy setup is called out as a new unchecked checklist item in the rewritten CLAUDE.md but left for a follow-up plan.
