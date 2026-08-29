# One Gate Request System — Gedung & Fasilitas + Personalia (Lembur/Cuti/Izin) — Design Spec

**Tanggal:** 2026-08-29
**Status:** Approved

## Latar Belakang

Memo internal perusahaan (2026-08-29) menetapkan dua perubahan operasional:

1. Jalur koordinasi yang sebelumnya per-Area dipusatkan ke Kantor Pusat Operational Bandung.
2. Seluruh pengajuan operasional dilakukan lewat **Sistem Pemusatan Pengajuan (One Gate / One Stop Request System)**, mencakup 4 kategori: **pengajuan lembur**, **pengajuan cuti/izin**, **permohonan kendaraan**, dan **permohonan gedung & fasilitas**. Kebutuhan ATK/RTK di luar scope (dikelola manual oleh admin WHO masing-masing).

Aplikasi "Pengajuan Kendaraan & Perlengkapan" yang sudah ada saat ini menangani 2 dari 4 kategori itu (kendaraan, perlengkapan). Spec ini memperluasnya jadi **satu sistem yang sama** untuk keempat kategori — bukan modul terpisah — dengan menambahkan `type` baru: `gedung_fasilitas` dan `personalia` (mencakup lembur/cuti/izin).

Poin #1 (pemusatan jalur koordinasi) **tidak memerlukan perubahan kode** — role `spv`/`management` di aplikasi ini sudah tidak difilter per-cabang/area sejak awal (query antrian persetujuan mengambil semua pengajuan `diajukan` tanpa filter cabang). Pemusatan cukup dipastikan lewat akun mana yang diberi role tersebut (operasional, di luar scope aplikasi).

## Keputusan Desain

### 1. Dua "bentuk" alur di balik satu `type` enum

`submissionTypeSchema` diperluas dari `"kendaraan" | "perlengkapan"` menjadi:

```
"kendaraan" | "perlengkapan" | "gedung_fasilitas" | "personalia"
```

Tapi di balik 4 nilai itu ada **2 bentuk alur berbeda**:

- **Shape Operasional** (`kendaraan`, `perlengkapan`, `gedung_fasilitas`) — alur yang sudah ada persis, tidak berubah: form item + tanda tangan digital pengaju + approval tunggal (spv **atau** management) + auto-generate PDF + copy template WA ke GA + tandai selesai manual oleh pengaju. `gedung_fasilitas` murni `type` baru yang pakai field yang sama seperti `perlengkapan` (tanpa `km`) — tidak perlu kode alur baru, cuma tambah 1 nilai enum + `subTypeByType.gedung_fasilitas` (asumsi awal: `["pengadaan_baru", "perbaikan"]`, silakan dikoreksi kalau sub-jenisnya berbeda).
- **Shape Personalia** (`personalia`, dengan `subType`: `"lembur" | "cuti" | "izin"`) — alur baru, dijelaskan di bagian berikut.

Kedua shape tetap satu collection Firestore (`submissions`), satu dashboard monitoring, satu halaman "Pengajuan Saya" — dibedakan lewat rendering kondisional berdasarkan `type`, bukan route/collection terpisah.

### 2. Data & form Shape Personalia

Tidak pakai `items`/`requesterSignatureUrl` seperti shape operasional — field-nya beda total, jadi pakai schema baru `createPersonaliaSubmissionSchema` (terpisah dari `createSubmissionSchema` yang sudah ada, bukan menambah field opsional ke schema lama):

```
type: "personalia"
subType: "lembur" | "cuti" | "izin"
employeeName: string          // nama karyawan yang mengajukan (bukan nama admin yang submit)
periodStart: string (date)
periodEnd: string (date)
attachment: attachmentSchema  // wajib, 1 file PDF — form lembur/cuti/izin yang sudah diisi & ditandatangani manual
```

Tidak ada tanda tangan digital pengaju (dokumen PDF yang diupload sudah berisi tanda tangan fisik/manual), tidak ada daftar item.

### 3. Alur status Shape Personalia

```
diajukan → perlu_revisi ⟲ (resubmit → diajukan)
diajukan → selesai   (begitu KEDUA approval terkumpul)
```

Tidak ada `disetujui` / `siap_dikirim` / `on_proses_ga` sebagai status yang persisten untuk shape ini — tidak ada barang fisik yang perlu "dikirim ke GA". Bedanya dari shape operasional:

- **Approval butuh DUA-DUANYA**, bukan salah satu: AWS Supervisor (`spv`) **dan** Operational Manager (`management`). Disimpan sebagai dua field terpisah di dokumen submission: `spvApproval: { approverId, approverName, note, decidedAt } | null` dan `managerApproval: { ...sama... } | null`.
- Selama baru salah satu yang approve, `status` tetap `"diajukan"` (belum berubah) — tapi tercatat sebagai entry `statusHistory` tersendiri ("Disetujui oleh AWS Supervisor, menunggu Operational Manager") supaya kelihatan di timeline & dashboard, dan field approval yang sudah terisi dipakai UI untuk menampilkan progress (mis. badge "Menunggu Operational Manager").
- Begitu approver kedua approve → `status` langsung `"diajukan"` → `"selesai"` (skip `disetujui` sebagai status persisten), `completedAt` diisi.
- **Reject dari SIAPA SAJA (spv atau management) langsung menolak** — tidak menunggu approver satunya. Sama seperti alur reject yang sudah ada: `status` → `"perlu_revisi"` + `rejectionNote` wajib.
- Resubmit (lewat form yang sama, `submissionId` diisi) harus me-reset `spvApproval`/`managerApproval` kembali ke `null` — approval lama tidak terbawa ke pengajuan ulang.
- Approver **tidak perlu tanda tangan digital** saat approve shape ini (beda dari shape operasional) — karena aplikasi tidak men-generate PDF baru untuk personalia, approve cukup klik Setuju/Tolak + catatan opsional.
- Setelah `selesai`, ada tombol bantu **"Salin Template WA ke HC"** di halaman detail (pola sama seperti "Salin Template WA" ke GA yang sudah ada) — link ke PDF yang di-upload pengaju (bukan `pdfUrl` hasil generate, karena personalia tidak generate PDF). Ini murni tombol bantu UI, bukan status/transisi yang dilacak di Firestore.

### 4. Role & permission per subType

| Aksi | lembur | cuti / izin |
|---|---|---|
| Boleh mengajukan | `admin_cabang`, `snd` | `admin_cabang`, `snd`, `spv` |
| Tidak boleh mengajukan | `spv`, `management` | `management` |
| Boleh approve (harus dua-duanya) | `spv` **dan** `management` | `spv` **dan** `management` |

Alasan `spv` tidak boleh mengajukan lembur tapi boleh mengajukan cuti/izin: aturan bisnis eksplisit dari user, tidak didasarkan asumsi.

### 5. Firestore Rules

Dua rule transisi baru dibutuhkan untuk `submissions/{id}` khusus `resource.data.type == 'personalia'`:

- **Partial approval** (`diajukan` → `diajukan`): caller role `spv` atau `management`, hanya boleh mengubah field approval miliknya sendiri (`hasOnly(['spvApproval'])` untuk spv, `hasOnly(['managerApproval'])` untuk management) + entry `statusHistory` baru.
- **Final approval** (`diajukan` → `selesai`): hanya valid kalau setelah write ini kedua field approval (`spvApproval`, `managerApproval`) sudah terisi.

Rule `create` untuk `submissions` juga perlu tambahan validasi role-per-subType sesuai tabel di atas (saat ini rule `create` cuma cek `role in ['admin_cabang','snd']` — perlu ditambah cabang logic untuk `type == 'personalia'`).

Rule reject (`diajukan` → `perlu_revisi`) yang sudah ada generic (tidak spesifik `type`), kemungkinan besar reusable apa adanya — perlu dicek ulang saat implementasi supaya tidak ada asumsi field yang tidak berlaku untuk personalia.

### 6. Modul baru, bukan modifikasi modul lama

Konsisten dengan pola isolasi yang sudah dipakai di codebase ini — logic Shape Personalia jadi file-file baru, bukan menambah percabangan `if (type === ...)` ke file yang sudah ada:

- `lib/schemas/submission.ts` — tambah `createPersonaliaSubmissionSchema`, extend `submissionTypeSchema` & `subTypeByType`.
- `lib/submissions/submitPersonaliaSubmission.ts` — baru (paralel ke `submitSubmission.ts`), reuse mekanisme `counters` yang sama untuk nomor pengajuan otomatis (asumsi: satu seri nomor untuk semua type, tidak dibedakan — silakan dikoreksi kalau perlu seri terpisah per kategori).
- `lib/submissions/reviewPersonaliaSubmission.ts` — baru (paralel ke `reviewSubmission.ts`), implementasi logic dual-approval di atas.
- `lib/wa-template.ts` — tambah `buildPersonaliaWaTemplate(...)` (target HC, bukan GA).

`lib/submissions/submitSubmission.ts`, `reviewSubmission.ts`, `confirmSentToGa.ts`, `markAsDone.ts`, dan seluruh flow shape Operasional **tidak disentuh** — hanya dapat 1 `type` value baru (`gedung_fasilitas`) yang otomatis jalan lewat kode yang sudah ada.

### 7. UI

- **`/pengajuan/new`**: "Jenis Pengajuan" jadi 4 pilihan. Pilih Kendaraan/Perlengkapan/Gedung & Fasilitas → render form item yang sudah ada (tidak berubah, `gedung_fasilitas` otomatis lewat `subTypeByType` & tanpa field `km`). Pilih Personalia → render form baru sesuai poin 2 (nama karyawan, jenis lembur/cuti/izin, periode, upload PDF) — dua form ini di-switch kondisional dalam satu page component yang sama, bukan route terpisah.
- **`/pengajuan/detail`**: kondisional berdasarkan `type`. Personalia: tampilkan nama karyawan, periode, link dokumen yang diupload, progress approval ("Menunggu approval: Operational Manager" dari `spvApproval`/`managerApproval`), tombol "Salin Template WA ke HC" saat `selesai`. Tidak menampilkan blok generate-PDF/kirim-GA yang cuma relevan untuk shape Operasional.
- **`/persetujuan`**: baris personalia tampil dengan UI review yang lebih sederhana — link ke PDF yang diupload, tombol Setuju/Tolak + catatan, **tanpa** signature pad (beda dari baris operasional yang mewajibkan tanda tangan approver).
- **Monitoring**: kolom Jenis menampilkan 4 nilai. Kolom durasi tahap (`Disetujui→Kirim`, `Kirim→GA`, `GA→Selesai`) tidak relevan untuk personalia — tampilkan "—" untuk kolom yang stage-nya tidak ada di riwayat status baris tersebut (perlu dicek `lib/monitoring.ts` menangani riwayat yang skip beberapa stage dengan aman, bukan error/NaN).
- Label role **"Management" diganti jadi "Operational Manager"** di seluruh UI (nav, badge role, dsb) — value role di database/Firestore Auth **tetap** `"management"`, cuma label tampilan yang berubah (lihat `ROLE_LABEL` di `components/app-shell/nav-config.ts`).

## Di Luar Scope

- Perubahan apa pun ke jalur koordinasi/organisasi di luar aplikasi (poin #1 memo) — tidak ada kode yang berubah untuk ini.
- Pengelolaan ATK/RTK (poin #3 memo) — eksplisit di luar scope one-gate system per memo.
- Sub-jenis pasti untuk `gedung_fasilitas` — dipakai asumsi awal (`pengadaan_baru`, `perbaikan`), bisa dikoreksi tanpa mengubah desain ini.
- Notifikasi otomatis (email/WA) ke approver saat ada pengajuan baru/approval pertama masuk — tetap manual seperti alur yang sudah ada (approver cek dashboard sendiri).
- Menyamakan seri nomor pengajuan per kategori — asumsi satu seri nomor untuk semua `type` (lihat poin 6), bisa diubah kalau ternyata perlu prefix/seri berbeda.
