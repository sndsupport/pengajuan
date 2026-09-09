# Design: Lampiran di Antrian Persetujuan, Semua Pengajuan, & Posisi TTD Bebas

**Tanggal**: 2026-09-09
**Status**: Disetujui

## Latar Belakang

Tiga permintaan independen dari user:

1. Antrian Persetujuan (`/persetujuan`) tidak punya cara melihat lampiran/dokumen submission sebelum approve/reject.
2. Halaman "Pengajuan Saya" (`/pengajuan`) memfilter cuma milik sendiri, padahal `firestore.rules` sudah mengizinkan semua signed-in user membaca semua submission (rules-nya sudah terbuka, UI-nya yang belum).
3. Saat approve, PDF di-generate otomatis dari template dengan TTD approver di posisi tetap. User ingin approver bisa menggeser TTD-nya sendiri ke posisi manapun di dokumen sebelum PDF final dibuat.

Digabung jadi satu spec karena ukurannya kecil-kecil dan tidak saling bergantung secara teknis, tapi sama-sama menyentuh alur "Antrian Persetujuan".

## Non-Goals

- Tidak mengubah TTD pemohon (requester) — tetap posisi tetap dari template, diupload sebelum submit.
- Tidak ada resize TTD approver, cuma posisi (ukuran tetap sama seperti template lama).
- Tidak ada preview/embed dokumen inline (iframe) di kartu antrian — cukup link buka tab baru ke Drive.
- Tidak mengubah alur `personalia` (tidak ada PDF di alur itu, tidak tersentuh).

## A. Lampiran di Antrian Persetujuan

- `app/(dashboard)/persetujuan/page.tsx`: untuk tiap kartu submission (kendaraan/perlengkapan/gedung_fasilitas), fetch subcollection `attachments` submission tsb dan tampilkan sebagai daftar link (nama file → `fileUrl`, `target="_blank"`), sama seperti link lampiran yang sudah ada di halaman detail.
- Kartu personalia tidak berubah (sudah beda struktur, attachment personalia adalah 1 dokumen wajib — di luar scope perubahan ini, meski tidak dilarang menambah link yang sama kalau mudah).
- Fetch dilakukan sekali per submission saat kartu di-render (`getDocs` pada subcollection attachments), bukan `onSnapshot` (lampiran immutable selama status `diajukan`, tidak perlu realtime).

## B. "Semua Pengajuan" (rename dari "Pengajuan Saya")

- `app/(dashboard)/pengajuan/page.tsx`: hapus filter `where("requesterId", "==", appUser.uid)`, tampilkan semua submission urut `submittedAt` desc (pola sama seperti Monitoring).
- Judul halaman (`PageHeader`) dan label nav (`components/app-shell/nav-config.ts`) diganti dari "Pengajuan Saya" jadi **"Semua Pengajuan"**. `pageTitleForPath` ikut disesuaikan kalau ada rujukan literal ke label lama.
- Tombol aksi per baris (Resubmit, Generate PDF, Konfirmasi Kirim GA, Tandai Selesai) ditambah guard `row.requesterId === appUser.uid` — baris milik orang lain tampil read-only (tanpa tombol aksi), murni untuk visibilitas.
- Role yang bisa akses halaman ini di nav **tidak berubah** (`admin`, `spv`) — `management`/`superadmin` sudah punya Monitoring yang serupa cakupannya.

## C. Posisi TTD Bebas Saat Approve

### Alur baru

1. Approver isi TTD (SignaturePad/upload) seperti sekarang di kartu Antrian Persetujuan.
2. Klik **Setuju** → membuka `SignaturePlacementModal` (komponen baru) — **belum menulis apapun ke Firestore**.
3. Modal me-render dokumen (template yang sama seperti PDF final, tapi TANPA TTD approver dikompositkan) jadi satu kanvas panjang via pipeline `html2canvas` yang sudah ada, ditampilkan sebagai gambar yang bisa di-scroll. Garis putus-putus horizontal digambar di tiap batas potong halaman (dari `computePdfPageSlices`) sebagai penanda visual.
4. Gambar TTD approver muncul di atas kanvas itu, sudah diposisikan default (kira-kira di lokasi blok "Mengetahui" template lama), sebagai elemen yang bisa di-drag bebas (pointer events React biasa, tanpa library drag tambahan) — dibatasi agar tidak keluar dari kanvas.
5. Approver bisa langsung klik **Konfirmasi** (pakai posisi default) atau geser dulu.
6. Klik **Konfirmasi** → jalankan berurutan:
   a. `reviewSubmission()` (approve, seperti sekarang) — tulis `status: disetujui` + field approver.
   b. `generateAndAttachSubmissionPdf(submissionId, { xPercent, yPercent })` — composite TTD ke kanvas dasar di koordinat piksel hasil drag (dikonversi dari persen relatif ke kanvas penuh), potong per halaman, rakit PDF, upload ke Drive, tulis `pdfUrl` + `status: siap_dikirim`.
   Kalau langkah (b) gagal (network dsb), submission tetap `disetujui` — sama seperti jalur retry yang sudah ada sekarang, tidak ada perubahan pada `firestore.rules` (dua transisi status ini sudah ada, cuma dipicu berurutan dari satu interaksi UI, bukan fire-and-forget).
7. Klik **Batal** di modal: cuma menutup modal, tidak ada state yang berubah (belum ada tulisan ke Firestore).

### Retry path (konsisten, satu jalur kode)

- Tombol "Generate PDF" yang sudah ada di halaman detail (untuk submission `disetujui` tanpa `pdfUrl`, mis. modal ditutup di tengah jalan) dipakai ulang. Reuse `SignaturePlacementModal` yang sama (skip langkah `reviewSubmission()`, langsung ke composite+upload) — sehingga cuma ada SATU implementasi render+composite+upload PDF di seluruh app.

### Perubahan teknis

- `lib/pdf/pdfTemplate.ts`: `buildSubmissionPdfHtml` menerima `approverSignatureUrl: null` saat render untuk keperluan preview/final compositing (TTD approver tidak lagi ditempel via CSS/HTML sama sekali untuk kasus kendaraan/perlengkapan/gedung_fasilitas — selalu di-composite manual via canvas).
- `lib/pdf/generateSubmissionPdfClient.ts`: fungsi tunggal `generateSubmissionPdfClient(data)` yang ada sekarang **dipecah jadi dua fungsi**, tidak ada lagi jalur lama yang dipertahankan paralel:
  - `renderSubmissionBaseCanvas(data)` — render template (tanpa TTD approver) ke satu kanvas panjang via iframe+html2canvas (logic yang sudah ada, diekstrak apa adanya).
  - `compositeSignatureAndBuildPdf(baseCanvas, signatureImage, position)` — gambar TTD ke kanvas di koordinat piksel, potong per halaman (`computePdfPageSlices`, tidak berubah), rakit `jsPDF`.
  Satu-satunya pemanggil kedua fungsi ini adalah `SignaturePlacementModal` (langsung untuk preview + saat Konfirmasi).
- `lib/pdf/generateAndAttachSubmissionPdf.ts`: sekarang menerima parameter posisi TTD (bukan lagi memanggil `generateSubmissionPdfClient` lama), lalu upload hasil PDF ke Drive + tulis `pdfUrl`/`status: siap_dikirim` seperti sekarang. Dipakai dari `SignaturePlacementModal` baik untuk alur approve maupun retry di halaman detail.
- `lib/submissions/reviewSubmission.ts`: **hapus** pemanggilan fire-and-forget `generateAndAttachSubmissionPdf` dari dalam modul ini — modul ini kembali murni cuma menulis approve/reject, pemanggilan generate PDF dipindah eksplisit ke UI (`SignaturePlacementModal`) supaya bisa digerbangi oleh langkah posisi TTD.
- Komponen baru `components/pdf/SignaturePlacementModal.tsx` — terima props: data submission (untuk render template), url gambar TTD approver, callback `onConfirm(position)`, callback `onCancel()`.

### Error handling

- Render base canvas gagal (mis. `html2canvas` error seperti bug lama `oklch()` — sudah diperbaiki via iframe terisolasi, tetap dipakai) → modal tampilkan pesan error, tombol Konfirmasi disabled, approver bisa Batal dan pakai jalur retry di detail page nanti.
- Approve (langkah a) sukses tapi generate PDF (langkah b) gagal → submission tetap `disetujui`, modal tampilkan error dengan saran pakai tombol retry di halaman detail (bukan otomatis retry sendiri).

### Testing

- `computePdfPageSlices` — tidak berubah, test yang sudah ada tetap berlaku.
- Fungsi baru untuk konversi koordinat (persen drag → piksel kanvas, dan clamping ke batas kanvas) — unit test murni tanpa browser.
- Drag-and-drop interaktif itu sendiri tidak di-unit-test (butuh browser); diverifikasi manual sebelum dianggap selesai.
- Tambah test di `tests/firestore-rules.test.ts` HANYA jika ternyata perlu rule baru — desain di atas sengaja tidak menambah rule baru (dua transisi status yang dipakai sudah ada), jadi kemungkinan tidak ada penambahan test rules untuk bagian C. Bagian A dan B murni perubahan UI/query, tidak menyentuh rules.
