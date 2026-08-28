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
| Local Dev | Firebase Emulator Suite (Auth, Firestore) | Jangan develop langsung ke project Firebase produksi. Emulator Firestore butuh Java — kalau Java tidak terpasang di mesin dev, test yang bergantung emulator (`tests/firestore-rules.test.ts`, `lib/counters.test.ts`) tidak bisa dijalankan lokal |

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
5. Bersih-bersih: hapus folder `functions/`, update dokumen ini (`docs/superpowers/plans/2026-08-29-bersih-bersih-functions-cleanup.md`)

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
