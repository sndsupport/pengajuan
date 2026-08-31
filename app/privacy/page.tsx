export const metadata = {
  title: "Kebijakan Privasi — Pengajuan Kendaraan & Perlengkapan TSI",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-slate-700">
      <h1 className="mb-2 font-heading text-2xl font-bold text-slate-900">Kebijakan Privasi</h1>
      <p className="mb-8 text-slate-500">Aplikasi Pengajuan Kendaraan &amp; Perlengkapan — PT Tridaya Sinergi Indonesia</p>

      <p className="mb-4">
        Aplikasi ini adalah alat internal PT Tridaya Sinergi Indonesia (&quot;TSI&quot;), dipakai oleh karyawan TSI
        untuk mengajukan dan menyetujui permintaan kendaraan, perlengkapan, gedung &amp; fasilitas, serta pengajuan
        personalia (lembur/cuti/izin). Aplikasi ini tidak ditujukan untuk publik.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Data yang dikumpulkan</h2>
      <p className="mb-4">
        Aplikasi menyimpan data akun kerja (nama, username, role, cabang, departemen, jabatan) dan data pengajuan
        (jenis permintaan, item, status, riwayat persetujuan) di Cloud Firestore milik TSI.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Akses Google Drive</h2>
      <p className="mb-4">
        Saat mengunggah lampiran, tanda tangan digital, atau PDF hasil generate, aplikasi meminta izin akses Google
        Drive dengan scope <code className="rounded bg-slate-100 px-1 py-0.5">drive.file</code> — scope ini
        <strong> hanya</strong> mengizinkan aplikasi membuat dan mengelola file yang dibuat lewat aplikasi ini
        sendiri. Aplikasi tidak bisa melihat, mengubah, atau menghapus file lain di Google Drive Anda.
      </p>
      <p className="mb-4">
        File yang diunggah (lampiran pendukung, tanda tangan, PDF pengajuan) disimpan di folder Google Drive milik
        TSI dan hanya diakses untuk keperluan proses pengajuan internal.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Berbagi data</h2>
      <p className="mb-4">
        Data tidak dibagikan ke pihak ketiga di luar TSI. Data hanya dapat diakses oleh karyawan TSI dengan role
        yang berwenang (AWS Supervisor, Management, Superadmin) sesuai kebutuhan proses persetujuan.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Kontak</h2>
      <p>
        Pertanyaan seputar privasi data bisa dikirim ke{" "}
        <a className="text-primary underline" href="mailto:sndsupport.tsi@gmail.com">
          sndsupport.tsi@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
