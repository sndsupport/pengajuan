# Design: Export Excel & Reset Data (Superadmin)

**Tanggal**: 2026-09-04
**Status**: Disetujui

## Latar Belakang

Superadmin butuh dua hal baru:

1. **Export Excel** — mengunduh seluruh data submission (termasuk items & status history) sebagai file `.xlsx`, untuk laporan dan sebagai backup.
2. **Reset Data** — mengosongkan seluruh data submission (untuk kebutuhan demo/testing di production), dengan pengaman berlapis karena aplikasi ini secara sengaja tidak pernah punya delete (audit trail).

Kedua fitur digabung dalam satu spec karena reset **bergantung** pada export (export wajib dilakukan dulu sebagai backup sebelum reset diizinkan).

## Cakupan

- Export: `submissions` (semua field), `items` (semua subcollection, di-join lewat `submissionNumber`), `statusHistory` (semua subcollection). Attachment/PDF tidak ikut (tetap berupa link Google Drive, tidak relevan di Excel).
- Reset: menghapus seluruh dokumen `submissions` + subcollection `items`/`attachments`/`statusHistory`, dan seluruh dokumen `counters`. **`employees` dan `users` tidak ikut terhapus.**
- Environment: production live (`sndsupportapps`).

## Non-Goals

- Tidak ada penjadwalan otomatis (reset manual, sekali klik per kebutuhan).
- Tidak ada restore/undo — mitigasinya adalah kewajiban export sebelum reset, bukan fitur undo.
- Import balik dari Excel tidak termasuk scope ini.

## Desain

### 1. Export Excel

Modul baru `lib/export/exportSubmissionsExcel.ts`, dipakai library `xlsx` (SheetJS community edition) untuk generate workbook di browser.

Dipisah jadi dua fungsi supaya bagian pengambilan/pembentukan data bisa diuji tanpa browser:

- `buildSubmissionsWorkbookData(submissions, itemsBySubmission, historyBySubmission)` — fungsi murni, mengubah data Firestore (sudah di-`getDocs`) jadi tiga array baris siap-sheet (`SubmissionRow[]`, `ItemRow[]`, `HistoryRow[]`). Testable dengan mock data.
- `exportSubmissionsToExcel()` — fungsi efek-samping: `getDocs(collection(db, "submissions"))`, lalu untuk tiap submission `getDocs` subcollection `items` dan `statusHistory` secara paralel, panggil `buildSubmissionsWorkbookData`, bentuk workbook (`XLSX.utils.book_new()` + `aoa_to_sheet`/`json_to_sheet`), lalu `XLSX.writeFile(wb, filename)` untuk trigger download langsung dari browser.
- Nama file: `pengajuan-export-YYYY-MM-DD-HHmm.xlsx`.

Sheet **Submissions**: submissionNumber, type, subType, status, employeeName, branch, department, position, requesterId, approverName, approverRole, rejectionNote, pdfUrl, periodStart, periodEnd (kosong untuk non-personalia), submittedAt, reviewedAt, approvedAt, sentToGaAt, completedAt (tanggal diformat string lokal, bukan objek Date, supaya konsisten dibuka di Excel).

Sheet **Items**: submissionNumber, itemName, brandType, km, quantity, unit, description.

Sheet **Status History**: submissionNumber, status, note, actorRole, timestamp.

Tombol "Export Excel" ditambahkan di:
- Halaman **Monitoring** (`app/(dashboard)/monitoring/page.tsx`) — bisa diakses semua role yang bisa buka Monitoring.
- Halaman **Data Management** baru (lihat di bawah) — reuse fungsi yang sama, sebagai langkah wajib sebelum reset aktif.

### 2. Reset Data

Halaman baru `app/(dashboard)/admin/data/page.tsx`, hanya untuk `superadmin` (redirect ke `/pengajuan` seperti pola halaman superadmin lain kalau role tidak cocok).

Alur UI:

1. Tampilkan jumlah submission saat ini (via `getCountFromServer`) dan peringatan tegas bahwa aksi ini permanen & tidak bisa dibatalkan.
2. Tombol **"1. Export Excel dulu"** (reuse `exportSubmissionsToExcel`). Baru setelah export ini sukses (resolve tanpa error), state `hasExported` di-set true.
3. Setelah `hasExported` true, muncul input teks: **"Ketik `RESET SEMUA DATA` untuk konfirmasi"**. Tombol final ("2. Reset Sekarang") disabled sampai input cocok persis (case-sensitive, `CONFIRM_PHRASE = "RESET SEMUA DATA"`).
4. Klik "Reset Sekarang" → modul `lib/admin/resetAllSubmissions.ts`.

Modul `resetAllSubmissions(caller: AppUser)`:

- Fail-fast: lempar error kalau `caller.role !== "superadmin"` (baris pertama, sama seperti modul `/lib` lain).
- `getDocs(collection(db, "submissions"))` untuk semua ID submission.
- Untuk tiap submission: `getDocs` subcollection `items`, `attachments`, `statusHistory`, kumpulkan semua `DocumentReference` yang mau dihapus (item, attachment, statusHistory, lalu submission itu sendiri).
- `getDocs(collection(db, "counters"))` untuk semua counter, tambahkan ke daftar hapus.
- Firestore client SDK tidak punya recursive-delete server-side, jadi hapus manual: pecah seluruh `DocumentReference` jadi chunk berukuran ≤500 (limit `writeBatch`), commit tiap chunk berurutan (bukan paralel, supaya progress bisa dilaporkan & tidak membanjiri Firestore).
- Progress callback opsional (`onProgress?: (done: number, total: number) => void`) supaya UI bisa tampilkan "Menghapus X dari Y dokumen...".
- Idempotent by construction: kalau terputus di tengah (network drop), sisa dokumen yang belum kena chunk yang sudah commit tetap ada — reset ulang cukup dijalankan lagi, dia akan query ulang sisa dokumen yang masih ada.
- Setelah selesai, halaman menampilkan pesan sukses dan tabel Monitoring otomatis kosong (realtime listener yang sudah ada).

### 3. Perubahan `firestore.rules`

Menambah exception delete **khusus role `superadmin`**, di luar itu delete tetap `if false` untuk semua orang (prinsip audit-trail tidak berubah untuk role lain):

```
match /submissions/{submissionId} {
  ...
  allow delete: if isSignedIn() && userRole() == 'superadmin';

  match /items/{itemId} {
    ...
    allow delete: if isSignedIn() && userRole() == 'superadmin'
      || (existing owner+status condition);
  }
  match /statusHistory/{historyId} {
    ...
    allow delete: if isSignedIn() && userRole() == 'superadmin';
  }
  match /attachments/{attachmentId} {
    ...
    allow delete: if isSignedIn() && userRole() == 'superadmin'
      || (existing owner+status condition);
  }
}

match /counters/{counterId} {
  ...
  allow delete: if isSignedIn() && userRole() == 'superadmin';
}
```

Ini didokumentasikan di `CLAUDE.md` sebagai pengecualian sadar dari prinsip "tidak pernah ada delete", terbatas ketat ke satu role untuk kebutuhan reset data.

### 4. Navigasi

Tambah item baru di `NAV_ITEMS` (`components/app-shell/nav-config.ts`): `{ href: "/admin/data", label: "Manajemen Data", icon: DatabaseBackup (atau ikon sejenis dari lucide-react), roles: ["superadmin"] }`, dan entry `pageTitleForPath` kalau perlu.

## Error Handling

- Export gagal (network/permission) → tampilkan error inline, `hasExported` tetap false, tombol reset tidak aktif.
- Reset gagal di tengah jalan → tampilkan error inline dengan progress terakhir ("berhasil menghapus X dari Y"), sarankan klik reset lagi (aman, idempotent).
- Modul `resetAllSubmissions` menolak caller bukan superadmin di baris pertama (fail-fast), sama seperti modul lib lain — didobel oleh rules.

## Testing

- `lib/export/exportSubmissionsExcel.test.ts` — unit test untuk `buildSubmissionsWorkbookData` dengan mock data (bukan file asli, cuma bentuk baris-baris sheet), termasuk kasus personalia (periodStart/End terisi, item kosong) vs operasional (items ada).
- `tests/firestore-rules.test.ts` — tambah kasus: superadmin bisa delete submission/items/statusHistory/attachments/counters; role lain (admin/spv/management) tidak bisa.
- Tidak ada test end-to-end untuk `resetAllSubmissions` penuh (butuh emulator + banyak dokumen) — cukup diverifikasi manual di emulator sebelum deploy ke production.
