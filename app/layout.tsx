import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { EmulatorBootstrap } from "./emulator-bootstrap";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "600", "700", "800"],
});
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Pengajuan Kendaraan & Perlengkapan",
  description: "Aplikasi pengajuan kendaraan dan perlengkapan internal PT Tridaya Sinergi Indonesia",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body
        className={`${jakarta.variable} ${publicSans.variable} ${plexMono.variable} font-sans antialiased`}
      >
        <EmulatorBootstrap />
        {children}
      </body>
    </html>
  );
}
