# Lampiran & Upload Tanda Tangan via Google Drive — Design Spec

**Status:** Approved, ready for implementation planning.

## Latar Belakang

Fase 1 (fondasi + alur inti pengajuan) sudah selesai dan berjalan. Data model yang didesain sejak awal (lihat `CLAUDE.md`) sudah mencantumkan subcollection `submissions/{id}/attachments/{attachmentId}` untuk dokumen pendukung, tapi UI dan Cloud Function untuk fitur ini belum pernah dibangun di Fase 1. Tanda tangan pengaju saat ini hanya bisa digambar tangan lewat `SignaturePad` (disimpan sebagai base64 PNG langsung di field `requesterSignatureUrl`).

Fitur ini menambahkan:
1. Upload lampiran dokumen pendukung (opsional) saat membuat pengajuan.
2. Opsi upload file PNG sebagai alternatif dari gambar tangan untuk tanda tangan pengaju.

Kedua jenis file disimpan di **Google Drive** (bukan Firebase Storage), memakai akun `sndsupport.tsi@gmail.com`.

**Eksplisit di luar cakupan spec ini** (didiskusikan dan sengaja ditunda): penyimpanan PDF hasil `generateSubmissionPdf` ke Drive — fitur `generateSubmissionPdf` sendiri belum dibangun, jadi keputusan penyimpanannya menunggu sampai fitur itu mulai didesain. Tanda tangan approver (spv/management) saat approve juga tidak disentuh spec ini — itu gap terpisah dari cakupan Fase 1 yang tidak diminta di sini.

## Arsitektur

### Setup Google Cloud / Drive (manual, sekali saja)

1. Enable Google Drive API di Google Cloud project yang sama dengan project Firebase ini.
2. Buat satu folder di My Drive akun `sndsupport.tsi@gmail.com`, misal bernama "Lampiran Pengajuan". Catat folder ID-nya.
3. Share folder tersebut sebagai **Editor** ke service account runtime Cloud Functions (email `<project-id>@appspot.gserviceaccount.com` atau service account default compute — cek yang benar-benar dipakai Cloud Functions gen2 di project ini). Di production, tidak perlu file kredensial terpisah — Cloud Functions memakai Application Default Credentials dari identitas ini secara otomatis.
4. Untuk **development lokal**: karena tidak ada emulator untuk Google Drive, panggilan ke Drive API selalu ke internet asli. Download service account key JSON (dari service account yang sama atau service account terpisah khusus dev, keduanya perlu di-share ke folder Drive yang sama), simpan di luar repo, referensikan lewat env var (mis. `GOOGLE_APPLICATION_CREDENTIALS`) di `.env.local`/shell lokal developer. **Jangan pernah commit file key ini ke repo** — sudah konsisten dengan aturan CLAUDE.md soal service account.
5. Simpan folder ID Drive sebagai config/env var Cloud Functions (bukan hardcode).

### Dependency baru

- `functions/package.json`: tambah `googleapis` (Google APIs Node.js client resmi).

### Cloud Function baru: `uploadFile`

Satu-satunya bagian sistem yang punya akses ke Drive. Client tidak pernah pegang kredensial apa pun untuk Drive.

```
uploadFile(rawData: unknown, context): Promise<{ fileUrl: string; fileName: string; fileType: string }>
```

- Fail-fast: tolak kalau `context.auth` kosong, atau role caller bukan `admin_cabang`/`snd` (sama seperti siapa yang boleh membuat pengajuan — sesuai konvensi CLAUDE.md, cek auth/role di awal sebelum logic lain).
- Input divalidasi Zod: `purpose: "attachment" | "signature"`, `fileName: string`, `fileType: string` (MIME type), `fileData: string` (base64, tanpa prefix `data:...;base64,` — atau dengan prefix, didefinisikan jelas saat implementasi & didokumentasikan di schema).
- Validasi server-side berdasarkan `purpose` (defense-in-depth, jangan cuma percaya validasi client):
  - `attachment`: MIME type harus salah satu dari `image/jpeg`, `image/png`, `application/pdf`; ukuran ≤ 10MB.
  - `signature`: MIME type harus `image/png`; ukuran ≤ 2MB.
- Upload ke folder Drive yang sudah dikonfigurasi lewat Drive API v3 (`files.create` dengan media body dari buffer hasil decode base64).
- Set permission file yang baru diupload: `type: "anyone", role: "reader"` (anyone-with-link-can-view — sesuai keputusan desain: link ini hanya pernah terlihat oleh user yang sudah login ke aplikasi dan lolos Firestore Security Rules untuk pengajuan terkait, jadi cukup aman untuk kebutuhan internal ini).
- Return `{ fileUrl, fileName, fileType }` — `fileUrl` adalah `webViewLink` yang dikembalikan Drive API (link viewer Google Drive standar, bisa langsung dibuka di tab baru untuk lihat/download file, dan providernya sendiri yang mengurus preview sesuai tipe file).

## Komponen & Alur Data

### File/komponen baru atau berubah

- `functions/src/uploadFile.ts` — handler seperti dijelaskan di atas.
- `functions/src/schemas.ts` & `lib/schemas/submission.ts` — tambah `uploadFileSchema` di kedua file ini (bukan file baru, karena terikat erat dengan payload submission yang sudah ada di situ), duplikat sesuai pola yang sudah berjalan di Fase 1 (root app & functions punya project TypeScript terpisah, tanpa shared build).
- `components/file-upload/FileUpload.tsx` — komponen picker file yang reusable:
  - Terima props: `purpose: "attachment" | "signature"`, `onUploaded: (file: {fileUrl, fileName, fileType}) => void`, kemungkinan `multiple?: boolean` untuk mode lampiran (banyak file) vs mode tanda tangan (satu file).
  - Validasi client-side (tipe & ukuran) untuk feedback cepat sebelum upload dimulai.
  - Panggil `uploadFile` callable, tampilkan status per-file (uploading / sukses / gagal).
  - Named export, konsisten dengan konvensi komponen di CLAUDE.md.
- `app/(dashboard)/pengajuan/new/page.tsx`:
  - Tambah bagian "Lampiran" (opsional, `FileUpload` mode `multiple`, `purpose: "attachment"`) — hasil upload masuk ke field array baru di form state (belum ke Firestore, cuma metadata `{fileUrl, fileName, fileType}` yang dikumpulkan sampai submit).
  - Tambah toggle di atas area tanda tangan: "Gambar" (default, `SignaturePad` seperti sekarang) vs "Upload File" (`FileUpload` mode single, `purpose: "signature"`, hasilnya jadi `requesterSignatureUrl` menggantikan base64 dari canvas).
  - Alur resubmit (`?resubmit=<id>`, sudah ada dari Fase 1): saat fetch data pengajuan lama untuk pre-fill, sekarang juga fetch `attachments` subcollection dan isi field array attachment form dengan data lama — pengaju boleh hapus salah satu atau tambah baru sebelum resubmit. Tanda tangan tetap wajib diisi ulang (drawing atau upload), tidak di-carry-over — konsisten dengan keputusan Fase 1 bahwa tanda tangan adalah re-attestation, bukan data yang dicopy.
- `functions/src/submitSubmission.ts`:
  - Payload `createSubmissionSchema` (kedua salinan) ditambah field `attachments: {fileUrl, fileName, fileType}[]` (opsional, default array kosong).
  - `createNewSubmission` dan `resubmitAfterRevisi`: batch write attachment ke subcollection `attachments`, persis pola yang sudah ada untuk `items` di `resubmitAfterRevisi` sekarang — hapus semua dokumen attachment lama, tulis ulang seluruh isi array `attachments` dari payload (bukan diff tambah/hapus per-item). Konsisten dengan bagaimana `items` sudah ditangani, dan cukup sederhana karena payload attachment sudah berisi keseluruhan daftar final (termasuk yang lama yang dipertahankan, hasil dari pre-fill di client).
- `firestore.rules`:
  - Tambah `match /attachments/{attachmentId}` di dalam `match /submissions/{submissionId}` dengan aturan read-follows-parent yang identik dengan `items`/`statusHistory` (owner atau reviewer boleh baca, write selalu `false` untuk client).

### Alur data (happy path)

1. User di form "Buat Pengajuan" pilih file (lampiran atau upload tanda tangan).
2. `FileUpload` validasi client-side → panggil `uploadFile` callable dengan base64 file + purpose.
3. `uploadFile` validasi lagi di server → upload ke folder Drive → set permission → return metadata.
4. Metadata (`fileUrl`, dst) disimpan di state form React Hook Form (attachment: ditambahkan ke field array; signature-upload: jadi nilai `requesterSignatureUrl`) — belum menyentuh Firestore sama sekali.
5. User lanjut isi form, klik "Kirim Pengajuan" → payload `submitSubmission` sekarang membawa array `attachments` (dan `requesterSignatureUrl` berupa link Drive kalau pakai mode upload, atau base64 kalau pakai mode gambar).
6. `submitSubmission` batch-write attachment ke subcollection, sama seperti `items`/`statusHistory` sekarang.

## Error Handling

- Semua error upload (network, tipe file salah, ukuran kelebihan, Drive API gagal) ditampilkan inline per-file di UI, pola visible-red-text yang sudah konsisten dipakai di seluruh app — tidak pernah silent.
- Validasi server-side adalah sumber kebenaran; validasi client cuma untuk feedback cepat.
- Pesan error ke user selalu berbahasa Indonesia dan tidak membocorkan detail internal Drive API mentah (mis. bukan `"Google API error: insufficient permission on resource xyz"`, tapi `"Gagal upload file, coba lagi."`).
- **Keterbatasan yang diterima untuk sekarang:** file yang sudah terupload ke Drive tapi form-nya tidak jadi disubmit (user tinggalkan halaman) akan jadi file "yatim" di folder Drive. Tidak ada pembersihan otomatis di cakupan ini — bisa jadi Cloud Function scheduled terpisah kalau nanti benar-benar jadi masalah nyata (banyak file sampah menumpuk).

## Testing

- Unit test `uploadFile.ts` (Vitest, mock `googleapis` Drive client — tidak ada panggilan network asli di CI): auth/role fail-fast, penolakan tipe file salah, penolakan ukuran file kelebihan (beda aturan untuk `attachment` vs `signature`), upload sukses mengembalikan bentuk yang diharapkan.
- Tambahan test `firestore.rules` untuk subcollection `attachments` baru, mengikuti pola test `items` yang sudah ada (owner baca berhasil, reviewer baca berhasil, non-owner/non-reviewer baca gagal, write dari client gagal).
- `submitSubmission.test.ts` ditambah kasus payload dengan `attachments`, memastikan subcollection tertulis benar (baik create baru maupun resubmit).
- **Gap yang disadari dan diterima:** upload asli ke Google Drive cuma bisa diverifikasi dengan memanggil Drive API sungguhan (tidak ada emulator untuk Drive) — jadi verifikasi end-to-end "file benar-benar sampai ke Drive" dilakukan manual/lewat Cloud Function yang sudah dideploy, bukan bagian dari automated test suite yang jalan di emulator seperti Fase 1. Ini berbeda dari standar testing Fase 1 sebelumnya yang semuanya bisa diverifikasi lewat emulator.
