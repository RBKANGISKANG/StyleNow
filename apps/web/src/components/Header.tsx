'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useState, useRef, useEffect } from 'react';
import { useDesign, useTheme } from '@/lib/design';
import { UI_LANGUAGES, uiLanguage } from '@/lib/languages';
import { Icon, type IconName } from '@/components/Icon';
import { NotificationBell } from '@/components/NotificationBell';

const TABS = [
  { href: '/', key: 'nav_explore', ico: '🔍', icon: 'search' },
  { href: '/bookings', key: 'nav_bookings', ico: '📅', icon: 'calendar' },
  { href: '/my-day', key: 'nav_myday', ico: '🪄', icon: 'sparkle' },
  { href: '/dashboard', key: 'nav_dashboard', ico: '💼', icon: 'briefcase' },
  { href: '/account', key: 'nav_account', ico: '👤', icon: 'user' },
] as const satisfies ReadonlyArray<{ href: string; key: string; ico: string; icon: IconName }>;

function ThemeToggle() {
  const { t } = useI18n();
  const { dark, setPref } = useTheme();
  return (
    <button
      className="icon-toggle"
      onClick={() => setPref(dark ? 'light' : 'dark')}
      aria-label={t(dark ? 'theme_light' : 'theme_dark')}
      title={t(dark ? 'theme_light' : 'theme_dark')}
    >
      <span className={`tt-icon${dark ? ' is-dark' : ''}`} aria-hidden>
        <span className="tt-sun">☀️</span>
        <span className="tt-moon">🌙</span>
      </span>
    </button>
  );
}

function LanguageMenu() {
  const { t, uiLang, setUiLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const current = uiLanguage(uiLang);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = UI_LANGUAGES.filter((l) => !q || `${l.name} ${l.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="lang-menu" ref={box}>
      <button
        className="lang-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('lang_pick')}
      >
        {current.flag} {current.code.split('-')[0].toUpperCase()}
      </button>
      {open && (
        <div className="lang-pop" role="dialog" aria-label={t('lang_pick')}>
          <input
            className="input lang-search"
            placeholder={`🔍 ${t('lang_pick')}`}
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="lang-grid">
            {list.map((l) => (
              <button
                key={l.code}
                className={`lang-opt${l.code === uiLang ? ' on' : ''}`}
                aria-pressed={l.code === uiLang}
                lang={l.code}
                onClick={() => {
                  setUiLang(l.code);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span className="lf">{l.flag}</span>
                <span>{l.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' || pathname.startsWith('/shops') : pathname.startsWith(href);
}

export function Header() {
  const { t } = useI18n();
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
          <ThemeToggle />
        </div>
        <NotificationBell />
        <LanguageMenu />
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
