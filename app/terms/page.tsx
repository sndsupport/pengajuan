export const metadata = {
  title: "Ketentuan Layanan — Pengajuan Kendaraan & Perlengkapan TSI",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-slate-700">
      <h1 className="mb-2 font-heading text-2xl font-bold text-slate-900">Ketentuan Layanan</h1>
      <p className="mb-8 text-slate-500">Aplikasi Pengajuan Kendaraan &amp; Perlengkapan — PT Tridaya Sinergi Indonesia</p>

      <p className="mb-4">
        Aplikasi ini adalah alat internal PT Tridaya Sinergi Indonesia (&quot;TSI&quot;) untuk proses pengajuan dan
        persetujuan kendaraan, perlengkapan, gedung &amp; fasilitas, serta pengajuan personalia (lembur/cuti/izin).
        Akses terbatas hanya untuk karyawan TSI yang akunnya dibuatkan oleh Superadmin.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Penggunaan yang wajar</h2>
      <p className="mb-4">
        Akun dan akses hanya untuk keperluan pekerjaan di TSI. Setiap pengajuan yang dibuat menjadi tanggung jawab
        pengaju yang tercatat di akunnya masing-masing.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Tanpa jaminan</h2>
      <p className="mb-4">
        Aplikasi disediakan apa adanya (&quot;as is&quot;) untuk kebutuhan operasional internal. TSI berupaya
        menjaga ketersediaan dan keakuratan data, namun tidak menjamin aplikasi selalu bebas gangguan.
      </p>

      <h2 className="mb-2 mt-8 font-heading text-lg font-semibold text-slate-900">Kontak</h2>
      <p>
        Pertanyaan seputar penggunaan aplikasi bisa dikirim ke{" "}
        <a className="text-primary underline" href="mailto:sndsupport.tsi@gmail.com">
          sndsupport.tsi@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
