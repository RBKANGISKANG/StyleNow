import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/auth';
import { Header, BottomNav } from '@/components/Header';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'StyleNow — beauty, booked in a minute',
  description:
    'Salons, barbers, nails & brows near you. Live availability, fair prices, instant booking.',
  manifest: `${BASE}/manifest.webmanifest`,
  icons: {
    icon: `${BASE}/icons/icon-192.png`,
    apple: `${BASE}/icons/icon-180.png`,
  },
  appleWebApp: { capable: true, title: 'StyleNow', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#f0566e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${BASE}/sw.js').catch(function(){})})}`,
          }}
        />
      </head>
      <body>
        <I18nProvider>
          <AuthProvider>
            <Header />
            <main className="shell">{children}</main>
            <BottomNav />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
