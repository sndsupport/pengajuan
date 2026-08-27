# Tandai Selesai + Dashboard Monitoring — Design Spec

**Tanggal:** 2026-08-28
**Status:** Approved

## Latar Belakang

Sub-proyek kelima dan keenam (terakhir) dari rencana pengerjaan checklist MVP, dikerjakan sekaligus atas permintaan user karena saling melengkapi: `markAsDone` menutup alur status (`on_proses_ga` → `selesai`), dan Dashboard Monitoring memvisualisasikan seluruh alur status termasuk durasi tiap tahap dari `statusHistory`.

Urutan sub-proyek checklist MVP:
1. Login Username — selesai
2. Manajemen User (superadmin) — selesai
3. `generateSubmissionPdf` — selesai
4. Copy Template WA + `confirmSentToGa` — selesai
5. **Tombol Tandai Selesai + `markAsDone`** — spec ini
6. **Dashboard Monitoring** — spec ini

## Bagian 1: `markAsDone`

### Keputusan Desain

**Tanpa dialog konfirmasi.** Klik langsung memanggil Cloud Function, konsisten dengan tombol lain di halaman detail pengajuan (Setujui, Tolak, Konfirmasi Kirim GA) yang juga tidak pakai dialog konfirmasi — tombol hanya muncul pada satu status spesifik sehingga risiko klik tidak sengaja rendah.

**Cloud Function `markAsDone`** — pola identik dengan `confirmSentToGa` yang sudah ada:
- Callable, owner-only (`requesterId === auth.uid`, bukan role tertentu — siapa pun pemilik submission boleh menandai selesai miliknya sendiri).
- Fail-fast: `context.auth` kosong → `unauthenticated`.
- Ambil dokumen submission. Tidak ada / `requesterId !== auth.uid` → `permission-denied`.
- `status !== "on_proses_ga"` → `failed-precondition`.
- Update: `status: "selesai"`, `completedAt: FieldValue.serverTimestamp()`.
- Tulis entry `statusHistory` baru: `status: "selesai"`, `note: null`, `actorId: auth.uid`, `actorRole: caller.role` (identitas asli, bukan sentinel `"system"` — aksi manual pengaju).

**Schema** `markAsDoneSchema` — bentuk identik `confirmSentToGaSchema` (`{ submissionId: z.string().min(1) }`), diduplikasi ke `lib/schemas/submission.ts` dan `functions/src/schemas.ts` sesuai pola yang sudah berjalan.

**UI**: tombol "Tandai Selesai" di halaman detail pengajuan (`app/(dashboard)/pengajuan/[id]/page.tsx`), blok baru muncul kalau `submission.status === "on_proses_ga"` — pola sama seperti blok `siap_dikirim` yang sudah ada (busy state, error state, hilang otomatis lewat `onSnapshot` yang sudah ada setelah status berubah).

## Bagian 2: Dashboard Monitoring

### Keputusan Desain

**Akses**: semua role bisa membuka `/monitoring` — tidak ada guard redirect berbasis role (beda dengan `/persetujuan` atau `/admin`), cukup harus login (dijaga `(dashboard)/layout.tsx` yang sudah ada).

**Scope data mengikuti `firestore.rules` yang sudah ada, tidak diubah**:
- `admin_cabang`/`snd`: query `where("requesterId", "==", appUser.uid)` — sama persis dengan pola yang sudah dipakai di halaman "Pengajuan Saya" (`app/(dashboard)/pengajuan/page.tsx`), memakai composite index yang sudah ada di `firestore.indexes.json` (`requesterId ASC, submittedAt DESC`).
- `spv`/`management`/`superadmin`: query tanpa filter, `orderBy("submittedAt", "desc")` saja — single-field order, tidak butuh composite index baru.

Tidak ada perubahan pada `firestore.rules` maupun `firestore.indexes.json`.

**Tidak ada kontrol filter** (status/jenis/cabang) di MVP ini — tampilkan semua yang bisa diakses user sesuai rules di atas.

**Kolom tabel** (satu baris per pengajuan, urut `submittedAt` terbaru dulu): No. Pengajuan (link ke `/pengajuan/{id}`, pola sama seperti di halaman "Pengajuan Saya"), Pengaju, Cabang, Jenis, Status, lalu kolom durasi terpisah untuk tiap tahap:
- Diajukan → Disetujui
- Disetujui → Siap Dikirim
- Siap Dikirim → On Proses GA
- On Proses GA → Selesai
- Total (dari `submittedAt` sampai `selesai`, atau sampai sekarang kalau masih berjalan)

**Perhitungan durasi** — fungsi murni `computeStageDurations(entries, now)` di `lib/monitoring.ts` (tidak menyentuh Firebase, bisa di-unit-test penuh):
- Tiap kolom dihitung dari selisih timestamp entry `statusHistory` yang relevan.
- "Diajukan → Disetujui" dihitung dari entry `statusHistory` paling awal (bukan entry `diajukan` terakhir) sampai entry `disetujui` pertama — kalau ada siklus revisi (`perlu_revisi` → `diajukan` lagi), durasi ini **mencakup** waktu revisi tersebut, bukan cuma waktu review bersih tanpa revisi. Ini keputusan sengaja: metrik yang berguna untuk monitoring adalah "berapa lama total sampai disetujui", bukan analitik per-siklus yang lebih rumit.
- Tahap yang belum tercapai (entry `statusHistory`-nya belum ada) tampil `"-"`.
- Tahap yang sedang berjalan (termasuk kolom Total untuk submission yang belum `selesai`) dihitung sampai waktu render saat ini (`now`) — bukan timer yang detak per detik, cukup ter-update ulang tiap kali data Firestore berubah lewat `onSnapshot` (konsisten dengan pendekatan realtime CLAUDE.md, tanpa infra tambahan).
- Fungsi format `formatDuration(ms)` companion, mengubah milidetik jadi string ringkas Indonesia (mis. "2h 3j", "45m").

**Nama pengaju**: dokumen submission tidak menyimpan nama pengaju (cuma `requesterId`), jadi tiap baris melakukan satu kali `getDoc(users/{requesterId})` (bukan realtime — nama jarang berubah). Untuk `admin_cabang`/`snd`, ini selalu baca dokumen mereka sendiri (diizinkan `firestore.rules`); untuk reviewer, bisa baca semua user (juga sudah diizinkan). Tidak perlu perubahan rules.

**Struktur komponen**:
- `app/(dashboard)/monitoring/page.tsx` — query submissions sesuai role (tanpa guard akses berbasis role), render tabel.
- `components/monitoring-row/MonitoringRow.tsx` — satu komponen per baris tabel, punya `onSnapshot` sendiri ke subcollection `statusHistory` submission tersebut + fetch nama pengaju sekali via `getDoc`. Dipisah jadi komponen sendiri (bukan inline `.map()` di parent) supaya tiap baris independen — pelajaran dari bug `SignaturePad` sebelumnya di mana logic yang seharusnya stabil per-item ikut kena re-render dari parent yang tidak terkait.

**Nav**: link "Monitoring" ditambahkan di `(dashboard)/layout.tsx`, tanpa gate role — pola sama seperti link "Pengajuan Saya" yang juga tidak digate meski tidak semua role relevan memakainya secara aktif.

## Testing

`lib/monitoring.ts` (fungsi murni) ditulis dan **dijalankan/diverifikasi** penuh di mesin ini — tidak ada dependency Firebase.

`markAsDone` Cloud Function ditest mengikuti pola yang sama seperti `confirmSentToGa` — ditulis lengkap, tapi butuh emulator Firestore untuk dijalankan (batasan Java yang sudah ada), hanya diverifikasi lewat `npm --prefix functions run build`.

`app/(dashboard)/monitoring/page.tsx` dan `MonitoringRow.tsx` diverifikasi lewat `npm run build` (type-check) — tidak ada test otomatis untuk komponen UI Firebase-realtime ini, konsisten dengan halaman-halaman lain di app ini (`/pengajuan`, `/persetujuan`, `/admin`, dll., semuanya tidak punya test file tersendiri).

## Di Luar Scope

- Dialog konfirmasi sebelum "Tandai Selesai".
- Kontrol filter (status/jenis/cabang) di Dashboard Monitoring.
- Timer yang detak live per detik untuk durasi yang sedang berjalan.
- Breakdown durasi per-siklus revisi (hanya total waktu sampai disetujui, bukan per-siklus).
- Perubahan `firestore.rules`/`firestore.indexes.json` — keduanya sudah cukup untuk kebutuhan ini.
