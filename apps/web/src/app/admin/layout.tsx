import type { Metadata } from 'next';

// The platform console is not for search engines, and is not linked from the nav.
export const metadata: Metadata = {
  title: 'StyleNow — platform admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
