# Generate Submission PDF — Design Spec

**Tanggal:** 2026-08-27
**Status:** Approved

## Latar Belakang

Sub-proyek ketiga dari rencana pengerjaan checklist MVP yang tersisa. Alur status saat ini berhenti di `disetujui` — belum ada jalan menuju `siap_dikirim`. Per CLAUDE.md, transisi ini dipicu oleh Cloud Function `generateSubmissionPdf`: render PDF (meniru formulir GA), upload, isi `pdfUrl`, ubah status ke `siap_dikirim`.

Urutan sub-proyek checklist MVP:
1. Login Username — selesai
2. Manajemen User (superadmin) — selesai
3. **`generateSubmissionPdf`** — spec ini
4. Copy Template WA + `confirmSentToGa`
5. Tombol Tandai Selesai + `markAsDone`
6. Dashboard Monitoring

## Gap yang Ditemukan Saat Desain

CLAUDE.md menyebutkan tanda tangan digital diambil "saat submit (pengaju) & saat approve (approver)", dan model data punya field `approverSignatureUrl`. Tapi implementasi `reviewSubmission` yang ada **tidak** menangkap tanda tangan approver — hanya approve/reject + catatan reject. Karena PDF butuh blok tanda tangan "Mengetahui" dari approver, spec ini **juga mencakup** menambahkan penangkapan tanda tangan approver sebagai prasyarat, bukan hanya generate PDF-nya saja.

## Keputusan Desain

### 1. Tanda tangan approver ditangkap saat approve

`reviewSubmissionSchema` (di `lib/schemas/submission.ts` **dan** `functions/src/schemas.ts` — pola duplikasi yang sama seperti schema lain di kedua tempat itu) mendapat field baru:

```typescript
approverSignatureUrl: z.string().url().nullish(),
```

dengan `.refine()` tambahan: wajib diisi (non-null, non-kosong) kalau `decision === "approve"` — persis pola `rejectionNote` wajib saat `decision === "reject"` yang sudah ada di schema yang sama.

`functions/src/reviewSubmission.ts`: saat approve, `approverSignatureUrl` dari input disimpan ke field `approverSignatureUrl` pada dokumen submission (field ini sudah ada di skema Firestore CLAUDE.md, sebelumnya tidak pernah diisi).

### 2. `uploadFileHandler` diperluas untuk approver

Saat ini `uploadFileHandler` (`functions/src/uploadFile.ts`) menolak semua role kecuali `admin_cabang`/`snd`. Diubah jadi pengecekan role **per-`purpose`**:

```typescript
const ALLOWED_ROLES_BY_PURPOSE: Record<UploadFileInput["purpose"], readonly string[]> = {
  attachment: ["admin_cabang", "snd"],
  signature: ["admin_cabang", "snd", "spv", "management"],
};
```

`attachment` tetap eksklusif untuk pengaju; `signature` terbuka untuk pengaju maupun approver (approver tidak pernah boleh upload attachment ke submission yang bukan miliknya).

### 3. UI Antrian Persetujuan dapat signature capture

`/persetujuan` (`app/(dashboard)/persetujuan/page.tsx`) dapat komponen signature capture per baris antrian, memakai ulang pola toggle "Gambar" / "Upload File" (komponen `SignaturePad` dan `FileUpload` yang sudah ada, sama seperti di form Buat Pengajuan) — disimpan di state `signatureBySubmission: Record<string, string>`, mirip pola `noteBySubmission` yang sudah ada. Tombol "Setujui" untuk baris tersebut nonaktif selama signature kosong. Tombol "Tolak" tidak berubah (tidak butuh tanda tangan).

### 4. Template PDF — layout standar (tidak ada referensi fisik)

File baru `functions/src/pdfTemplate.ts`, fungsi murni `buildSubmissionPdfHtml(data): string` (tidak menyentuh Firestore/Puppeteer — sepenuhnya bisa di-unit-test).

Layout:
- **Kop**: "PT TRIDAYA SINERGI INDONESIA", judul "FORMULIR PENGAJUAN KENDARAAN/PERLENGKAPAN", nomor pengajuan (font mono), tanggal disetujui.
- **Info pengajuan** dua kolom: kiri — Cabang, Departemen, Posisi, Nama Pengaju; kanan — Jenis Pengajuan, Sub Jenis, Tanggal Diajukan.
- **Tabel item**: No, Nama Item, Merk/Tipe, KM (kolom disembunyikan kalau `type === "perlengkapan"`), Jumlah, Satuan, Deskripsi.
- **Blok tanda tangan**: dua kolom sejajar — "Pemohon" (nama pengaju + `<img>` dari `requesterSignatureUrl`) dan "Mengetahui" (nama approver + label role, mis. "AWS Supervisor"/"Management" — dari `approverRole` + `<img>` dari `approverSignatureUrl`).
- **Footer**: teks kecil "Dokumen digenerate otomatis oleh sistem pada `<timestamp>`."
- Font: Plus Jakarta Sans (heading) / Public Sans (body) / IBM Plex Mono (nomor, KM, tanggal, angka) via Google Fonts `<link>`, dengan fallback stack font sistem. Aksen garis tipis warna `#0891B2` (token warna status `disetujui` di CLAUDE.md) di bawah kop.

Catatan implementasi: `requesterSignatureUrl`/`approverSignatureUrl` bisa berupa data URL base64 (mode "Gambar") atau link Drive (mode "Upload File") — keduanya valid langsung sebagai `src` pada `<img>`, tidak perlu penanganan berbeda.

### 5. Trigger: Firestore `onDocumentUpdated`, bukan dipanggil langsung dari `reviewSubmission`

File baru `functions/src/generateSubmissionPdf.ts`, di-export sebagai Firestore trigger (`onDocumentUpdated` pada `submissions/{submissionId}`), aktif kalau `before.status !== "disetujui" && after.status === "disetujui"`.

Alasan: memisahkan proses approve (harus cepat, approver tidak perlu menunggu) dari proses render PDF yang berat (Puppeteer, bisa beberapa detik). `reviewSubmission.ts` tidak berubah selain menyimpan `approverSignatureUrl` (poin 1) — tidak memanggil generate PDF secara langsung.

Konfigurasi function: `memory: "1GiB"`, `timeoutSeconds: 120` (sesuai catatan CLAUDE.md soal kebutuhan Puppeteer — "Set memory ≥1GiB dan timeout ≥60s").

Alur orkestrasi:
1. Ambil dokumen submission + subcollection `items` + dokumen `users` untuk `requesterId` dan `approverId`.
2. Render HTML via `buildSubmissionPdfHtml(...)`.
3. Render ke PDF buffer via `puppeteer-core` + `@sparticuz/chromium` (pola standar: `chromium.args`, `chromium.defaultViewport`, `executablePath: await chromium.executablePath()`, `headless: chromium.headless`).
4. Upload buffer ke Google Drive via `uploadToDrive` yang sudah ada (`functions/src/googleDrive.ts`) — **bukan** Firebase Storage, konsisten dengan lampiran & tanda tangan yang sudah pakai Drive.
5. Update dokumen submission: `pdfUrl: webViewLink`, `status: "siap_dikirim"`.
6. Tulis entry baru di `statusHistory`: `status: "siap_dikirim"`, `note: null`, `actorId: "system"`, `actorRole: "system"` (transisi otomatis, bukan aksi user manual — nilai sentinel ini konsisten dipakai untuk semua transisi yang dipicu sistem, bukan role asli manapun di `users.role`).

### 6. Penanganan error

Kalau generate PDF gagal (Puppeteer crash, Drive gagal upload, dll), error di-`console.error` dan function melempar error (terlihat sebagai failed execution di Firebase Console log). Submission tetap di status `disetujui` — tidak ada status "error" khusus, tidak ada retry otomatis. Di luar scope MVP ini; investigasi/retry manual oleh developer lewat log kalau terjadi.

### 7. Batasan testing di mesin ini

`buildSubmissionPdfHtml` (fungsi murni) bisa di-unit-test penuh tanpa emulator — test ditulis dan **dijalankan/diverifikasi** di sini.

Orkestrasi Puppeteer + Drive + Firestore trigger **tidak bisa diverifikasi hidup di mesin development ini**, karena dua alasan independen:
- Firestore Emulator butuh Java (tidak tersedia, sudah jadi batasan sejak sub-proyek sebelumnya).
- `@sparticuz/chromium` berisi binary Chromium khusus Linux (target runtime Cloud Functions produksi) — tidak akan jalan di Windows sama sekali, walau emulator-nya menyala.

Test untuk `generateSubmissionPdf.ts` akan ditulis mengikuti pola TDD yang sama seperti Cloud Function lain di repo ini, tapi hanya diverifikasi lewat type-check (`npm --prefix functions run build`), bukan dijalankan. Verifikasi render PDF sungguhan baru bisa dilakukan setelah deploy ke Cloud Functions produksi (Linux runtime).

## Di Luar Scope

- Status/alur retry otomatis kalau generate PDF gagal.
- Preview PDF di browser sebelum download (link Drive `webViewLink` sudah bisa dibuka langsung).
- Watermark, digital signature kriptografis pada file PDF, atau proteksi password PDF.
