# Fase 1: Fondasi + Alur Inti — Design Spec

Tanggal: 2026-08-21
Sumber: `CLAUDE.md` (project brief)

## Latar Belakang

`CLAUDE.md` di root repo berisi brief lengkap untuk Aplikasi Pengajuan Kendaraan & Perlengkapan (PT Tridaya Sinergi Indonesia), dengan stack Next.js 14 + Firebase. Brief tersebut mencakup banyak subsistem (auth & roles, alur pengajuan, approval, generate PDF, integrasi WA, dashboard monitoring, admin panel, integrasi ERP) — terlalu besar untuk satu implementation plan. Dokumen ini men-scope **Fase 1: Fondasi + Alur Inti**, subset pertama yang bisa diimplementasikan dan diverifikasi secara independen.

## Lingkup Fase 1

**Termasuk:**
- Setup project Next.js 14 (App Router, TypeScript, Tailwind, shadcn/ui) + Firebase (Auth, Firestore, Functions) + Emulator Suite untuk dev lokal.
- Login (Firebase Auth email/password). User dibuat manual (lewat emulator seed script / Firebase Console) — **integrasi ERP tidak termasuk Fase 1**, jadi fase terpisah nanti.
- Role-based access ke halaman `(dashboard)/*` berdasarkan `users/{uid}.role`.
- Form Buat Pengajuan (kendaraan/perlengkapan) dengan item-item, signature pad pengaju.
- Cloud Function `submitSubmission`: generate nomor otomatis, set status `diajukan`, tulis entry `statusHistory`.
- Halaman Antrian Persetujuan (role `spv`/`management`).
- Cloud Function `reviewSubmission`: approve → `disetujui`; reject → `perlu_revisi` + `rejectionNote` wajib.
- Loop revisi: pengaju edit pengajuan berstatus `perlu_revisi` dan submit ulang → kembali ke `diajukan`.

**Tidak termasuk (fase berikutnya):**
- Generate PDF (`generateSubmissionPdf`), template WA (`confirmSentToGa`), tombol Tandai Selesai (`markAsDone`).
- Dashboard Monitoring realtime.
- Halaman Manajemen User (superadmin).
- Integrasi akun ERP (endpoint API atau sync berkala).

## Arsitektur & Struktur Folder

Mengikuti struktur yang disarankan di `CLAUDE.md`, dipangkas untuk Fase 1:

```
/app
  /(auth)/login
  /(dashboard)
    /pengajuan          # buat & lihat pengajuan milik sendiri (admin_cabang, snd)
    /persetujuan        # antrian approve (spv, management)
/components
  /status-badge
  /submission-timeline
  /signature-pad
/lib
  /firebase
    client.ts
    admin.ts
  /schemas                # Zod schemas (submission, item)
  /hooks
/functions
  /src
    submitSubmission.ts
    reviewSubmission.ts
    counters.ts
firestore.rules
firestore.indexes.json
firebase.json
```

Route protection: cek role dari `users/{uid}` (bukan custom claims) di server component/layout grup `(dashboard)`, redirect ke `/login` kalau belum auth, redirect/403 kalau role tidak sesuai halaman.

## Data Model Fase 1

Subset dari model penuh di `CLAUDE.md`:

```
users/{uid}
  name: string
  email: string
  role: "admin_cabang" | "snd" | "spv" | "management" | "superadmin"
  branch: "WHO" | "WHP" | "SND" | null
  department: string
  position: string
  createdAt: Timestamp

submissions/{submissionId}
  submissionNumber: string   // format: "{counter3digit}/{branch}/{bulanRomawi}/{tahun}", contoh "001/WHO/VIII/2026"
  type: "kendaraan" | "perlengkapan"
  subType: string
    // kendaraan: "service_berkala" | "service_insidentil" | "pengadaan_baru"
    // perlengkapan: "pengadaan_baru" | "penggantian"
  status: "diajukan" | "perlu_revisi" | "disetujui"
  requesterId: string
  requesterSignatureUrl: string
  approverId: string | null
  approverRole: "spv" | "management" | null
  branch: string
  department: string
  position: string
  rejectionNote: string | null
  submittedAt: Timestamp
  reviewedAt: Timestamp | null
  approvedAt: Timestamp | null

submissions/{submissionId}/items/{itemId}
  itemName: string
  brandType: string
  km: number | null          // hanya diisi untuk type == "kendaraan"
  quantity: number
  unit: string
  description: string

submissions/{submissionId}/statusHistory/{historyId}
  status: string
  note: string | null
  actorId: string
  actorRole: string
  timestamp: Timestamp

counters/{branch-YYYY-MM}    // contoh doc id: "WHO-2026-08"
  lastNumber: number          // increment via Firestore transaction
```

Field-field yang ada di model penuh tapi belum dipakai Fase 1 (`pdfUrl`, `sentToGaAt`, `completedAt`) **tidak dibuat dulu** — ditambahkan saat fase yang relevan dikerjakan, supaya schema Fase 1 tidak punya field mati.

## Cloud Functions Fase 1

| Function | Trigger | Tugas |
| --- | --- | --- |
| `submitSubmission` | Callable | Tolak request tanpa `context.auth` atau role bukan `admin_cabang`/`snd` (fail fast). Validasi payload dengan Zod schema yang sama dipakai form client. Generate `submissionNumber` via transaction di `counters/{branch-YYYY-MM}`. Set status `diajukan`, tulis entry `statusHistory`. |
| `reviewSubmission` | Callable | Tolak request tanpa `context.auth` atau role bukan `spv`/`management` (fail fast). Approve → set `disetujui`, `approverId`, `approverRole`, `approvedAt`, entry `statusHistory`. Reject → wajib `rejectionNote` diisi, set `perlu_revisi`, entry `statusHistory`. |

Revisi ulang (pengaju edit lalu submit ulang) memanggil ulang `submitSubmission` pada dokumen yang sama (bukan bikin dokumen baru) — function ini perlu membedakan create baru vs resubmit-setelah-revisi berdasarkan ada/tidaknya `submissionId` di payload.

## Firestore Security Rules Fase 1

- `users/{uid}`: read oleh pemilik dokumen atau role `spv`/`management`/`superadmin`; write hanya lewat Admin SDK.
- `submissions/{id}`: create diizinkan kalau `role in ['admin_cabang','snd']` dan `requesterId == auth.uid`; read diizinkan kalau pemilik ATAU role in `['spv','management','superadmin']`; update field `status` (dan field yang hanya boleh diubah Cloud Function seperti `approverId`, `approvedAt`) ditolak di rules.
- `submissions/{id}/items/*`: read/write mengikuti rule submission induk (write hanya saat status `diajukan` atau `perlu_revisi` dan oleh pemilik).
- `submissions/{id}/statusHistory/*`: read-only dari client, write hanya dari Cloud Function (Admin SDK).
- Simpan draft di `firestore.rules`, test pakai Firebase Emulator + `@firebase/rules-unit-testing` sebelum lanjut fase berikutnya.

## Konvensi Kode

Sesuai brief: TypeScript strict mode di seluruh proyek; Zod schema satu-satunya sumber validasi (dipakai client & Cloud Function, taruh di `/lib/schemas`); named export untuk komponen/util, default export hanya untuk `page.tsx`/`layout.tsx`; setiap Cloud Function callable cek `context.auth` dan role di awal (fail fast) sebelum logic lain jalan.

## Testing

- Firebase Emulator Suite untuk semua dev lokal (Auth, Firestore, Functions) — tidak boleh develop ke project Firebase produksi.
- `@firebase/rules-unit-testing` untuk test Firestore rules (create submission oleh role yang benar/salah, block update status dari client, dst).
- Unit test Cloud Functions: generate nomor otomatis (transaction counters, termasuk race condition dasar), transisi status (approve/reject/resubmit), penolakan request tanpa auth/role salah.

## Keputusan Eksplisit (menghindari ambiguitas)

- Integrasi ERP: **tidak dikerjakan di Fase 1**. User dibuat manual. Opsi ERP bridge/sync akan di-spec sebagai fase terpisah.
- Dokumen "Spesifikasi Aplikasi Pengajuan" (acuan UI/UX) **tidak tersedia** untuk Fase 1 — UI dibangun functional dulu (shadcn/ui default), styling detail menyusul saat dokumen tersebut ada atau di fase polish UI.
- Format nomor pengajuan Fase 1: `{counter 3 digit}/{branch}/{bulan romawi}/{tahun}`, contoh `001/WHO/VIII/2026`. Counter reset per cabang per bulan (`counters/{branch-YYYY-MM}`).
- SubType Fase 1: kendaraan → `service_berkala` | `service_insidentil` | `pengadaan_baru`; perlengkapan → `pengadaan_baru` | `penggantian`. Daftar ini bisa ditambah di fase berikutnya tanpa breaking change (field bertipe string, bukan enum union yang rigid di Firestore).
