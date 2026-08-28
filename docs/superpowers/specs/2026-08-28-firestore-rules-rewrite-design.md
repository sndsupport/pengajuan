# Rewrite Firestore Rules — Alur Status Tanpa Cloud Functions — Design Spec

**Tanggal:** 2026-08-28
**Status:** Approved

## Latar Belakang

Sub-proyek 2 dari 5 dalam migrasi arsitektur ke Firebase plan Spark (lihat `docs/superpowers/specs/2026-08-28-client-side-drive-upload-design.md` untuk latar belakang penuh soal kenapa Cloud Functions v2 tidak bisa dipakai). Sub-proyek 1 (upload file client-side ke Google Drive) sudah selesai. Sub-proyek ini memindahkan **transisi status alur pengajuan** — sebelumnya divalidasi & dieksekusi di 4 Cloud Function (`submitSubmission`, `reviewSubmission`, `confirmSentToGa`, `markAsDone`) — menjadi tulisan langsung dari client, dijaga oleh Firestore Security Rules.

Urutan sub-proyek migrasi:
1. Migrasi upload file ke client-side Google Drive — selesai
2. **Rewrite Firestore Rules (spec ini)**
3. Generate PDF di client
4. Manajemen user tanpa Cloud Functions
5. Bersih-bersih: hapus folder `functions/` sisa, update CLAUDE.md

## Keputusan Desain

### 1. Rules fokus keamanan, bukan kualitas data

Firestore Rules hanya menjaga hal yang benar-benar soal **otorisasi & integritas alur status**: siapa boleh mengubah status apa, kepemilikan data, `statusHistory.actorRole` tidak bisa dipalsukan. Validasi detail field (nama item wajib diisi, KM harus angka non-negatif, dll.) **tetap** di Zod client-side (`lib/schemas/submission.ts`, tidak berubah) — tidak direplikasi ke rules. Kalau seseorang memodifikasi browser mereka sendiri untuk mengirim data yang tidak lolos Zod, itu bukan celah keamanan (tidak bisa mengakses data orang lain atau melompati alur status), cuma data kotor yang gampang ketauan lewat review manual.

### 2. Scope: 4 fungsi + counter + subcollection writes — TIDAK termasuk `disetujui → siap_dikirim`

Transisi `disetujui → siap_dikirim` (dulunya dipicu otomatis oleh trigger `generateSubmissionPdf`) **sengaja tidak disentuh** di sub-proyek ini — itu tanggung jawab sub-proyek 3, karena transisi tersebut secara harfiah dipicu oleh proses generate-PDF itu sendiri (baru bisa didesain setelah tahu bagaimana PDF di-generate di client). Konsekuensinya: begitu sub-proyek ini selesai, submission yang baru disetujui akan "berhenti" di status `disetujui` sampai sub-proyek 3 selesai — pola bertahap yang sama seperti waktu fitur ini pertama kali dibangun.

### 3. State machine di `firestore.rules`

Rule `allow update` pada `submissions/{submissionId}` diganti dari `if false` jadi kombinasi klausa, satu per transisi valid:

| Transisi | Syarat |
|---|---|
| `perlu_revisi → diajukan` (resubmit) | `resource.data.requesterId == request.auth.uid`, status lama `perlu_revisi` |
| `diajukan → disetujui` | `userRole() in ['spv','management']`, status lama `diajukan`, `request.resource.data.approverId == request.auth.uid`, `request.resource.data.approverRole == userRole()`, `request.resource.data.approverSignatureUrl` non-kosong |
| `diajukan → perlu_revisi` | sama seperti di atas tapi `request.resource.data.rejectionNote` non-kosong |
| `siap_dikirim → on_proses_ga` | `resource.data.requesterId == request.auth.uid`, status lama `siap_dikirim` |
| `on_proses_ga → selesai` | `resource.data.requesterId == request.auth.uid`, status lama `on_proses_ga` |

Rule `create` pada `submissions/{submissionId}` sudah ada dari Fase 1 (role `admin_cabang`/`snd`, `requesterId == auth.uid`, `status == 'diajukan'`) — dipakai langsung oleh client, tidak perlu perubahan besar.

`statusHistory/{historyId}`: `allow create` (bukan lagi `if false`) — mensyaratkan `actorId == request.auth.uid` dan `actorRole` di dokumen yang ditulis **sama** dengan role asli user (dicek lewat `get()` ke `users/{uid}`, pakai helper `userRole()` yang sudah ada di rules) — mencegah user memalsukan role di log audit.

`items/{itemId}` & `attachments/{attachmentId}`: `allow create, delete` untuk pemilik submission, hanya selama submission induk masih di status yang boleh diedit (`diajukan` baru, atau `perlu_revisi` saat resubmit) — mencegah tambah/hapus item setelah submission disetujui.

`counters/{counterId}`: `allow get` untuk role `admin_cabang`/`snd` (dibutuhkan transaksi client untuk baca nilai lama), `allow update` untuk role yang sama dengan syarat `request.resource.data.lastNumber == resource.data.lastNumber + 1` (atau `== 1` untuk dokumen baru) — bukan soal keamanan, tapi murah untuk dicek dan mencegah bug penomoran duplikat dari kode client yang salah.

### 4. File client-side baru

- `lib/submissions.ts` — `submitNewSubmission`, `resubmitAfterRevisi`, `reviewSubmission` (approve/reject), `confirmSentToGa`, `markAsDone`. Tiap fungsi: validasi Zod (schema sudah ada, tidak berubah) → tulis ke Firestore langsung pakai `runTransaction`/`writeBatch` dari client SDK — pola sama seperti versi Cloud Function lama, cuma dieksekusi di browser bukan server.
- `lib/counters.ts` — logic penomoran otomatis (transaksi baca-tambah-tulis pada `counters/{branch-year-month}`), dipindah dari `functions/src/counters.ts` dengan penyesuaian pakai Firestore client SDK.
- `lib/drive-upload.ts` (sudah ada dari sub-proyek 1) dapat fungsi baru `deleteFromDriveClient(fileId)` — dipakai saat resubmit untuk hapus lampiran yatim dari Drive (dulu server-side pakai service account, sekarang client-side pakai OAuth token yang sudah ada; scope `drive.file` sudah cukup untuk delete file yang dibuat lewat scope yang sama).

### 5. Halaman yang dirombak

`app/(dashboard)/pengajuan/new/page.tsx`, `app/(dashboard)/persetujuan/page.tsx`, `app/(dashboard)/pengajuan/[id]/page.tsx` — ganti pemanggilan `httpsCallable(functions, "...")` jadi panggil fungsi yang sesuai di `lib/submissions.ts` langsung. Tidak ada perubahan UI/UX yang terlihat user — cuma jalur teknis di baliknya yang berubah.

### 6. Dihapus sepenuhnya

`functions/src/submitSubmission.ts`, `reviewSubmission.ts`, `confirmSentToGa.ts`, `markAsDone.ts`, `counters.ts` (+ semua test file-nya). **`functions/src/schemas.ts` dihapus seluruhnya** (bukan cuma sebagian export) — begitu 4 handler di atas hilang, tidak ada satu pun kode di `functions/` yang masih import dari file ini (beda kasus dengan `uploadFileSchema` di sub-proyek 1, yang cuma sebagian export mati di file yang masih aktif dipakai schema lain — di sini seluruh file jadi tidak terpakai, jadi aman dihapus utuh sekarang, tidak perlu ditunda ke sub-proyek 5).

`functions/src/index.ts` disederhanakan — cuma menyisakan export untuk `createUser`, `updateUser`, `resetUserPassword`, `generateSubmissionPdf` (yang belum dipindah, jatah sub-proyek 3 & 4).

### 7. Testing

`tests/firestore-rules.test.ts` (sudah ada) diperluas — setiap klausa rules baru dapat test `assertSucceeds`/`assertFails`-nya sendiri, mengikuti pola yang sudah ada di file itu. **Tidak bisa dijalankan di mesin ini** — butuh Firestore Emulator, terhambat ketiadaan Java (batasan yang sama sepanjang sesi ini). Ditulis lengkap mengikuti TDD (ditulis seolah-olah akan dijalankan), diverifikasi lewat pembacaan logic manual + `tsc`/`next build` untuk bagian client.

`lib/counters.ts` — bagian yang murni logic (format nomor romawi bulan, dll., kalau ada yang bisa dipisah jadi fungsi murni) diusahakan tetap testable tanpa emulator, mengikuti pola `lib/monitoring.ts` sebelumnya.

## Di Luar Scope

- Transisi `disetujui → siap_dikirim` (jatah sub-proyek 3).
- Manajemen user (`createUser`/`updateUser`/`resetUserPassword`) — tetap Cloud Function untuk sekarang (jatah sub-proyek 4, karena operasi Admin SDK murni tidak bisa dipindah ke rules/client sama sekali).
- Replikasi validasi field detail (nama item, KM, dll.) ke rules — keputusan eksplisit di poin 1.
