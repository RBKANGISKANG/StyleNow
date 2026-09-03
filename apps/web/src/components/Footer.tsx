'use client';
/**
 * The footer every page was missing.
 *
 * Four groups: what a customer explores, what a salon needs, who we are, and
 * the legal pages German law expects one click away — Impressum and
 * Datenschutz above all, which must be reachable from anywhere. It hides
 * inside the studio back office, where the operator shell is a full-screen
 * tool and a marketing footer would be furniture in a workshop.
 */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

const GROUPS = [
  {
    key: 'ft_discover',
    links: [
      { href: '/', key: 'nav_explore' },
      { href: '/bookings', key: 'nav_bookings' },
      { href: '/messages', key: 'mg_title' },
      { href: '/pricing', key: 'ft_pricing' },
      { href: '/help', key: 'ft_help' },
    ],
  },
  {
    key: 'ft_business',
    links: [
      { href: '/partner', key: 'ft_partner' },
      { href: '/dashboard', key: 'nav_dashboard' },
      { href: '/my-day', key: 'nav_myday' },
    ],
  },
  {
    key: 'ft_company',
    links: [
      { href: '/about', key: 'ft_about' },
      { href: '/contact', key: 'ft_contact' },
    ],
  },
  {
    key: 'ft_legal',
    links: [
      { href: '/imprint', key: 'ft_imprint' },
      { href: '/privacy', key: 'ft_privacy' },
      { href: '/terms', key: 'ft_terms' },
    ],
  },
] as const;

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-logo">✂️ Style<em>Now</em></span>
          <p>{t('ft_tag')}</p>
        </div>
        <nav className="footer-groups" aria-label={t('ft_nav_label')}>
          {GROUPS.map((g) => (
            <div className="footer-group" key={g.key}>
              <strong>{t(g.key)}</strong>
              {g.links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {t(l.key)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="footer-base">
        <span>© {new Date().getFullYear()} StyleNow · Berlin</span>
        <span>{t('ft_demo')}</span>
      </div>
    </footer>
  );
}
