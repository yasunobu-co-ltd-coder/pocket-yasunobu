import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pocket Yasunobu',
  description: '音声から議事録を自動生成',
  manifest: '/manifest.json',
  icons: {
    icon: '/annyan.png',
    apple: '/annyan.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pocket Yasunobu',
  },
};

export const viewport: Viewport = {
  themeColor: '#f8fafc',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="max-w-[600px] mx-auto min-h-screen relative">{children}</body>
    </html>
  );
}
