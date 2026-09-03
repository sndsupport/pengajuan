# Visibilitas Semua User untuk Pengajuan — Design Spec

**Tanggal:** 2026-09-04
**Status:** Approved

## Latar Belakang

Saat ini `firestore.rules` membatasi baca `submissions/{id}` (dan tiga subcollection-nya: `items`, `statusHistory`, `attachments`) ke pemilik pengajuan (`requesterId == auth.uid`) atau reviewer (`spv`/`management`/`superadmin` lewat `isReviewer()`). Konsekuensinya, user berrole `admin` (role terpusat yang mengajukan atas nama pegawai) tidak bisa melihat pengajuan yang dibuat admin lain — termasuk di cabang berbeda. User minta ini dibuka: siapa pun yang login bisa lihat pengajuan siapa pun, termasuk dokumennya (lampiran, PDF).

Konfirmasi eksplisit dari user (setelah sempat ada jawaban bertentangan, diklarifikasi ulang): **tidak ada pengecualian per kategori** — termasuk Personalia (lembur/cuti/izin), meskipun berisi data HR per-karyawan, tetap dibuka untuk semua role yang login.

## Keputusan Desain

### 1. `firestore.rules` — buka read, write tidak berubah

Empat rule `allow read` diganti dari `pemilik ATAU isReviewer()` menjadi `isSignedIn()` saja:
- `submissions/{submissionId}` (baris 45)
- `submissions/{id}/items/{itemId}` (baris 153-154)
- `submissions/{id}/statusHistory/{historyId}` (baris 162-163 — hanya bagian `read`, rule `create` di baris 164-167 TIDAK berubah karena itu soal siapa boleh MENULIS entry riwayat, bukan soal baca)
- `submissions/{id}/attachments/{attachmentId}` (baris 172-173)

Semua rule `create`/`update`/`delete` di collection `submissions` dan subcollection-nya **tidak disentuh sama sekali** — siapa boleh mengajukan, approve, reject, generate PDF, dst. persis seperti sekarang. Ini murni memperluas siapa yang boleh MELIHAT, bukan siapa yang boleh MENGUBAH.

`isReviewer()` tetap dipakai di rule `statusHistory` create dan di beberapa cabang `update` — function-nya tidak dihapus, cuma tidak lagi dipakai di rule `read`.

Collection `users/{uid}` dan `employees/{employeeId}` **tidak berubah** — di luar scope permintaan ini (yang diminta cuma "pengajuan dan dokumennya"). Data yang perlu tampil di UI (nama approver, nama pegawai) sudah didenormalisasi ke field submission sendiri (`approverName`, `employeeName`) sejak ditulis, jadi tidak butuh baca `users`/`employees` collection tambahan untuk menampilkannya.

### 2. `/monitoring` — hilangkan filter "punya sendiri" untuk role `admin`

`app/(dashboard)/monitoring/page.tsx` saat ini punya percabangan query:
```ts
const isRequesterRole = appUser.role === "admin";
const q = isRequesterRole
  ? query(collection(db, "submissions"), where("requesterId", "==", appUser.uid), orderBy("submittedAt", "desc"))
  : query(collection(db, "submissions"), orderBy("submittedAt", "desc"));
```
Diganti jadi selalu query semua submission, tanpa percabangan role — sama seperti yang sudah dialami `spv`/`management`/`superadmin` hari ini. Nav item "Monitoring" sudah tampil untuk role `admin` (`nav-config.ts`), jadi tidak perlu perubahan navigasi.

### 3. `/pengajuan` (Pengajuan Saya) tidak berubah

Tetap query `where("requesterId", "==", appUser.uid)` — jadi list pribadi "punya saya", pelengkap Monitoring yang sekarang jadi tempat lihat semua pengajuan. Tidak ada alasan mengubah halaman ini; user tidak minta itu.

## Testing

`tests/firestore-rules.test.ts` perlu diupdate: test case yang sebelumnya mengasumsikan "non-owner, non-reviewer ditolak baca" untuk `submissions`/`items`/`statusHistory`/`attachments` sekarang harus dibalik jadi "signed-in user manapun diizinkan baca" — dan ditambah test baru yang eksplisit mengecek user role `admin` lain (bukan pemilik) bisa baca pengajuan role `admin` lain. Test emulator-dependent, tidak bisa dijalankan di mesin ini (belum ada Java) — ditulis sesuai spec, diverifikasi manual (baca ulang logic vs test case) seperti sub-project sebelumnya.

## Di Luar Scope

- Collection `users` dan `employees` — akses baca tidak berubah.
- Perubahan `/pengajuan` (Pengajuan Saya) — tetap personal.
- Redaksi/penyamaran sebagian data (mis. sembunyikan nomor HP pegawai) — tidak diminta, semua field submission tetap apa adanya untuk siapa pun yang bisa baca.
