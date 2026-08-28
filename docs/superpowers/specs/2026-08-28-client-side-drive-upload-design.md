# Migrasi Upload File ke Client-Side Google Drive (OAuth) — Design Spec

**Tanggal:** 2026-08-28
**Status:** Approved

## Latar Belakang

Project Firebase (`sndsupportapps`, "Pengajuan Kendaraan TSI") akan tetap di plan **Spark** (gratis) — bukan Blaze. Cloud Functions generasi 2 (dipakai di seluruh backend aplikasi ini) **tidak bisa jalan di Spark sama sekali**, bukan soal kuota, tapi batasan teknis Google (Functions v2 jalan di atas Cloud Run yang mewajibkan akun billing aktif). Ini keputusan sadar yang sudah dikonfirmasi user setelah memahami konsekuensinya.

Ini memicu **redesign besar** seluruh backend aplikasi, dipecah jadi beberapa sub-proyek berurutan:
1. **Migrasi upload file ke client-side Google Drive (OAuth)** — spec ini
2. Rewrite Firestore Rules (pindahkan validasi/alur status dari Cloud Functions ke rules + client writes)
3. Generate PDF di client (ganti Puppeteer server-side)
4. Manajemen user tanpa Cloud Functions (buat user via secondary Firebase app instance; hapus fitur reset password oleh superadmin — tidak ada penggantinya di Spark)
5. Bersih-bersih: hapus folder `functions/` yang sudah tidak terpakai, update CLAUDE.md

Sub-proyek ini spesifik menangani: bagaimana lampiran & tanda tangan (mode "Upload File") disimpan, sekarang tanpa Cloud Function sebagai perantara ke Google Drive.

## Keputusan Desain

### 1. Tetap Google Drive, upload langsung dari browser via OAuth

Bukan pindah ke Firebase Storage (ditolak eksplisit oleh user). Setiap user meng-otorisasi akses Google Drive mereka sendiri lewat popup consent Google — **terpisah** dari login aplikasi (yang pakai username/password, bukan akun Google). User sudah menerima ini akan butuh langkah consent tambahan minimal sekali per sesi.

**Scope OAuth**: `https://www.googleapis.com/auth/drive.file` — app hanya bisa akses file yang dia sendiri buat lewat API ini, bukan seluruh Drive user. Lebih aman & tidak butuh proses verifikasi Google yang berat untuk penggunaan internal seperti ini.

**OAuth Client ID sudah dibuat**: `961820440687-12vpd7s5hnbl1c0lp7ohm8vftvm40ju1.apps.googleusercontent.com` (project `sndsupportapps`, OAuth consent screen status External/Testing — user perlu tambahkan email staff yang akan memakai aplikasi sebagai "Test users" di consent screen, di luar scope kode ini).

### 2. Folder Drive bersama (di luar aplikasi)

Semua file (lampiran, tanda tangan, nantinya PDF) diupload ke satu folder Drive bersama, supaya semua pihak (pengaju, approver, GA) bisa saling lihat file yang diupload orang lain. Folder ini dan akses Editor untuk staff terkait **diurus user sendiri lewat sharing Drive biasa**, di luar scope kode — kode hanya butuh folder ID-nya, dikonfigurasi lewat env var, bukan hardcode.

### 3. Modul reusable `lib/drive-upload.ts`

Dua fungsi utama:
- `getDriveAccessToken(): Promise<string>` — memuat Google Identity Services (GIS) script sekali (dynamic script injection), inisialisasi token client dengan `client_id` dari env var dan scope `drive.file`, minta token (memicu popup consent kalau belum pernah/sudah kadaluarsa), simpan hasilnya di variabel module-level (in-memory cache, hilang saat reload halaman — konsisten dengan sifat token OAuth yang memang berumur pendek, ~1 jam).
- `uploadToDriveClient(file: File): Promise<{ fileId: string; fileUrl: string }>` — pakai token dari atas, kirim `multipart/related` request ke `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` (metadata JSON `{name, parents: [folderId]}` + isi file), lalu `POST .../files/{fileId}/permissions` dengan `{type: "anyone", role: "reader"}` supaya link bisa diakses siapa saja yang tahu link-nya, lalu return `fileId` + link (dibedakan lagi jadi `webViewLink` untuk lampiran vs link direct-content `https://drive.google.com/uc?export=view&id=...` untuk gambar tanda tangan — pola yang sama seperti Cloud Function `uploadFile` yang lama).

Modul ini dipakai lagi nanti oleh sub-proyek 3 (generate PDF client-side) — dibangun sebagai utility umum sejak awal, bukan cuma untuk form upload, supaya tidak ada duplikasi logic OAuth/upload antara dua fitur.

### 4. `FileUpload.tsx` dirombak

Ganti alur: baca `File` langsung (tidak perlu lagi konversi ke base64 data URL — itu cuma perlu dulu karena harus dikirim lewat payload Cloud Function callable), validasi tipe/ukuran tetap di client (`ALLOWED_MIME_TYPES`/`MAX_SIZE` — sudah ada sebelumnya, sekarang jadi satu-satunya lapis validasi), panggil `uploadToDriveClient`, dapat hasil, panggil `onUploaded` seperti sebelumnya. **Interface komponen (`purpose`, `onUploaded`, tipe `UploadedFile`) tidak berubah** — jadi pemanggil (`pengajuan/new/page.tsx`, `persetujuan/page.tsx`) tidak perlu diubah sama sekali.

Konsekuensi yang diterima: validasi tipe/ukuran file sekarang murni client-side, tidak ada lapis server yang tidak bisa dilewati. Untuk tool internal dengan user yang sudah dikenal, risiko ini diterima.

### 5. Konfigurasi baru

`.env.local` dapat dua variabel baru (prefix `NEXT_PUBLIC_` karena bukan rahasia — Client ID OAuth dan folder ID Drive sama-sama aman untuk ada di bundle client):
```
NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID=961820440687-12vpd7s5hnbl1c0lp7ohm8vftvm40ju1.apps.googleusercontent.com
NEXT_PUBLIC_DRIVE_FOLDER_ID=<diisi user>
```
`.env.local.example` diperbarui juga dengan placeholder dua variabel ini.

### 6. Cloud Function `uploadFile` dihapus sepenuhnya

Begitu `FileUpload.tsx` tidak memanggilnya lagi, `functions/src/uploadFile.ts` + `functions/src/uploadFile.test.ts` + export `uploadFile` di `functions/src/index.ts` jadi kode mati 100% — dihapus sebagai bagian sub-proyek ini (bukan dibiarkan sampai sub-proyek 5), karena sudah pasti tidak terpakai lagi begitu langkah ini selesai.

### 7. `functions/src/googleDrive.ts` (service account) TETAP ada — untuk sekarang

Masih dipakai oleh dua Cloud Function lain yang belum diganti di sub-proyek ini:
- `generateSubmissionPdf.ts` (upload PDF hasil generate) — baru diganti di sub-proyek 3.
- `submitSubmission.ts` (`resubmitAfterRevisi`, hapus lampiran yatim dari Drive) — baru diganti di sub-proyek 2.

Jadi untuk sementara ada **dua metode upload Drive berdampingan**: service account (dipakai 2 Cloud Function yang masih hidup) dan OAuth client-side (dipakai form lampiran/tanda tangan). Ini disengaja — menjaga tiap sub-proyek tetap kecil dan bisa diuji sendiri-sendiri, bukan kelalaian desain.

### 8. Mode "Gambar" (tanda tangan digambar tangan) tidak berubah

Tetap disimpan sebagai data URL base64 langsung di field Firestore (`requesterSignatureUrl`/`approverSignatureUrl`) — tidak pernah lewat Drive sama sekali, baik sebelum maupun sesudah migrasi ini.

## Testing

`lib/drive-upload.ts` sulit di-unit-test penuh karena bergantung pada `window`/script Google Identity Services dan `fetch` ke API eksternal — akan ditulis dengan fungsi-fungsi kecil yang bisa di-mock sebisa mungkin (mis. memisahkan "build multipart body" sebagai fungsi murni yang bisa dites tanpa jaringan), tapi verifikasi upload sungguhan ke Google Drive **tidak bisa dilakukan otomatis** di sesi ini — butuh browser asli + akun Google asli + consent popup sungguhan. Verifikasi akhir dilakukan manual oleh user setelah deploy.

## Di Luar Scope

- Firebase Storage (ditolak eksplisit).
- Mengganti `functions/src/googleDrive.ts` (service account) — itu tugas sub-proyek 2 & 3.
- Hapus file/lampiran dari Drive saat dihapus dari form sebelum submit (perilaku lama juga tidak melakukan ini — file jadi yatim di Drive kalau user tambah lalu hapus sebelum submit; tidak berubah oleh migrasi ini).
- Setup folder Drive bersama & penambahan Test users di OAuth consent screen — tanggung jawab user, di luar kode.
