'use client';
/**
 * The bell.
 *
 * One bell for both hats, because the demo deliberately lets a browser be
 * customer and operator at once: your own appointment coming up and the
 * message a customer just sent your salon land in the same panel, each row
 * naming the shop it belongs to. Everything in it is derived server-side from
 * live state (see noticesFor* in the store) — nothing here is a stored copy
 * that could go stale.
 *
 * What IS local is the "seen" watermark. The badge counts notices newer than
 * the last time this person opened the panel, and the very first load anchors
 * the watermark to now — twelve weeks of seeded history must not greet a new
 * visitor with a red badge full of the past.
 *
 * If the browser grants permission, new notices while the app is open also
 * fire native notifications — that is what "a notification that comes" means
 * when there is no push server: honest about the stack (it only works while a
 * tab is open) and still useful, because a receptionist's tab IS open all day.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { deviceId } from '@/lib/device';
import { timeOf, dateOf } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { apiMyNotices, useMessagesChanged, type AppNotice } from '@/lib/api';

const SEEN_KEY = 'stylenow.notices.seen';
const POLL_MS = 20000;

function readSeen(): number {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (raw) return Number(raw) || 0;
    // First visit: everything that already happened counts as seen.
    const now = Date.now();
    window.localStorage.setItem(SEEN_KEY, String(now));
    return now;
  } catch {
    return 0;
  }
}

function writeSeen(at: number): void {
  try {
    window.localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // private mode — the badge just stays optimistic
  }
}

export function NotificationBell() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [pushState, setPushState] = useState<'unsupported' | 'default' | 'granted' | 'denied'>('unsupported');
  const box = useRef<HTMLDivElement | null>(null);
  const known = useRef<Set<string> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    setSeen(readSeen());
    if (typeof Notification !== 'undefined') setPushState(Notification.permission);
  }, []);

  const load = useCallback(() => {
    const mine = ++seq.current;
    const ownerKey = user?.email ?? (typeof window === 'undefined' ? null : deviceId());
    void apiMyNotices(ownerKey).then((rows) => {
      if (mine !== seq.current) return;
      setNotices(rows);

      // Native notifications for what is genuinely new — never on the first
      // load, which would replay the backlog as a burst of toasts.
      if (known.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        for (const n of rows) {
          if (known.current.has(n.id)) continue;
          try {
            new Notification(noticeTitle(n, t, lang), {
              body: noticeBody(n, lang),
              tag: n.id, // the same notice never stacks twice
            });
          } catch {
            // some engines only allow this from a service worker — fine, the
            // in-app bell is the contract; this is the bonus
          }
        }
      }
      known.current = new Set(rows.map((n) => n.id));
    });
  }, [user, t, lang]);

  useEffect(load, [load]);
  useMessagesChanged(load);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Opening the panel is reading it.
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      setSeen(now);
      writeSeen(now);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unseen = notices.filter((n) => n.at > seen).length;

  const askPush = () => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then((p) => setPushState(p));
  };

  return (
    <div className="bell-wrap" ref={box}>
      <button
        className={`bell-btn${unseen > 0 ? ' has' : ''}`}
        onClick={toggle}
        aria-label={t('nt_title')}
        aria-expanded={open}
      >
        <Icon name="bell" size={18} strokeWidth={2} />
        {unseen > 0 && <em className="bell-badge">{unseen > 9 ? '9+' : unseen}</em>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('nt_title')}>
          <div className="bell-head">
            <strong>{t('nt_title')}</strong>
            {pushState === 'default' && (
              <button className="bell-push" onClick={askPush}>
                {t('nt_enable_push')}
              </button>
            )}
            {pushState === 'granted' && <span className="bell-push on">{t('nt_push_on')}</span>}
          </div>

          {notices.length === 0 ? (
            <p className="bell-empty">{t('nt_empty')}</p>
          ) : (
            <ul className="bell-list">
              {notices.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <Link href={n.href} className={`bell-row${n.at > seen ? ' fresh' : ''}`} onClick={() => setOpen(false)}>
                    <span className="bell-ico">{ICONS[n.kind]}</span>
                    <span className="bell-txt">
                      <span className="bell-title">{noticeTitle(n, t, lang)}</span>
                      <span className="bell-sub">{noticeBody(n, lang)}</span>
                    </span>
                    <span className="bell-when">{timeOf(n.at, lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const ICONS: Record<AppNotice['kind'], string> = {
  appt_soon: '⏰',
  appt_tomorrow: '📅',
  message: '💬',
  offer: '✨',
  booking_new: '🎉',
  booking_moved: '🔀',
  timeoff: '🌴',
  appt_moved: '🔀',
  staff_changed: '💇',
  digest: '☀️',
};

type T = ReturnType<typeof useI18n>['t'];

function noticeTitle(n: AppNotice, t: T, lang: 'en' | 'de'): string {
  switch (n.kind) {
    case 'appt_soon':
      return t('nt_appt_soon', { time: timeOf(n.startsAt!, lang), shop: n.shopName });
    case 'appt_tomorrow':
      return t('nt_appt_tmrw', { time: timeOf(n.startsAt!, lang), shop: n.shopName });
    case 'message':
      return n.who ? t('nt_msg_from', { who: n.who, shop: n.shopName }) : t('nt_msg_shop', { shop: n.shopName });
    case 'offer':
      return t('nt_offer', { shop: n.shopName, date: dateOf(n.startsAt!, lang), time: timeOf(n.startsAt!, lang) });
    case 'booking_new':
      return t('nt_booking', { who: n.who || t('walk_in'), shop: n.shopName });
    case 'booking_moved':
      return t('nt_moved', { who: n.who || t('walk_in'), time: timeOf(n.startsAt!, lang) });
    case 'timeoff':
      return t('nt_timeoff', { who: n.who });
    case 'appt_moved':
      return t('nt_appt_moved', { shop: n.shopName });
    case 'staff_changed':
      return t('nt_staff_changed', { who: n.who });
    case 'digest':
      return t('nt_digest', { n: n.preview, time: timeOf(n.startsAt!, lang) });
  }
}

function noticeBody(n: AppNotice, lang: 'en' | 'de'): string {
  if (n.kind === 'message') return n.preview;
  // A moved booking's preview is the old start time — show what it left behind.
  if (n.kind === 'booking_moved' || n.kind === 'appt_moved') {
    const from = Number(n.preview);
    return from ? `${dateOf(from, lang)} ${timeOf(from, lang)} → ${dateOf(n.startsAt!, lang)} ${timeOf(n.startsAt!, lang)}` : '';
  }
  if (n.kind === 'timeoff') return n.preview.replace('→', ' → ');
  const services = n.serviceNames.map((s) => s[lang]).join(', ');
  if ((n.kind === 'booking_new' || n.kind === 'staff_changed') && n.startsAt) {
    return `${dateOf(n.startsAt, lang)} · ${timeOf(n.startsAt, lang)}${services ? ` · ${services}` : ''}`;
  }
  return services;
}
