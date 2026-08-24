# Fase 2: Penyelesaian Alur Status — Design Spec

**Status:** Approved, ready for implementation planning.

## Latar Belakang

Fase 1 (fondasi + alur inti) dan fitur lampiran/tanda tangan via Google Drive sudah selesai dan berjalan. Tiga Cloud Function terakhir di checklist MVP (`generateSubmissionPdf`, `confirmSentToGa`, `markAsDone`) belum pernah dibangun, sehingga alur status berhenti total begitu sebuah pengajuan di-approve — tidak pernah sampai ke `siap_dikirim`, `on_proses_ga`, atau `selesai`.

Referensi layout PDF: formulir fisik GA yang sudah berjalan (`FORM SERVICE D 8706 FN.pdf`, dikirim user 2026-08-24) — "FORMULIR PERMOHONAN DIVISI GENERAL AFFAIR", berisi info pemohon, tabel barang, dan blok tanda tangan "Dibuat Oleh"/"Mengetahui". Semua jenis pengajuan (kendaraan & perlengkapan) memakai format form yang sama; field-field pada model data yang sudah ada dipetakan ke form ini.

## Cakupan

1. Perbaikan format `submissionNumber` di `counters.ts` supaya sesuai format form asli.
2. Perluasan `reviewSubmission` + halaman Antrian Persetujuan: approver menggambar/upload tanda tangan sendiri saat approve (`approverSignatureUrl` sebelumnya ada di data model tapi belum pernah diisi).
3. Cloud Function baru `generateSubmissionPdf` (Firestore trigger) — render HTML meniru formulir GA via Puppeteer, upload ke Google Drive, transisi status `disetujui → siap_dikirim`.
4. Cloud Function baru `confirmSentToGa` (callable) + tombol "Copy Template WA" di client — transisi `siap_dikirim → on_proses_ga`.
5. Cloud Function baru `markAsDone` (callable) — transisi `on_proses_ga → selesai`.

**Di luar cakupan:** Dashboard Monitoring, halaman Manajemen User (superadmin), App Hosting/deploy config untuk frontend Next.js — ini item checklist terpisah.

## A. Perbaikan Format Nomor Pengajuan

`functions/src/counters.ts` fungsi `getNextSubmissionNumber` diubah formatnya jadi:

```
L.{urut 3 digit}/TSI-OPR/{branch}/{bulan romawi}/{tahun}
```

Contoh: `L.002/TSI-OPR/WHO/VIII/2026`.

- `TSI-OPR` adalah konstanta tetap (tidak bergantung departemen pemohon) — keputusan diambil karena Firestore document ID `counters/{branch}-{year}-{month}` (per data model CLAUDE.md) juga tidak membedakan per departemen, jadi menjadikan bagian ini dinamis tidak konsisten dengan skema counter yang sudah ada.
- `{branch}` memakai nilai `submission.branch` apa adanya (`WHO`/`WHP`/`SND`), tidak di-mapping ke nama lokasi (mis. "Tangerang").
- Key transaksi counter (`counters/{branch}-{year}-{month}`, `lastNumber`) **tidak berubah** — hanya representasi string outputnya.
- Test yang sudah ada untuk fungsi ini (`counters.test.ts`) perlu di-update mengikuti format baru.

## B. Tanda Tangan Approver

Field `approverSignatureUrl` sudah ada di data model `submissions/{id}` sejak awal tapi belum pernah diisi kode manapun — approver di form asli juga tanda tangan di blok "Mengetahui", jadi ini gap yang perlu ditutup sebelum `generateSubmissionPdf` bisa lengkap.

**Schema** (`lib/schemas/submission.ts` dan `functions/src/schemas.ts`, dua-duanya — proyek ini sudah menduplikasi schema client/function sejak Fase 1, bukan hal baru dari perubahan ini):

```ts
export const reviewSubmissionSchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    rejectionNote: z.string().nullish(),
    approverSignatureUrl: z.string().url().nullish(),
  })
  .refine((data) => data.decision !== "reject" || !!data.rejectionNote?.trim(), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  })
  .refine((data) => data.decision !== "approve" || !!data.approverSignatureUrl, {
    message: "Tanda tangan approver wajib diisi saat approve",
    path: ["approverSignatureUrl"],
  });
```

**UI** (`app/(dashboard)/persetujuan/page.tsx`): setiap baris antrian dapat toggle "Gambar"/"Upload File" + `SignaturePad`/`FileUpload` (pola identik dengan form Buat Pengajuan), state tanda tangan disimpan per `submissionId` (mis. `signatureBySubmission: Record<string, string>`). Tombol "Setujui" disabled kalau tanda tangan kosong. `FileUpload` dan `SignaturePad` dipakai apa adanya, tanpa modifikasi.

**Handler** (`functions/src/reviewSubmission.ts`): saat `decision === "approve"`, tambahkan `approverSignatureUrl: input.approverSignatureUrl` ke `batch.update(submissionRef, ...)`.

## C. `generateSubmissionPdf` (Firestore trigger, baru)

**File baru:** `functions/src/generateSubmissionPdf.ts`, diekspor dari `index.ts` sebagai `onDocumentUpdated`.

**Trigger:** `onDocumentUpdated("submissions/{submissionId}")`. Guard di awal handler: hanya lanjut kalau `before.status !== "disetujui" && after.status === "disetujui"` — supaya tidak infinite-loop (function ini sendiri mengubah status ke `siap_dikirim`, bukan `disetujui`, jadi write itu tidak akan mentrigger ulang function ini, tapi guard tetap dipasang sebagai pertahanan eksplisit terhadap kemungkinan future-proofing status lain yang juga bisa masuk `disetujui`).

**Resource config:** `{ memory: "1GiB", timeoutSeconds: 60, retry: true, serviceAccount: "drive-uploader-dev@sndsupportapps.iam.gserviceaccount.com" }`. `retry: true` supaya kegagalan sementara (mis. Puppeteer cold-start, Drive API blip) otomatis diulang oleh Cloud Functions sampai batas waktu event retry Google (idempotency: re-run yang sukses akan overwrite `pdfUrl`/status dengan hasil yang sama, aman untuk retry).

**Alur:**

1. Ambil `submissions/{id}` (data setelah update) + subcollection `items` (`orderBy` insertion/tidak perlu urutan khusus, urutan Firestore default cukup).
2. Ambil `users/{submission.requesterId}` dan `users/{submission.approverId}` — perlu `name`, `department`, `position` masing-masing.
3. Bangun HTML string dari template (lihat struktur bawah), isi data ter-escape (hindari HTML injection dari field bebas seperti `itemName`/`description`).
4. Render ke PDF: `puppeteer-core` + `@sparticuz/chromium` (page.setContent + page.pdf, format A4).
5. Upload PDF via `uploadToDrive` (fungsi yang sudah ada di `googleDrive.ts`, folder sama dengan lampiran — `DRIVE_FOLDER_ID`), nama file `Formulir - {submissionNumber}.pdf`.
6. `batch.update(submissionRef, { pdfUrl: webViewLink, status: "siap_dikirim" })` + `batch.set(historyRef, { status: "siap_dikirim", note: "PDF digenerate otomatis", actorId: "system", actorRole: "system", timestamp: FieldValue.serverTimestamp() })`.

**Template HTML — struktur & mapping field:**

Header:
- Kiri: nama perusahaan singkat "PT TRIDAYA SINERGI INDONESIA" (konstanta), blok "Kepada Yth, Departemen General Affair, PT TRIDAYA SINERGI INDONESIA" (konstanta, sama seperti form asli).
- Kanan: judul "FORMULIR PERMOHONAN" / "DIVISI GENERAL AFFAIR" (konstanta) + kotak "Nomor Permintaan" (`submission.submissionNumber`) dan "Tanggal" (`submission.submittedAt`, format panjang Indonesia: "21 Agustus 2026" — pakai `Intl.DateTimeFormat("id-ID", { dateStyle: "long" })`).

Info pemohon (tabel 2 kolom):

| Label | Sumber |
| --- | --- |
| Nama Pemohon | `requester.name` |
| Departemen | `requester.department` |
| Warehouse | `submission.branch` |
| Jabatan | `requester.position` |
| Jenis Permohonan | `submission.type` → label `"Kendaraan"` / `"Perlengkapan"` |

Tabel barang — kolom: Nama Barang, Merk/Type, KM, Jumlah, Satuan, Deskripsi.
- Satu baris per dokumen di `items` (`itemName`, `brandType`, `km ?? "-"`, `quantity`, `unit`, `description`).
- Dipad dengan baris kosong sampai total **14 baris** (meniru jumlah baris form asli). Kalau jumlah item aktual > 14, tidak ada padding tambahan dan tabel tumbuh sesuai jumlah item (tidak dipotong).

Footer tanda tangan (2 kolom):

| | Kiri ("Dibuat Oleh,") | Kanan ("Mengetahui,") |
| --- | --- | --- |
| Gambar TTD | `<img src="{submission.requesterSignatureUrl}">` | `<img src="{submission.approverSignatureUrl}">` |
| Nama | `requester.name` | `approver.name` |
| Label | `"Pemohon"` (konstanta) | `approver.position` (bukan label role generik "AWS Supervisor"/"Management") |

Catatan implementasi: `requesterSignatureUrl`/`approverSignatureUrl` bisa berupa data URI (`data:image/png;base64,...`, hasil gambar tangan) atau URL Drive (`https://drive.google.com/uc?export=view&id=...`, hasil upload file) — keduanya valid langsung dipakai sebagai `<img src>`, Puppeteer/Chromium meresolusinya sama seperti browser biasa (data URI inline, URL via network fetch). Tidak perlu logika khusus untuk membedakan kedua kasus ini.

## D. `confirmSentToGa` (callable, baru)

**File baru:** `functions/src/confirmSentToGa.ts`, pola sama persis dengan `reviewSubmission.ts`/`markAsDone.ts` (auth check → role/ownership check → precondition status → Zod parse input → batch update + statusHistory).

- Input: `{ submissionId: string }` — tidak perlu isi template WA (dibuat di client, lihat bawah).
- Auth: `context.auth` wajib ada, **dan** `submission.requesterId === context.auth.uid` (bukan cek role, cek kepemilikan — pola sama dengan `markAsDone`).
- Precondition: `submission.status === "siap_dikirim"`, kalau tidak → `HttpsError("failed-precondition", ...)`.
- Update: `status: "on_proses_ga"`, `sentToGaAt: FieldValue.serverTimestamp()` + `statusHistory` entry (`actorId: context.auth.uid`, `actorRole` dari `users/{uid}.role`).

**Client — tombol "Copy Template WA"** (halaman detail pengajuan, `app/(dashboard)/pengajuan/[id]/page.tsx` atau lokasi setara): tombol ini murni client-side, generate teks dari data submission yang sudah di-load, lalu `navigator.clipboard.writeText(...)`. Template:

```
Yth. Tim GA, mohon diproses pengajuan {submissionNumber} a.n. {namaPemohon} ({departemen}). Detail & tanda tangan terlampir di PDF: {pdfUrl}. Terima kasih.
```

Ditampilkan hanya saat `status === "siap_dikirim"`. Tombol terpisah "Konfirmasi Sudah Dikirim" memanggil `confirmSentToGa` (idealnya baru bisa diklik setelah tombol copy pernah diklik minimal sekali dalam sesi itu — validasi ringan di client saja, bukan hal yang perlu ditegakkan server karena tidak ada risiko keamanan/data kalau dilewati).

## E. `markAsDone` (callable, baru)

**File baru:** `functions/src/markAsDone.ts`, pola identik `confirmSentToGa.ts`.

- Input: `{ submissionId: string }`.
- Auth: `context.auth` wajib ada, **dan** `submission.requesterId === context.auth.uid`. **Tidak ada aktor lain yang boleh**, termasuk `superadmin` — ditegaskan eksplisit di sini karena ini aturan CLAUDE.md yang gampang salah diimplementasi (godaan untuk menambah `superadmin` ke daftar role yang boleh, harus dihindari).
- Precondition: `submission.status === "on_proses_ga"`.
- Update: `status: "selesai"`, `completedAt: FieldValue.serverTimestamp()` + `statusHistory` entry.

## Testing

Mengikuti pola test yang sudah ada (`reviewSubmission.test.ts`, `submitSubmission.test.ts` — Vitest, emulator Firestore):

- `counters.test.ts`: update assertion ke format baru.
- `reviewSubmission.test.ts`: tambah kasus approve tanpa `approverSignatureUrl` → error; approve dengan `approverSignatureUrl` → tersimpan.
- `generateSubmissionPdf.test.ts` (baru): trigger jalan saat status jadi `disetujui`, tidak jalan saat transisi status lain; PDF ter-upload & `pdfUrl`/`status` ter-update; guard idempotency (tidak infinite loop).
- `confirmSentToGa.test.ts` (baru): reject kalau bukan requester; reject kalau status bukan `siap_dikirim`; sukses kalau requester + status sesuai.
- `markAsDone.test.ts` (baru): sama pola, termasuk kasus eksplisit "superadmin ditolak" untuk menegaskan aturan di atas.
