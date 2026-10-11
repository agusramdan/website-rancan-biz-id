import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";

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
        <Script
          id="chatwoot-widget"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function(d, t) {
                var BASE_URL = "https://chatwoot.rancan.biz.id";
                var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
                g.src = BASE_URL + "/packs/js/sdk.js";
                g.defer = true;
                g.async = true;
                s.parentNode.insertBefore(g, s);
                g.onload = function() {
                  window.chatwootSDK.run({
                    websiteToken: 'oALwvhtgmK1DaeqqmcUPVD7x',
                    baseUrl: BASE_URL
                  })
                }
              })(document, "script");
            `,
          }}
        />
      </body>
    </html>
  );
}
