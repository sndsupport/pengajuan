# Aplikasi Pengajuan Kendaraan & Perlengkapan

Project brief ini untuk dibaca Claude Code (atau AI coding agent lain) sebagai konteks awal saat mulai membangun repo. Tech stack di sini pakai **Firebase**, menggantikan opsi Postgres di dokumen spesifikasi sebelumnya.

**Catatan arsitektur (2026-08-29):** Project Firebase (`sndsupportapps`) berjalan di plan **Spark (gratis)**, bukan Blaze — keputusan sadar untuk menghindari biaya. Konsekuensinya, seluruh business logic yang awalnya didesain sebagai Cloud Functions (lihat bagian "Riwayat Migrasi" di bawah) sudah dipindah ke client-side, diamankan lewat Firestore Security Rules yang detail per transisi status, bukan lewat Cloud Function/Admin SDK. File storage juga bukan Firebase Storage (butuh Blaze untuk beberapa operasi terkait), melainkan Google Drive lewat OAuth (Google Identity Services) langsung dari browser. Folder `functions/` sudah dihapus dari repo — tidak ada Cloud Function yang di-deploy sama sekali.

## Ringkasan Bisnis

Aplikasi internal untuk PT Tridaya Sinergi Indonesia. Admin cabang (WHO, WHP) dan SND mengajukan permintaan **Kendaraan** (mobil/motor) atau **Perlengkapan** (di luar ATK & rumah tangga kantor) ke AWS Supervisor (atau Management sebagai backup) untuk direview. Kalau disetujui, sistem generate PDF otomatis (mengikuti layout formulir GA yang sudah berjalan) lengkap dengan tanda tangan digital, lalu pengaju menyalin template pesan WA untuk dikirim manual ke GA. Status pengajuan dipantau lewat dashboard sampai pengaju menandai selesai setelah barang/layanan diterima.

## User Roles

| Role | Value di `users.role` | Bisa Mengajukan | Bisa Approve/Reject |
| --- | --- | --- | --- |
| Admin (terpusat) | `admin` | Ya, atas nama pegawai yang dipilih dari data master `employees` (lihat "Restrukturisasi Role Admin" di bawah) | Tidak |
| AWS Supervisor | `spv` | Hanya kategori Personalia `cuti`/`izin` milik sendiri (lihat "Ekspansi One Gate" di bawah) | Ya |
| Operational Manager | `management` | Tidak | Ya (backup, jika diperlukan) |
| Superadmin | `superadmin` | Tidak | Tidak (kelola user, data pegawai, & sistem, monitoring) |

Catatan: value role di database tetap `management` — "Operational Manager" cuma label tampilan di UI (relabel dilakukan saat ekspansi One Gate, lihat di bawah).

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
- Alur di atas berlaku untuk `type` `kendaraan`/`perlengkapan`/`gedung_fasilitas`. Untuk `type: "personalia"` (lembur/cuti/izin) alurnya beda: `diajukan → (dual approval spv DAN management, urutan bebas) → selesai` langsung — tidak ada `disetujui`/`siap_dikirim`/`on_proses_ga` (tidak ada PDF, tidak ada kirim ke GA), karena approver kedua yang menyelesaikan approval langsung menutup status ke `selesai`. Reject tetap sama (→ `perlu_revisi` → resubmit → `diajukan`, approval yang sudah ada di-reset ke `null`). Lihat "Ekspansi One Gate" di bawah.

## Tech Stack

| Layer | Teknologi | Catatan |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui | |
| Hosting | Firebase Hosting klasik, static export (`next.config.js` `output: 'export'`) — live di https://sndsupportapps.web.app | Karena plan Spark (bukan Blaze), Firebase App Hosting (butuh Blaze) tidak dipakai. Route dengan ID dinamis (`/pengajuan/[id]`, `/admin/[uid]`) diubah jadi query-string (`/pengajuan/detail?id=`, `/admin/edit?uid=`) karena static export tidak bisa pre-render path dengan ID yang belum diketahui saat build |
| Auth | Firebase Authentication | Login pakai **username**, bukan email asli — `lib/users/username.ts` mengubah username jadi email sintetis (`username@pengajuan-tsi.internal`) di baliknya. Role & cabang disimpan sebagai field di dokumen `users/{uid}`, bukan cuma custom claims, biar gampang di-query untuk dashboard |
| Database | Cloud Firestore | Realtime listener (`onSnapshot`) langsung dipakai untuk dashboard monitoring — tidak perlu infra websocket tambahan |
| File Storage | Google Drive (OAuth, Google Identity Services) | Dokumen pendukung, tanda tangan digital (PNG), PDF hasil generate — semua diupload langsung dari browser ke Drive lewat `lib/drive-upload.ts`, bukan ke Firebase Storage. Scope OAuth-nya `drive.file` (bukan `drive` penuh, biar tidak butuh verifikasi Google yang berat) — konsekuensinya app **tidak bisa** menulis ke folder yang dibuat/di-share manual lewat Drive UI, karena `drive.file` cuma kasih akses ke file/folder yang dibuat app itu sendiri. Makanya tiap akun yang authorize dapat foldernya sendiri (nama `"Pengajuan TSI - Lampiran"`, dicari-atau-dibuat otomatis di `getOrCreateAppFolder()`), bukan satu folder bersama yang dibuat manual. **SOP operasional (keputusan sadar 2026-08-31):** supaya semua upload dari semua cabang tetap terpusat di satu Drive, semua karyawan pas ketemu popup pilih akun Google buat Drive **wajib login sebagai `sndsupport.tsi@gmail.com`**, bukan akun pribadi masing-masing — ini terpisah total dari login aplikasi (username per-cabang tetap seperti biasa, tidak kepengaruh). Konsekuensinya password akun itu diketahui banyak staf; risiko ini sudah disadari dan diterima demi kecepatan (alternatif Google Picker per-karyawan dipertimbangkan tapi tidak dipilih karena butuh setup lebih banyak) |
| Business Logic | Modul client-side di `/lib` (lihat bagian "Modul Client-side" di bawah), diamankan lewat `firestore.rules` | Sebelumnya Cloud Functions — sudah dimigrasikan penuh, lihat bagian "Riwayat Migrasi" |
| Generate PDF | `jspdf` + `html2canvas` di client (`lib/pdf/generateSubmissionPdfClient.ts`) | Render template HTML (meniru formulir GA) ke canvas lalu ke PDF, langsung di browser — bukan Puppeteer di Cloud Function |
| Tanda Tangan Digital | `signature_pad` (client, canvas) | Hasil di-upload sebagai PNG ke Google Drive saat submit (pengaju) & saat approve (approver) |
| Validasi | Zod | Schema jadi satu-satunya sumber validasi, taruh di `/lib/schemas`, dipakai di form client dan di modul `/lib` yang menulis ke Firestore |
| Form State | React Hook Form | |
| Data Fetching | Firestore SDK (`onSnapshot`/`getDocs`) + TanStack Query untuk data non-realtime | |
| Local Dev | Firebase Emulator Suite (Auth, Firestore) | Jangan develop langsung ke project Firebase produksi. Emulator Firestore butuh **Java 21+** (firebase-tools terbaru menolak Java di bawah 21) — kalau Java tidak terpasang di mesin dev, test yang bergantung emulator (`tests/firestore-rules.test.ts`, `lib/counters.test.ts`) tidak bisa dijalankan lokal. Kalau tidak ada akses admin buat `winget install`/MSI (butuh approval UAC interaktif yang tidak bisa dilakukan otomatis), pakai JDK portable: unduh zip Temurin 21 dari `https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk`, extract ke folder bebas admin (mis. `~/.tools/`), lalu `export PATH="<folder>/jdk-21.x.x+x/bin:$PATH"` sebelum `firebase emulators:start` |

### Integrasi Akun

**Tidak** pakai ERP bridge/sync (dua opsi ERP yang pernah direncanakan di draft awal dokumen ini tidak jadi dipakai). Sebagai gantinya: superadmin membuat/mengedit user langsung dari halaman `/admin` di aplikasi (`lib/users/createUser.ts`, `lib/users/updateUser.ts`), dengan username+password manual. `createUser` memakai instance `FirebaseApp` kedua yang sengaja dibuang setelah dipakai (`initializeApp` dengan nama app berbeda), supaya `createUserWithEmailAndPassword` tidak menggantikan sesi login superadmin yang sedang aktif. Reset password tidak bisa dilakukan lewat aplikasi (client SDK Firebase Auth tidak punya API untuk itu) — dilakukan manual lewat tab Authentication di Firebase Console.

## Firestore Data Model

```
users/{uid}
  name: string
  username: string                // dipakai untuk login, lihat lib/users/username.ts
  email: string | null
  role: "admin" | "spv" | "management" | "superadmin"
  branch: null                    // selalu null — semua role sekarang terpusat, lihat "Restrukturisasi Role Admin" di bawah
  department: string
  position: string
  createdAt: Timestamp

employees/{employeeId}            // data master, BUKAN akun login — dipilih admin saat membuat pengajuan
  name: string
  branch: "WHO" | "WHP" | "SND"
  department: string
  position: string
  createdAt: Timestamp

submissions/{submissionId}
  submissionNumber: string        // contoh format: "L.002/TSI-OPR/JB3-TNG/VIII/2026"
  type: "kendaraan" | "perlengkapan" | "gedung_fasilitas" | "personalia"
  employeeId: string | null       // ref employees — null hanya untuk personalia yang di-self-submit spv
  employeeName: string            // snapshot nama pemohon asli, dipakai untuk tampilan & PDF
  subType: string                 // kendaraan/perlengkapan/gedung_fasilitas: mis. "service_berkala", "pengadaan_baru", "perbaikan"
                                   // personalia: "lembur" | "cuti" | "izin"
  status: "diajukan" | "perlu_revisi" | "disetujui" | "siap_dikirim" | "on_proses_ga" | "selesai"
  requesterId: string             // ref users — uid admin/spv yang membuat pengajuan, BUKAN si pemohon (lihat employeeId/employeeName)
  branch: string
  department: string
  position: string
  rejectionNote: string | null
  submittedAt: Timestamp
  reviewedAt: Timestamp | null
  completedAt: Timestamp | null

  // Field khusus type kendaraan/perlengkapan/gedung_fasilitas (alur operasional, lihat "Alur Status"):
  requesterSignatureUrl: string
  approverId: string | null
  approverRole: "spv" | "management" | null
  approverName: string | null     // disalin dari users/{approverId}.name saat approve, dipakai di PDF
  approverSignatureUrl: string | null
  pdfUrl: string | null           // link Google Drive (https://drive.google.com/...)
  approvedAt: Timestamp | null
  sentToGaAt: Timestamp | null

  // Field khusus type "personalia" (dual approval, lihat "Ekspansi One Gate" di bawah):
  periodStart: string             // "YYYY-MM-DD", dari <input type="date">
  periodEnd: string                // "YYYY-MM-DD"
  spvApproval: { approverId: string; approverName: string; note: string | null; decidedAt: Timestamp } | null
  managerApproval: { approverId: string; approverName: string; note: string | null; decidedAt: Timestamp } | null
  // (dokumen personalia diupload sebagai satu attachment di subcollection attachments, bukan items+signature)

submissions/{submissionId}/items/{itemId}   // tidak dipakai untuk type == "personalia" (lihat dokumen di attachments)
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
- `submissions/{id}`: create diizinkan kalau `role == 'admin'` dan `requesterId == auth.uid` dengan status awal `diajukan`; read diizinkan kalau pemilik ATAU role in `['spv','management','superadmin']`. Update status dijaga per-transisi secara eksplisit di rules (resubmit setelah revisi, approve, reject, generate PDF, konfirmasi kirim ke GA, tandai selesai) — masing-masing punya syarat pelaku, status lama yang diizinkan, dan `hasOnly()` field yang boleh berubah. **Tidak ada Cloud Function di jalur ini** — rules-lah yang jadi satu-satunya penjaga.
- Personalia (`type == 'personalia'`) punya klausa create/update tambahan yang khusus scoped ke `type` ini (rules operasional untuk `kendaraan`/`perlengkapan`/`gedung_fasilitas` tidak diubah): create juga diizinkan untuk `spv` kalau `subType in ['cuti', 'izin']` (bukan `lembur`); update partial approval mengizinkan `spv`/`management` mengisi field approval miliknya sendiri (`spvApproval`/`managerApproval`) selama punya sendiri masih `null`, tanpa mengubah `status`; update final approval mengizinkan approver kedua mengubah `status` ke `selesai` sekaligus mengisi approval-nya, hanya kalau approval yang lain sudah terisi.
- `submissions/{id}/statusHistory/*`: create diizinkan untuk pemilik/reviewer dengan `actorId`/`actorRole` yang harus cocok dengan caller (mencegah pemalsuan); update/delete selalu ditolak.
- `submissions/{id}/items/*` dan `submissions/{id}/attachments/*`: create/delete hanya oleh pemilik selama status masih `diajukan`/`perlu_revisi`; update selalu ditolak (immutable, hapus-lalu-buat-ulang kalau perlu ganti).
- `counters/{id}`: create hanya di angka 1, update hanya increment persis +1, hanya role `admin` — mencegah lompatan nomor pengajuan.
- Simpan rules di `firestore.rules`, test pakai Firebase Emulator + `@firebase/rules-unit-testing` (`tests/firestore-rules.test.ts`) sebelum deploy — di mesin tanpa Java, test ini tidak bisa dijalankan lokal, jadi verifikasi manual (baca ulang logic rule vs test case) jadi pengganti sementara.

## Modul Client-side (`/lib`)

Pengganti apa yang sebelumnya jadi Cloud Functions callable — sekarang fungsi biasa yang dipanggil langsung dari komponen client, dan validasi otorisasinya didobel di `firestore.rules`:

| Modul | Dipanggil dari | Tugas |
| --- | --- | --- |
| `lib/submissions/submitSubmission.ts` | Form Buat Pengajuan (`kendaraan`/`perlengkapan`/`gedung_fasilitas`) | Generate `submissionNumber` (transaction di `counters`), tulis submission + items + statusHistory dengan status `diajukan` |
| `lib/submissions/reviewSubmission.ts` | Halaman Antrian Persetujuan (`spv`/`management`), alur operasional | Approve → set `disetujui` + data approver; reject → set `perlu_revisi` + `rejectionNote` wajib diisi |
| `lib/submissions/submitPersonaliaSubmission.ts` | Form Buat Pengajuan, kategori Lembur/Cuti/Izin | Generate `submissionNumber`, tulis submission (field `employeeName`/`periodStart`/`periodEnd`) + 1 attachment + statusHistory; cek role vs `subType` (mis. `lembur` cuma untuk `admin`, bukan `spv`) |
| `lib/submissions/reviewPersonaliaSubmission.ts` | Halaman Antrian Persetujuan, submission `type: "personalia"` | Approve → isi `spvApproval`/`managerApproval` milik sendiri; kalau approval yang lain sudah ada, sekalian set status `selesai`. Reject → sama seperti alur operasional |
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

## Ekspansi One Gate (Gedung & Fasilitas + Personalia)

Setelah migrasi Spark-plan selesai, sistem submissions diperluas jadi "one gate" untuk dua kategori baru (plan & design lengkap: `docs/superpowers/plans/2026-08-29-one-gate-personalia-gedung.md`, `docs/superpowers/specs/2026-08-29-one-gate-personalia-gedung-design.md`):

- **`gedung_fasilitas`**: reuse alur operasional yang sudah ada apa adanya (items + tanda tangan + approve → PDF → kirim GA → selesai) — cuma nambah `type` & `subType` (`pengadaan_baru`/`perbaikan`) baru, tidak ada modul atau rule baru.
- **`personalia`** (`lembur`/`cuti`/`izin`): alur yang beda secara material — 1 dokumen upload (bukan items+tanda tangan), dual approval dari `spv` DAN `management` (bukan salah satu), auto-selesai tanpa tahap kirim-ke-GA (lihat varian di "Alur Status"). Modul terisolasi: `submitPersonaliaSubmission.ts` + `reviewPersonaliaSubmission.ts`, tidak menyentuh modul operasional yang sudah ada. `spv` jadi bisa mengajukan `cuti`/`izin` (sebagai karyawan) sekaligus tetap approve kategori lain — lihat tabel User Roles. Template WA-nya beda juga: `buildPersonaliaWaTemplate` di `lib/wa-template.ts`, ditujukan ke HC bukan GA.
- Role `management` di-relabel jadi "Operational Manager" di seluruh UI (nav, form admin, PDF) — value di database tetap `management`.
- `lib/monitoring.ts` sudah toleran terhadap tahap yang dilewati (personalia langsung `diajukan` → `selesai`): kolom durasi tahap yang tidak ada history-nya otomatis render `"-"`, tidak perlu perubahan kode.

## Restrukturisasi Role Admin (Admin Terpusat + Data Master Pegawai)

Role `admin_cabang` (WHO/WHP) dan `snd` sudah dihapus, digantikan satu role `admin` terpusat (branch `null`, sama seperti `spv`/`management`/`superadmin`). Staf cabang tidak lagi punya akun di app — mereka mengirim permintaan ke admin di luar app (WA/dsb), admin memfilter manual, lalu menginput pengajuan atas nama pegawai yang dipilih dari koleksi `employees` (data master, dikelola superadmin lewat `/admin/pegawai`, bukan akun login).

`requesterId` pada submission tetap uid admin (dipakai untuk ownership di alur retry PDF/konfirmasi GA/tandai selesai — semua tetap dilakukan admin). `employeeId`+`employeeName` menyimpan identitas pemohon asli, didenormalisasi saat submission dibuat dari data `employees`. `branch`/`department`/`position` pada submission ikut diambil dari `employees`, bukan dari profil admin.

Tanda tangan pemohon sekarang selalu diupload (bukan digambar di app) lewat toggle "Upload File" yang sudah ada di form (`FileUpload` dengan `purpose="signature"`, menerima PNG dan JPEG) — karena pemohon mengirim tanda tangannya sendiri lewat foto/scan ke admin.

Role `spv` yang submit personalia `cuti`/`izin` untuk dirinya sendiri tidak terpengaruh — jalur itu tetap sama seperti sebelumnya (tanpa `employeeId`, `employeeName` tetap teks bebas). Karena `spv` juga tidak punya `branch` (selalu `null` di bawah model admin terpusat), jalur self-submit ini fallback ke `branch: "HQ"` kalau `caller.branch` kosong, biar nomor pengajuan/counter key tidak kebawa nilai `null` (lihat `resolveEmployeeContext` di `lib/submissions/submitPersonaliaSubmission.ts`).

Detail lengkap: `docs/superpowers/specs/2026-09-02-admin-terpusat-data-pegawai-design.md`.

## Struktur Folder

```
/app
  /(auth)/login
  /(dashboard)
    /pengajuan          # list & buat pengajuan (admin)
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
3. Simpan config Firebase client di `.env.local` (`NEXT_PUBLIC_FIREBASE_*`), plus `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` untuk upload ke Drive (lihat `.env.local.example`). Tidak perlu folder ID — tiap akun dapat foldernya sendiri secara otomatis (lihat catatan scope `drive.file` di Tech Stack). Tidak ada service account/Admin SDK credential yang perlu disimpan untuk alur aplikasi sehari-hari (Admin SDK cuma dipakai di `scripts/seed-emulator.ts` untuk seed data emulator lokal).
4. Di Google Cloud Console project yang sama, OAuth consent screen ("Google Auth Platform") wajib di-set **Publishing status: In production** (bukan Testing) — kalau tidak, cuma akun yang didaftarkan manual sebagai Test user yang bisa authorize Drive. Publish butuh field Branding (App name, User support email, Application home page/privacy policy/terms of service link) terisi lengkap — halaman `/privacy` dan `/terms` sudah ada di app buat ini. Karena app belum diverifikasi Google, user akan lihat warning "Google hasn't verified this app" sekali di authorize pertama — klik "Advanced" → "Go to ... (unsafe)" untuk lanjut, ini normal untuk internal tool yang belum verifikasi resmi.
5. Definisikan Firestore composite indexes di `firestore.indexes.json` untuk query dashboard (filter status + jenis + cabang + sort tanggal).
6. Pastikan project Firebase tetap di plan Spark — jangan upgrade ke Blaze kecuali keputusan itu diubah secara sadar (lihat catatan arsitektur di atas).

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
- [x] Deploy: static export + Firebase Hosting ke project `sndsupportapps` — live di https://sndsupportapps.web.app. `firestore.rules`/`firestore.indexes.json` juga sudah dideploy
- [x] Setup Google Drive OAuth (`NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`) — sudah diisi di `.env.local`; consent screen di-publish ke Production (bukan Testing) supaya semua akun karyawan bisa authorize tanpa didaftarkan manual; `NEXT_PUBLIC_DRIVE_FOLDER_ID` sudah tidak dipakai — folder Drive tujuan upload sekarang dibuat otomatis per akun (`getOrCreateAppFolder()` di `lib/drive-upload.ts`) karena scope `drive.file` tidak bisa menulis ke folder yang di-share manual
- [x] Ekspansi One Gate: `gedung_fasilitas` (reuse alur operasional) + `personalia` lembur/cuti/izin (dual approval spv+management) — lihat bagian "Ekspansi One Gate" di atas. Sudah di-merge ke `main`, build & test non-emulator lolos
- [x] Test otomatis emulator-dependent (`tests/firestore-rules.test.ts`, `lib/counters.test.ts`) — sudah bisa dijalankan setelah Java 21 terpasang (JDK portable, tidak butuh admin — lihat catatan Setup Awal), **190/190 test lolos** untuk pertama kalinya. `lib/counters.test.ts` sempat gagal PERMISSION_DENIED karena test itu pakai `unauthenticatedContext()` tanpa ruleset — sudah diperbaiki (jalan dengan ruleset terbuka, karena memang cuma nguji logic transaction, bukan rules). `scripts/seed-emulator.ts` juga sempat salah `projectId` (`pengajuan-kendaraan-perlengkapan` peninggalan sebelum rename, bukan `sndsupportapps`) — sudah diperbaiki.
- [x] QA manual end-to-end (2026-09-01, via emulator + browser automation Playwright, bukan browser sungguhan interaktif) — nav per-role, submit gedung_fasilitas, submit+dual-approval personalia cuti (partial approval spv, final approval management → selesai), template WA ke HC, isolasi kategori spv (Lembur tersembunyi, Cuti/Izin muncul). Ketemu 1 bug kritis: **generate PDF selalu crash** di semua percobaan (auto saat approve maupun retry manual) — `html2canvas` meng-clone seluruh document untuk stacking context, sehingga ikut baca token warna `oklch()` dari CSS aplikasi (Tailwind base reset `* { border-color: var(--border) }` dkk) yang tidak bisa di-parse. Fix: render PDF di `<iframe>` terisolasi (`lib/pdf/generateSubmissionPdfClient.ts`), bukan `<div>` yang ditempel ke `document.body`. Sekalian ketemu & benerin `pdfTemplate.ts` yang belum kenal type `gedung_fasilitas` (bakal render "undefined"). **Belum tervalidasi**: langkah upload PDF ke Google Drive di ujung alur generate — butuh akun Google asli buat klik lewat OAuth popup, di luar jangkauan automasi headless.
