# Generate PDF di Client — Design Spec

**Tanggal:** 2026-08-28
**Status:** Approved

## Latar Belakang

Sub-proyek 3 dari 5 dalam migrasi arsitektur ke Firebase plan Spark (lihat `docs/superpowers/specs/2026-08-28-client-side-drive-upload-design.md` untuk latar belakang penuh). Sub-proyek 1 (upload file client-side) dan sub-proyek 2 (Firestore Rules untuk 4 transisi status) sudah selesai. Sub-proyek ini menyelesaikan transisi status terakhir yang masih bergantung Cloud Functions: `disetujui → siap_dikirim`, yang sebelumnya dipicu otomatis oleh Cloud Function `generateSubmissionPdf` (Puppeteer + Chromium headless) setiap kali dokumen `submissions/{id}` di-update ke status `disetujui`. Sub-proyek 2 sengaja tidak menyentuh transisi ini karena baru bisa didesain setelah tahu bagaimana PDF akan digenerate di client.

Urutan sub-proyek migrasi:
1. Migrasi upload file ke client-side Google Drive — selesai
2. Rewrite Firestore Rules (4 transisi status) — selesai
3. **Generate PDF di client (spec ini)**
4. Manajemen user tanpa Cloud Functions
5. Bersih-bersih: hapus folder `functions/` sisa, update CLAUDE.md

## Keputusan Desain

### 1. Library: jsPDF + html2canvas

Template HTML/CSS yang sudah ada (`functions/src/pdfTemplate.ts`) di-render ke sebuah elemen DOM tersembunyi, di-screenshot jadi canvas lewat `html2canvas`, lalu canvas itu ditempel sebagai gambar ke dokumen PDF lewat `jsPDF`. Alternatif (`@react-pdf/renderer`, generate PDF secara terprogram lewat komponen JSX khusus) ditolak karena akan menghasilkan visual berbeda dari template yang sudah teruji dan butuh menulis ulang seluruh layout dari nol. Trade-off yang diterima: teks di PDF hasil jadi gambar (tidak bisa di-select/search), ukuran file lebih besar dari PDF asli — dianggap dapat diterima untuk dokumen internal yang sudah punya tanda tangan sebagai gambar juga.

`jspdf` dan `html2canvas` ditambahkan sebagai dependency baru di `package.json`.

### 2. Trigger: browser approver saat approve, dengan retry di browser pengaju

`lib/submissions/reviewSubmission.ts` (sudah ada dari sub-proyek 2) diperluas: setelah write approve berhasil, browser approver langsung mengambil data items + user pengaju, generate PDF, upload ke Drive, lalu melakukan write kedua yang memindahkan status `disetujui → siap_dikirim` sambil mengisi `pdfUrl`.

Kalau langkah kedua ini gagal (koneksi putus, error canvas, dll.) — submission akan "macet" di status `disetujui` tanpa `pdfUrl`. Untuk itu, halaman detail pengaju (`app/(dashboard)/pengajuan/[id]/page.tsx`) menampilkan tombol "Coba Generate PDF" kalau `status === "disetujui"` dan `pdfUrl` masih kosong — memanggil ulang fungsi generate-PDF yang sama dari browser pengaju sendiri (pengaju juga punya akses ke kedua URL tanda tangan lewat field yang sudah ada di dokumen submission).

### 3. File client-side baru

- `lib/pdf/pdfTemplate.ts` — porting langsung dari `functions/src/pdfTemplate.ts` (fungsi murni pembuat string HTML, tidak ada kode spesifik Node, aman disalin nyaris tanpa perubahan).
- `lib/pdf/generateSubmissionPdfClient.ts` — orkestrator baru:
  1. Suntik `<link>` Google Fonts ke `<head>` (kalau belum ada) dan tunggu `document.fonts.ready`.
  2. Buat elemen container di luar layar (`position: fixed; left: -10000px`), isi dengan HTML dari `buildSubmissionPdfHtml`, tempel ke `document.body`.
  3. Tunggu semua `<img>` (tanda tangan) selesai load.
  4. `html2canvas(container, { useCORS: true, scale: 2 })` untuk kualitas cukup tajam saat dicetak.
  5. Potong-potong canvas hasil sesuai tinggi halaman A4 lewat fungsi murni `computePdfPageSlices(canvasWidthPx, canvasHeightPx, pageWidthMm, pageHeightMm)` (testable tanpa browser), lalu tempel tiap potongan sebagai halaman baru di `jsPDF`.
  6. Bungkus hasil `jsPDF.output("blob")` jadi `File`, upload lewat `uploadToDriveClient` (sudah ada dari sub-proyek 1) dengan purpose `"attachment"`.
  7. Hapus container dari DOM.
  8. Kembalikan `{ pdfUrl }`.

**Risiko belum teruji:** gambar tanda tangan di-host di Google Drive (`uc?export=view` URL) — ini pertama kalinya app ini memuat gambar Drive ke dalam canvas browser. `useCORS: true` di `html2canvas` adalah upaya pertama, tapi tidak bisa dipastikan berhasil tanpa browser sungguhan (tidak ada Java/emulator di mesin ini) — perlu verifikasi manual setelah deploy, sama seperti risiko folder Drive yang sudah dicatat di sub-proyek 1.

### 4. Firestore Rules — transisi `disetujui → siap_dikirim`

Ditambahkan sebagai klausa ke-6 di `allow update` pada `submissions/{submissionId}`, mengikuti pola field-restriction yang sama seperti 5 klausa lain dari sub-proyek 2:

```
(
  (resource.data.approverId == request.auth.uid || resource.data.requesterId == request.auth.uid)
  && resource.data.status == 'disetujui'
  && request.resource.data.status == 'siap_dikirim'
  && request.resource.data.pdfUrl is string
  && request.resource.data.pdfUrl.size() > 0
  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'pdfUrl'])
)
```

Diizinkan untuk approver ATAU pengaju (mendukung jalur retry) — keduanya sama-sama berkepentingan sah terhadap submission ini dan sama-sama sudah bisa membaca kedua URL tanda tangan lewat field yang ada di dokumen.

`statusHistory` entry untuk transisi ini ditulis dengan `actorId`/`actorRole` sesuai siapa pun yang browsernya menjalankan generate (approver di jalur utama, pengaju di jalur retry) — tidak perlu penanganan khusus, mengikuti pola yang sama seperti transisi lain.

### 5. Dihapus sepenuhnya

`functions/src/generateSubmissionPdf.ts`+`.test.ts`, `functions/src/pdfTemplate.ts`+`.test.ts` (versi server), `functions/src/googleDrive.ts`+`.test.ts` (dipakai HANYA oleh `generateSubmissionPdf.ts`, jadi mati total begitu itu dihapus). `functions/src/index.ts` disederhanakan — trigger `onDocumentUpdated` untuk `generateSubmissionPdf` dan importnya dihapus, hanya menyisakan `createUser`, `updateUser`, `resetUserPassword` (jatah sub-proyek 4).

### 6. Testing

`lib/pdf/pdfTemplate.ts` — porting test yang sudah ada (`functions/src/pdfTemplate.test.ts`) ke lokasi baru, fungsi murni jadi bisa dijalankan penuh di Vitest tanpa emulator.

`computePdfPageSlices` — fungsi murni (matematika pemotongan halaman), ditulis dengan test lengkap dan BISA dijalankan (tidak butuh browser/emulator, cuma butuh angka input/output).

`lib/pdf/generateSubmissionPdfClient.ts` — bergantung penuh pada DOM/`html2canvas`/`jsPDF`, tidak bisa ditest berarti tanpa browser sungguhan. Ditulis tapi tidak dijalankan, mengikuti pola yang sama seperti `uploadToDriveClient` di sub-proyek 1.

`tests/firestore-rules.test.ts` — ditambah test untuk klausa `disetujui → siap_dikirim` baru (allow approver, allow pengaju/retry, deny pihak lain, deny tanpa pdfUrl, deny field selain status+pdfUrl) — mengikuti pola yang sudah ada, tidak bisa dijalankan di mesin ini (butuh emulator).

## Di Luar Scope

- Manajemen user (`createUser`/`updateUser`/`resetUserPassword`) — tetap Cloud Function untuk sekarang (jatah sub-proyek 4).
- Perbaikan/redesign visual template PDF — layout HTML/CSS yang ada dipakai apa adanya, tidak diubah.
- Mekanisme fallback kalau `useCORS` gagal di produksi (misal proxy gambar lewat endpoint lain) — kalau risiko di atas ternyata benar-benar terjadi saat verifikasi manual, itu jadi keputusan desain terpisah yang dibahas saat itu, bukan diantisipasi sekarang.
