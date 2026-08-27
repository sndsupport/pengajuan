# Copy Template WA + confirmSentToGa — Design Spec

**Tanggal:** 2026-08-27
**Status:** Approved

## Latar Belakang

Sub-proyek keempat dari rencana pengerjaan checklist MVP yang tersisa. Alur status saat ini berhenti di `siap_dikirim` (PDF sudah tergenerate otomatis). Per CLAUDE.md, langkah berikutnya adalah pengaju menyalin template pesan WA dan mengirimnya manual ke GA, lalu mengonfirmasi di sistem — transisi ke `on_proses_ga` lewat Cloud Function `confirmSentToGa`.

Urutan sub-proyek checklist MVP:
1. Login Username — selesai
2. Manajemen User (superadmin) — selesai
3. `generateSubmissionPdf` — selesai
4. **Copy Template WA + `confirmSentToGa`** — spec ini
5. Tombol Tandai Selesai + `markAsDone`
6. Dashboard Monitoring

## Keputusan Desain

### 1. Alur dua langkah terpisah

Copy template dan konfirmasi terkirim adalah dua aksi terpisah, bukan digabung:
- **Tombol "Salin Template"**: hanya menyalin teks ke clipboard (`navigator.clipboard.writeText`), tidak mengubah status apa pun. Aman diklik berkali-kali (mis. untuk melihat ulang isi template) tanpa efek samping.
- **Tombol "Konfirmasi Sudah Dikirim ke GA"**: terpisah, baru memanggil Cloud Function `confirmSentToGa` yang mengubah status. Mencegah status berubah tidak sengaja hanya karena pengaju klik salin untuk melihat isi pesan.

### 2. Tidak ada deep-link WhatsApp (wa.me)

Tidak ditambahkan tombol "Buka WhatsApp" dengan nomor GA yang di-hardcode/dikonfigurasi. Alasan: nomor kontak GA bisa berbeda-beda atau berubah, dan pengaju pada praktiknya sudah punya kontak GA tersimpan di HP mereka masing-masing — cukup salin teks lalu tempel manual ke percakapan WA yang sudah ada. Ini juga menghindari kebutuhan menyimpan nomor telepon sebagai konfigurasi sistem yang perlu dijaga tetap akurat.

### 3. Isi template WA

```
Halo GA, mohon diproses pengajuan berikut:

No. Pengajuan: {submissionNumber}
Jenis: {type} ({subType})
Cabang: {branch}
Pengaju: {requesterName}

Dokumen: {pdfUrl}

Terima kasih.
```

`type`/`subType` ditampilkan apa adanya (tidak dilabeli ke bentuk yang lebih ramah manusia) — konsisten dengan form Buat Pengajuan yang juga menampilkan `subType` mentah tanpa label. Tidak menyertakan daftar nama item — link PDF sudah memuat detail lengkap termasuk tabel item, jadi template WA cukup jadi ringkasan + tautan untuk GA.

Dibangun sebagai fungsi murni `buildWaTemplate(submission, requesterName): string` di `lib/wa-template.ts` — tidak menyentuh Firebase, sepenuhnya bisa di-unit-test dan dijalankan di mesin manapun.

### 4. Cloud Function `confirmSentToGa`

Callable baru, hanya bisa dipanggil oleh pemilik submission (`requesterId === auth.uid`) — bukan role tertentu, siapa pun yang membuat submission tersebut boleh mengonfirmasi miliknya sendiri, sesuai aturan CLAUDE.md ("Cloud Function `confirmSentToGa` | Callable (pemilik submission)").

Alur:
- Fail-fast: `context.auth` kosong → `unauthenticated`.
- Ambil dokumen submission. Tidak ada / `requesterId !== auth.uid` → `permission-denied`.
- `status !== "siap_dikirim"` → `failed-precondition`.
- Update: `status: "on_proses_ga"`, `sentToGaAt: FieldValue.serverTimestamp()`.
- Tulis entry `statusHistory` baru: `status: "on_proses_ga"`, `note: null`, `actorId: auth.uid`, `actorRole: caller.role` (role asli pengaju — beda dengan entry `siap_dikirim` sebelumnya yang otomatis oleh sistem dengan sentinel `"system"`, transisi ini murni aksi manual pengaju sehingga dicatat dengan identitas asli).

Tidak butuh payload tambahan selain `submissionId` — tidak ada input lain yang perlu divalidasi Zod di luar itu.

### 5. UI di halaman detail pengajuan

`app/(dashboard)/pengajuan/[id]/page.tsx` dapat blok baru, muncul kalau `submission.status === "siap_dikirim"` (pola sama seperti blok "Catatan revisi" yang sudah ada untuk status `perlu_revisi`):
- Link "Lihat PDF" → `submission.pdfUrl` (buka tab baru).
- Kotak teks template WA (read-only, mis. `<Textarea readOnly>`), isinya dari `buildWaTemplate`.
- Tombol "Salin Template" — copy ke clipboard, tampilkan feedback singkat ("Disalin!") beberapa detik lalu hilang.
- Tombol "Konfirmasi Sudah Dikirim ke GA" — panggil `confirmSentToGa`, tampilkan error kalau gagal. Setelah sukses, `onSnapshot` yang sudah ada di halaman ini otomatis mendeteksi perubahan status dan blok ini hilang dengan sendirinya (tidak perlu redirect/reload manual).

Nama pengaju untuk template diambil dari `useAuth()` (`appUser.name`) — karena halaman ini hanya bisa diakses pemilik submission sendiri (dijaga oleh `firestore.rules`), tidak perlu fetch dokumen `users/{requesterId}` terpisah.

### 6. Testing

`buildWaTemplate` (fungsi murni) ditulis dan **dijalankan/diverifikasi** di mesin ini — tidak ada dependency Firebase.

`confirmSentToGa` Cloud Function ditest dengan pola sama seperti handler lain di repo ini (emulator Firestore) — ditulis lengkap mengikuti TDD, tapi **tidak bisa dijalankan/diverifikasi hidup** di mesin ini (batasan Java yang sudah ada sejak sub-proyek sebelumnya), hanya diverifikasi lewat `npm --prefix functions run build`.

## Di Luar Scope

- Tombol/deep-link WhatsApp (wa.me) dengan nomor GA.
- Daftar nama item di badan pesan WA.
- Riwayat "berapa kali template disalin" atau tracking pengiriman.
