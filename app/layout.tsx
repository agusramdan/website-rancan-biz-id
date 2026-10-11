import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rancan — Kafe & Resto Eksklusif",
  description: "Pesan makanan & minuman sehat artisan — kopi, pastry, dan menu kuliner kelas menengah-atas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen flex flex-col font-sans bg-stone-50 text-stone-900">
        {children}
      </body>
    </html>
  );
}
