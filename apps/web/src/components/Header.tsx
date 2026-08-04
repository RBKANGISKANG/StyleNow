'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

const TABS = [
  { href: '/', key: 'nav_explore', ico: '🔍' },
  { href: '/bookings', key: 'nav_bookings', ico: '📅' },
  { href: '/dashboard', key: 'nav_dashboard', ico: '💼' },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' || pathname.startsWith('/shops') : pathname.startsWith(href);
}

export function Header() {
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="logo">
          <span className="mark">✂️</span>
          Style<span className="now">Now</span>
        </Link>
        <nav className="top-nav">
          {TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} className={isActive(pathname, tab.href) ? 'active' : ''}>
              {t(tab.key)}
            </Link>
          ))}
        </nav>
        <button
          className="lang-btn"
          onClick={() => setLang(lang === 'en' ? 'de' : 'en')}
          aria-label="Switch language"
          style={{ marginLeft: 'auto' }}
        >
          {lang === 'en' ? '🇩🇪 DE' : '🇬🇧 EN'}
        </button>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={isActive(pathname, tab.href) ? 'active' : ''}>
          <span className="ico">{tab.ico}</span>
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
