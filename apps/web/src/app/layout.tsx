import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { Header, BottomNav } from '@/components/Header';

export const metadata: Metadata = {
  title: 'StyleNow — beauty, booked in a minute',
  description:
    'Salons, barbers, nails & brows near you. Live availability, fair prices, instant booking.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💇</text></svg>",
  },
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
      </head>
      <body>
        <I18nProvider>
          <Header />
          <main className="shell">{children}</main>
          <BottomNav />
        </I18nProvider>
      </body>
    </html>
  );
}
