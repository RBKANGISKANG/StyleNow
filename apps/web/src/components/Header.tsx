'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useDesign } from '@/lib/design';
import { Icon, type IconName } from '@/components/Icon';

const TABS = [
  { href: '/', key: 'nav_explore', ico: '🔍', icon: 'search' },
  { href: '/bookings', key: 'nav_bookings', ico: '📅', icon: 'calendar' },
  { href: '/my-day', key: 'nav_myday', ico: '🪄', icon: 'sparkle' },
  { href: '/dashboard', key: 'nav_dashboard', ico: '💼', icon: 'briefcase' },
  { href: '/account', key: 'nav_account', ico: '👤', icon: 'user' },
] as const satisfies ReadonlyArray<{ href: string; key: string; ico: string; icon: IconName }>;

/**
 * Classic or studio, in one press.
 *
 * It sits in the header rather than buried in account settings because its
 * whole point is comparison: you flip it, look at the same page, and flip back.
 */
function DesignToggle() {
  const { t } = useI18n();
  const { design, setDesign } = useDesign();
  const studio = design === 'studio';
  return (
    <button
      className={`design-btn${studio ? ' on' : ''}`}
      onClick={() => setDesign(studio ? 'classic' : 'studio')}
      aria-pressed={studio}
      title={t(studio ? 'design_on' : 'design_off')}
    >
      <Icon name="sparkle" size={15} />
      <span className="design-label">{t(studio ? 'design_studio' : 'design_classic')}</span>
    </button>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' || pathname.startsWith('/shops') : pathname.startsWith(href);
}

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { user } = useAuth();
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
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <DesignToggle />
        </div>
        <button
          className="lang-btn"
          onClick={() => setLang(lang === 'en' ? 'de' : 'en')}
          aria-label="Switch language"
        >
          {lang === 'en' ? '🇩🇪 DE' : '🇬🇧 EN'}
        </button>
        <Link
          href="/account"
          aria-label={t('nav_account')}
          className="lang-btn"
          style={
            user
              ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)', fontWeight: 800 }
              : undefined
          }
        >
          {user ? user.name[0]?.toUpperCase() ?? '👤' : '👤'}
        </Link>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { t } = useI18n();
  const { design } = useDesign();
  const pathname = usePathname();
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={isActive(pathname, tab.href) ? 'active' : ''}>
          <span className="ico">
            {design === 'studio' ? <Icon name={tab.icon} size={21} strokeWidth={1.9} /> : tab.ico}
          </span>
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
