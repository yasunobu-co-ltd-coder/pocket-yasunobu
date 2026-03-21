import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistration } from './components/ServiceWorkerRegistration';

export const metadata: Metadata = {
  title: 'pocket-yasunobu',
  description: '音声から議事録を自動生成',
  manifest: '/manifest.json',
  icons: {
    icon: '/annyan.png',
    apple: '/annyan.png',
  },
  openGraph: {
    title: 'pocket-yasunobu',
    description: '音声から議事録を自動生成',
    siteName: 'pocket-yasunobu',
    images: [{ url: '/annyan.png', width: 512, height: 512, alt: 'pocket-yasunobu' }],
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'pocket-yasunobu',
    description: '音声から議事録を自動生成',
    images: ['/annyan.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'pocket-yasunobu',
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
      <body className="max-w-[600px] mx-auto min-h-screen relative">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
