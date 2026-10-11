import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat CS Rancan — Rancan',
  description:
    'Ngobrol langsung dengan CS Rancan: tanya menu, reservasi meja, atau konsultasi katering. Dijawab bot, dilayani tim manusia bila diperlukan.',
};

/**
 * Layout khusus halaman /chat — metadata halaman + font Plus Jakarta Sans
 * (dimuat HANYA untuk subtree /chat; landing tidak tersentuh).
 * Tag <link> di RSC otomatis di-hoist Next.js ke <head>.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
