# Aplikasi Pengajuan Kendaraan & Perlengkapan

Project brief ini untuk dibaca Claude Code (atau AI coding agent lain) sebagai konteks awal saat mulai membangun repo. Tech stack di sini pakai **Firebase**, menggantikan opsi Postgres di dokumen spesifikasi sebelumnya.

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
  → disetujui → (Cloud Function auto-generate PDF) → siap_dikirim
    → (pengaju copy template WA & kirim manual) → on_proses_ga
      → (pengaju terima barang/layanan) → (pengaju klik "Tandai Selesai") → selesai
```

Aturan penting:

- Transisi status **tidak boleh** ditulis langsung dari client ke Firestore. Semua perubahan status lewat Cloud Functions callable, supaya validasi alur, audit trail, dan generate PDF konsisten.
- `selesai` hanya bisa di-set oleh pemilik pengajuan (`requesterId == auth.uid`), tidak ada aktor lain yang boleh menandainya, termasuk superadmin.
- `disetujui` bisa dilakukan oleh `spv` atau `management` — field `approverRole` menyimpan siapa yang approve, dipakai untuk isi blok tanda tangan "Mengetahui" di PDF.

## Tech Stack

| Layer | Teknologi | Catatan |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui | |
| Hosting | Firebase App Hosting (native Next.js SSR support) — cek dokumentasi Firebase terkini kalau ada perubahan fitur | Alternatif fallback: static export + Cloud Run kalau App Hosting tidak cocok |
| Auth | Firebase Authentication | Role & cabang disimpan sebagai field di dokumen `users/{uid}`, bukan cuma custom claims, biar gampang di-query untuk dashboard |
| Database | Cloud Firestore | Realtime listener (`onSnapshot`) langsung dipakai untuk dashboard monitoring — tidak perlu infra websocket tambahan |
| File Storage | Google Drive (API) | Dokumen pendukung & tanda tangan digital (PNG) diupload ke Google Drive via Cloud Function `uploadFile` (pakai akun `sndsupport.tsi@gmail.com`), bukan Firebase Storage — lihat `docs/superpowers/specs/2026-08-22-attachments-signature-upload-gdrive-design.md`. Penyimpanan PDF hasil `generateSubmissionPdf` belum diputuskan, menunggu fitur itu didesain. |
| Backend Logic | Cloud Functions (2nd gen, Node.js/TypeScript) | Semua business logic sensitif (nomor otomatis, transisi status, generate PDF) |
| Generate PDF | `puppeteer-core` + `@sparticuz/chromium` di Cloud Function | Render template HTML (meniru formulir GA) ke PDF. **Set memory ≥1GiB dan timeout ≥60s** pada function ini — default terlalu kecil untuk headless Chromium |
| Tanda Tangan Digital | `signature_pad` (client, canvas) | Hasil di-upload sebagai PNG ke Google Drive (via `uploadFile`) saat submit (pengaju); upload tanda tangan approver saat approve belum dibangun |
| Validasi | Zod | Schema sama dipakai di form client & di Cloud Function (single source of truth, taruh di `/lib/schemas`) |
| Form State | React Hook Form | |
| Data Fetching | Firestore SDK (`onSnapshot`/`getDocs`) + TanStack Query untuk data non-realtime | |
| Local Dev | Firebase Emulator Suite (Auth, Firestore, Functions) | Tidak ada emulator untuk Google Drive — panggilan `uploadFile` saat dev lokal selalu ke Drive API asli. Jangan develop langsung ke project Firebase produksi |

### Integrasi Akun ERP

User idealnya tidak dibuat manual satu-satu. Dua opsi (putuskan salah satu sebelum mulai coding):

1. Endpoint/API ERP dipanggil dari Cloud Function untuk validasi kredensial → mint custom token Firebase Auth (`admin.auth().createCustomToken`).
2. Script sinkronisasi berkala (Cloud Function scheduled) menyalin user dari database ERP ke `users` collection, login tetap pakai Firebase Auth email/password terpisah.

## Firestore Data Model

```
users/{uid}
  name: string
  email: string
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
  approverSignatureUrl: string | null
  branch: string
  department: string
  position: string
  rejectionNote: string | null
  pdfUrl: string | null
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
  fileUrl: string
  fileName: string
  fileType: string
  uploadedAt: Timestamp

counters/{branchYearMonthKey}     // contoh doc id: "WHO-2026-08"
  lastNumber: number              // increment via Firestore transaction untuk nomor pengajuan otomatis
```

`statusHistory` adalah sumber data untuk durasi per tahap & total durasi di dashboard — hitung selisih timestamp antar entry, jangan simpan durasi sebagai field statis yang gampang basi.

## Firestore Security Rules (garis besar)

- `users/{uid}`: read oleh pemilik dokumen atau role `spv`/`management`/`superadmin`; write hanya lewat Admin SDK (Cloud Function), bukan client langsung.
- `submissions/{id}`: create diizinkan kalau `role in ['admin_cabang','snd']` dan `requesterId == auth.uid`; read diizinkan kalau pemilik ATAU role in `['spv','management','superadmin']`; **update field `status` ditolak di rules** — hanya Cloud Function (via Admin SDK, yang bypass rules) yang boleh mengubahnya.
- `submissions/{id}/statusHistory/*`: read-only dari client, write hanya dari Cloud Function.
- Simpan draft rules di `firestore.rules`, test pakai Firebase Emulator + `@firebase/rules-unit-testing` sebelum deploy.

## Cloud Functions yang Dibutuhkan

| Function | Trigger | Tugas |
| --- | --- | --- |
| `submitSubmission` | Callable | Generate `submissionNumber` (transaction di `counters`), set status `diajukan`, tulis entry `statusHistory` |
| `reviewSubmission` | Callable (role `spv`/`management`) | Kalau approve → set `disetujui`, panggil `generateSubmissionPdf`; kalau reject → set `perlu_revisi` + `rejectionNote` wajib diisi |
| `generateSubmissionPdf` | Dipanggil internal setelah approve | Render HTML template (layout formulir GA) via Puppeteer, upload PDF (tujuan penyimpanan — Storage atau Drive — belum diputuskan), update `pdfUrl` + status `siap_dikirim` |
| `confirmSentToGa` | Callable (pemilik submission) | Dipanggil setelah pengaju klik copy template WA & konfirmasi sudah kirim → set `on_proses_ga` |
| `markAsDone` | Callable (pemilik submission, wajib `requesterId == auth.uid`) | Set status `selesai`, `completedAt` |

## Struktur Folder (saran)

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
/lib
  /firebase
    client.ts            # Firebase SDK init (browser)
    admin.ts              # Admin SDK init (server/Cloud Functions)
  /schemas                # Zod schemas, dipakai client & functions
  /hooks
/functions
  /src
    submitSubmission.ts
    reviewSubmission.ts
    generatePdf.ts
    confirmSentToGa.ts
    markAsDone.ts
    counters.ts
firestore.rules
firestore.indexes.json
firebase.json
```

## Setup Awal

1. `firebase init` — pilih Firestore, Functions, App Hosting (atau Hosting), Emulators.
2. Jalankan development di Firebase Emulator Suite (`firebase emulators:start`), jangan langsung ke project produksi.
3. Simpan config Firebase client di `.env.local` (`NEXT_PUBLIC_FIREBASE_*`), service account untuk Admin SDK **jangan** di-commit ke repo.
4. Definisikan Firestore composite indexes di `firestore.indexes.json` untuk query dashboard (filter status + jenis + cabang + sort tanggal).
5. Setup Google Drive (sekali saja, manual) — lihat `docs/superpowers/specs/2026-08-22-attachments-signature-upload-gdrive-design.md`: enable Google Drive API, buat folder di akun `sndsupport.tsi@gmail.com`, share folder itu ke service account Cloud Functions, simpan folder ID sebagai env var `DRIVE_FOLDER_ID`.

## Konvensi Kode

- TypeScript strict mode di seluruh proyek (app & functions).
- Zod schema jadi satu-satunya sumber validasi — dipakai ulang di form client dan di input Cloud Function, jangan duplikasi aturan validasi.
- Named export untuk komponen & util; default export hanya untuk file `page.tsx`/`layout.tsx` Next.js.
- Semua Cloud Function callable menolak request tanpa `context.auth` atau dengan role yang tidak sesuai di awal fungsi (fail fast), sebelum logic lain jalan.

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

- [ ] Setup project Firebase (Auth, Firestore, Functions, App Hosting) + Emulator Suite
- [ ] Setup Google Drive API + folder + service account permission (lihat Setup Awal poin 5)
- [ ] `firestore.rules` + `firestore.indexes.json` sesuai model data di atas
- [ ] Integrasi akun (pilih opsi ERP bridge atau sync) & role assignment
- [ ] Form Buat Pengajuan (Kendaraan/Perlengkapan) + signature pad pengaju
- [ ] Cloud Function `submitSubmission` (nomor otomatis + statusHistory)
- [ ] Halaman Antrian Persetujuan (spv/management) + Cloud Function `reviewSubmission`
- [ ] Cloud Function `generateSubmissionPdf` (template HTML sesuai formulir GA existing)
- [ ] Tombol Copy Template WA + Cloud Function `confirmSentToGa`
- [ ] Tombol Tandai Selesai + Cloud Function `markAsDone`
- [ ] Dashboard Monitoring realtime (`onSnapshot`) dengan durasi per tahap & total durasi
- [ ] Halaman Manajemen User (superadmin)
