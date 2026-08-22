import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { EmulatorBootstrap } from "./emulator-bootstrap";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <EmulatorBootstrap />
        {children}
      </body>
    </html>
  );
}
