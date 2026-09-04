# Dashboard Monitoring ala ERP — Design Spec

**Tanggal:** 2026-09-04
**Status:** Approved

## Latar Belakang

`/monitoring` saat ini cuma satu tabel mentah (`No. Pengajuan`, `Diajukan`, `Untuk`, `Cabang`, `Jenis`, `Status`, 5 kolom durasi per tahap) — tidak ada ringkasan, tren, atau breakdown apa pun. User minta dashboard "layaknya ERP sungguhan", tapi scope-nya sengaja dibatasi ke data pengajuan saja (tidak ada modul ERP lain di aplikasi ini).

Halaman `/monitoring` **diperluas, bukan diganti** — user secara eksplisit ingin tabel detail yang sudah ada tetap ada (setelah sempat ditanya, karena tanpa itu tidak ada cara browse semua pengajuan satu per satu dari halaman ini).

## Keputusan Desain

### 1. Layout: dashboard di atas, tabel existing tetap di bawah

Satu halaman (`/monitoring`), urutan dari atas:
1. KPI cards (4 kartu)
2. Grafik tren harian
3. Breakdown status & jenis (2 chart donut berdampingan)
4. Breakdown per cabang (bar chart)
5. Aktivitas Terbaru (feed 15 entri)
6. Tabel detail (sudah ada, tidak berubah — `MonitoringRow`/kolom-kolom yang sudah ada)

### 2. Periode default: bulan berjalan

KPI cards, grafik tren, dan kedua breakdown chart di-scope ke bulan kalender berjalan (`submittedAt` dalam bulan ini), KECUALI kartu "Sedang Diproses" yang menghitung status aktif saat ini tanpa batas periode (status "sedang diproses" bukan konsep per-periode). Tidak ada filter interaktif di v1 ini (YAGNI — bisa ditambah nanti kalau dibutuhkan).

### 3. KPI Cards (4 kartu)

Dihitung client-side dari data `submissions` yang sudah di-listen (`onSnapshot`, sudah ada), difilter `submittedAt` dalam bulan berjalan (kecuali kartu ke-2):
1. **Total Pengajuan Bulan Ini** — count semua submission dengan `submittedAt` bulan ini.
2. **Sedang Diproses** — count semua submission dengan `status` in `['diajukan','perlu_revisi','disetujui','siap_dikirim','on_proses_ga']` (semua status aktif kategori non-personalia + personalia yang masih `diajukan`), tanpa filter bulan.
3. **Selesai Bulan Ini** — count `status == 'selesai'` dengan `submittedAt` bulan ini.
4. **Rata-rata Durasi Penyelesaian** — rata-rata `computeStageDurations(...).total` (fungsi yang sudah ada di `lib/monitoring.ts`) dari submission yang `status == 'selesai'` dan `submittedAt` bulan ini. Kalau belum ada yang selesai bulan ini, tampilkan "-".

### 4. Grafik Tren — bar chart harian

Sumbu X: tanggal 1 s/d akhir bulan berjalan. Sumbu Y: jumlah pengajuan yang `submittedAt`-nya jatuh di tanggal itu. Dihitung client-side dari data yang sama (group-by tanggal lokal).

### 5. Breakdown Status & Jenis — 2 donut chart

- **Per status**: proporsi submission bulan ini per `status` (6 kemungkinan: diajukan/perlu_revisi/disetujui/siap_dikirim/on_proses_ga/selesai), pakai warna token status yang SUDAH ada di `components/status-badge/StatusBadge.tsx` (`STATUS_STYLES` per CLAUDE.md, konsisten dengan badge di tempat lain).
- **Per jenis**: proporsi submission bulan ini per `type` (`kendaraan`/`perlengkapan`/`gedung_fasilitas`/`personalia`), label pakai `TYPE_LABEL` yang sudah ada (`lib/schemas/submission.ts`).

### 6. Breakdown Cabang — bar chart

Jumlah submission bulan ini per `branch` (WHO/WHP/SND), bar chart horizontal atau vertical (pilih yang lebih pas untuk 3 kategori — vertical bar cukup untuk 3 item).

### 7. Aktivitas Terbaru — feed 15 entri, lintas semua perubahan status

**Ini bagian dengan perubahan kode paling luas.** Setiap titik yang menulis entry `submissions/{id}/statusHistory/{historyId}` ditambah dua field baru ke payload write-nya: `submissionNumber: string` dan `employeeName: string` (kedua field itu sudah tersedia di scope pemanggil di semua 9 titik ini — tidak perlu query tambahan untuk mendapatkannya). Sembilan titik, 6 file:

- `lib/submissions/submitSubmission.ts` — 2 titik (create awal status `diajukan`, resubmit setelah revisi)
- `lib/submissions/submitPersonaliaSubmission.ts` — 2 titik (sama, untuk personalia)
- `lib/submissions/reviewSubmission.ts` — 1 titik (approve/reject)
- `lib/submissions/reviewPersonaliaSubmission.ts` — 1 titik (partial/final approval, reject)
- `lib/submissions/confirmSentToGa.ts` — 1 titik
- `lib/submissions/markAsDone.ts` — 1 titik

`firestore.rules` untuk create `statusHistory` **tidak perlu diubah** — rule saat ini tidak punya `hasOnly()` yang membatasi field, jadi field baru otomatis boleh ditulis begitu client-nya mengirim.

**Baca feed:** `collectionGroup("statusHistory")` + `orderBy("timestamp","desc")` + `limit(15)`, realtime (`onSnapshot`). Butuh 1 **composite index baru** untuk collection group `statusHistory` di `firestore.indexes.json` (Firestore mewajibkan index eksplisit untuk collection-group query yang di-`orderBy`). Rule baca `statusHistory` sudah `isSignedIn()` (dari fitur "Visibilitas Semua User" sebelumnya) — otomatis berlaku untuk collection-group query juga, tidak perlu rule tambahan.

**Rendering:** tiap entri tampil sebagai satu baris "`{submissionNumber}` — {label status} oleh {actorRole label} — {relative time}". Entry riwayat LAMA (ditulis sebelum perubahan ini) tidak punya `submissionNumber`/`employeeName` — tampilkan fallback teks netral ("Pengajuan" tanpa nomor) untuk entry lama; ini transisional, hilang sendirinya begitu data baru menumpuk melewati 15 entri terakhir.

### 8. Chart library: Recharts, dipakai langsung (bukan lewat wrapper shadcn)

Belum ada charting library di project. Tambah `recharts` sebagai dependency. **Implementasi aktual** (dikoreksi dari draft awal spec ini yang menyebut wrapper `components/ui/chart.tsx` ala shadcn): tiap komponen chart (`TrendChart.tsx`, `BranchChart.tsx`, `BreakdownDonut.tsx`) memanggil primitif Recharts langsung — wrapper generik shadcn dilewati karena cuma ada 3 komponen chart, over-engineering untuk scope sekecil ini. Warna chrome yang dipakai bersama (`GRIDLINE_COLOR`, `AXIS_COLOR`, hue sequential) disentralkan di `components/dashboard/chart-colors.ts` supaya tidak duplikat antar file. Desain warna & aksesibilitas chart mengikuti panduan skill `dataviz` (dibaca ulang sebelum menulis kode chart pertama).

## Testing

Tidak ada logic baru yang butuh Firestore emulator KECUALI query index untuk collection-group (index deployment, bukan test) — perhitungan KPI/breakdown/tren murni client-side dari data yang sudah di-listen, jadi bisa ditulis sebagai pure function yang dites dengan Vitest biasa (genuinely runs, tidak butuh emulator) — pola yang sama seperti `computeStageDurations` di `lib/monitoring.ts` yang sudah ada.

## Di Luar Scope

- Filter interaktif (rentang tanggal custom, pilih cabang/jenis tertentu) — v1 cuma bulan berjalan, hardcoded.
- Drill-down dari chart ke tabel (klik bagian chart untuk filter tabel di bawahnya).
- Modul ERP lain (keuangan, inventori, dll) — cuma pengajuan, sesuai permintaan eksplisit user ("hanya mencakup pengajuan untuk sementara ini").
- Backfill `submissionNumber`/`employeeName` ke entry `statusHistory` LAMA yang sudah ada — dibiarkan tampil fallback di feed, tidak di-migrate.
