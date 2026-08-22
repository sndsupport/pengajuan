# Pengajuan Kendaraan & Perlengkapan

Aplikasi internal PT Tridaya Sinergi Indonesia untuk pengajuan kendaraan (mobil/motor) dan perlengkapan, lengkap dengan alur review dan tanda tangan digital. Lihat [CLAUDE.md](./CLAUDE.md) untuk detail lengkap ringkasan bisnis, alur status, dan model data.

## Tech Stack

Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui, dengan Firebase (Auth, Firestore, Cloud Functions) sebagai backend. Lihat [CLAUDE.md](./CLAUDE.md) untuk tabel tech stack lengkap.

## Development

Proyek ini dikembangkan memakai Firebase Emulator Suite — jangan konek ke project Firebase produksi untuk development sehari-hari.

```bash
# Install dependencies
npm install
npm --prefix functions install

# Salin konfigurasi environment untuk emulator
cp .env.local.example .env.local

# Terminal 1: jalankan emulator (Auth, Firestore, Functions)
npm --prefix functions run build
npx firebase emulators:start --only auth,firestore,functions --project pengajuan-kendaraan-perlengkapan

# Terminal 2: seed data user contoh untuk tiap role
npm run seed

# Terminal 3: jalankan aplikasi
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Emulator UI (lihat data Firestore/Auth langsung) ada di [http://localhost:4000](http://localhost:4000).

## Testing

```bash
npm test                       # schema, Firestore rules, dan test Cloud Functions (root)
npm --prefix functions run test # test Cloud Functions saja
```

Butuh emulator Firestore (`auth,firestore`) menyala untuk sebagian besar test di atas.

## Dokumentasi

- [`CLAUDE.md`](./CLAUDE.md) — brief proyek, model data, konvensi kode
- [`docs/superpowers/specs/`](./docs/superpowers/specs/) — spec desain per fitur
- [`docs/superpowers/plans/`](./docs/superpowers/plans/) — plan implementasi per fitur
