# Jam Pengajuan di List Views — Design Spec

**Tanggal:** 2026-09-04
**Status:** Approved

## Latar Belakang

`submittedAt` sudah ada di setiap dokumen `submissions/{id}` sejak awal (ditulis oleh `submitSubmission.ts`/`submitPersonaliaSubmission.ts`), dan sudah dipakai untuk `orderBy` di tiga halaman list (`/pengajuan`, `/monitoring`, `/persetujuan`) — tapi tidak pernah ditampilkan sebagai kolom yang terlihat di ketiganya. Satu-satunya tempat tanggal+jam pengajuan terlihat sekarang adalah entry pertama di timeline "Riwayat Status" pada halaman detail (`components/submission-timeline/SubmissionTimeline.tsx`), yang berarti user harus buka detail tiap pengajuan satu per satu untuk tahu jam pengajuannya. User melaporkan ini sebagai kekurangan ("saya ingin ada jam pengajuan") setelah memakai aplikasi.

## Keputusan Desain

### 1. Sumber data & format

Field `submittedAt` (Firestore `Timestamp`) di-`.toDate()`-kan lalu diformat persis seperti yang sudah dipakai `SubmissionTimeline.tsx`:
```ts
date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
```
Contoh output: `4 Sep 2026, 09.15`. Konsisten dengan format yang sudah ada di aplikasi, tidak menambah pola format baru.

### 2. Tiga lokasi, tiga bentuk tampilan (mengikuti bentuk komponen yang sudah ada di tiap halaman)

- **`/pengajuan` (Pengajuan Saya)** — tabel. Tambah `<TableHead>Diajukan</TableHead>` di antara "No. Pengajuan" dan "Untuk", sel isi `font-mono text-sm`.
- **`/monitoring`** — tabel (lebih padat, 5 kolom label + 5 kolom durasi). Tambah `<TableHead>Diajukan</TableHead>` setelah "No. Pengajuan", sebelum "Untuk", sel isi `font-mono text-sm` — style sama seperti kolom durasi yang sudah pakai `font-mono`.
- **`/persetujuan` (Antrian Persetujuan)** — kartu, bukan tabel. Tambah baris kecil `text-sm text-muted-foreground` berisi "Diajukan: {format tanggal}" di header kartu, di bawah nomor pengajuan — untuk kartu personalia maupun non-personalia (dua branch render yang terpisah di file yang sama).

### 3. Tidak ada perubahan data/schema/rules

`submittedAt` sudah ada di setiap dokumen sejak `submitSubmission`/`submitPersonaliaSubmission` pertama kali menulisnya — perubahan ini murni menambah field yang sudah di-`onSnapshot`-listen ke tipe row masing-masing halaman (`SubmissionRow`, `MonitoringSubmission`, `QueueRow`) dan merender nilainya. Tidak menyentuh `firestore.rules`, `lib/schemas/*`, atau modul `/lib/submissions/*`.

## Di Luar Scope

- Filter/sort berdasarkan jam (cuma tampil, bukan fitur filter baru).
- Timezone selain lokal browser (`toLocaleString` tanpa `timeZone` eksplisit — konsisten dengan `SubmissionTimeline.tsx` yang sudah begitu).
