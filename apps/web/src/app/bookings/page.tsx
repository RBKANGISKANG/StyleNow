'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, dateOf, timeOf } from '@/lib/format';
import {
  apiMyBookings,
  apiCancel,
  apiSetReview,
  apiSetTip,
  apiLoyaltyBalance,
  apiMyWaitlist,
  apiWaitlistLeave,
} from '@/lib/api';
import { icsHref } from '@/lib/ics';

interface Bk {
  id: string;
  reference: string;
  status: string;
  startsAt: number;
  endsAt: number;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  depositCents: number;
  cancellation: { feeCents: number; refundCents: number; reason: string } | null;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  shop: { slug: string; name: string; emoji: string; district: string; gradient: [string, string] } | null;
  services: Array<{ name: { en: string; de: string }; emoji: string }>;
  serviceIds: string[];
  staffName: string | null;
  review: { rating: number; text: string; date: string } | null;
  tipCents: number;
}

interface Wl {
  id: string;
  isoDate: string;
  shop: { slug: string; name: string; emoji: string } | null;
  serviceNames: Array<{ en: string; de: string }>;
}

export default function BookingsPage() {
  const { t, lang } = useI18n();
  const [bookings, setBookings] = useState<Bk[] | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelFor, setCancelFor] = useState<{ id: string; feeCents: number; refundCents: number; reason: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [waitlist, setWaitlist] = useState<Wl[]>([]);

  const load = useCallback(async () => {
    setBookings(await apiMyBookings());
    setPoints(await apiLoyaltyBalance());
    setWaitlist(await apiMyWaitlist());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) => b.startsAt > now && ['confirmed', 'pending_payment'].includes(b.status),
  );
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b));
  const list = tab === 'upcoming' ? upcoming : past;

  const previewCancel = async (id: string) => {
    const data = await apiCancel(id, true);
    if (data) setCancelFor({ id, ...data });
  };

  const doCancel = async () => {
    if (!cancelFor) return;
    await apiCancel(cancelFor.id, false);
    setCancelFor(null);
    setToast('✅ ' + t('st_cancelled_by_customer'));
    void load();
  };

  return (
    <div>
      <div className="page-title">
        <h1>{t('nav_bookings')}</h1>
        <span className="chip" title={t('loyalty_hint')} style={{ cursor: 'default' }}>
          ⭐ {points} {t('loyalty_balance')}
        </span>
        <div className="seg">
          <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>
            {t('upcoming')} ({upcoming.length})
          </button>
          <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>
            {t('past')} ({past.length})
          </button>
        </div>
      </div>

      {bookings === null ? (
        <div className="spinner" />
      ) : list.length === 0 ? (
        <div className="empty">
          <div className="big">📅</div>
          <p>{t('no_bookings')}</p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            {t('explore_now')}
          </Link>
        </div>
      ) : (
        list.map((b, i) => (
          <div className="bk-card" key={b.id} style={{ animationDelay: `${i * 0.04}s` }}>
            <div
              className="bk-strip"
              style={{
                background: b.shop
                  ? `linear-gradient(90deg, ${b.shop.gradient[0]}, ${b.shop.gradient[1]})`
                  : 'var(--line)',
              }}
            />
            <div className="bk-main">
              <div className="bk-when">
                <div className="d">{dateOf(b.startsAt, lang)}</div>
                <div className="t">{timeOf(b.startsAt, lang)}</div>
              </div>
              <div className="bk-info">
                <div className="shop">
                  {b.shop?.emoji} {b.shop?.name ?? '—'}
                </div>
                <div className="svc">
                  {b.services.map((s) => `${s.emoji} ${s.name[lang]}`).join(' · ')}
                  {b.staffName ? ` · ${b.staffName}` : ''}
                </div>
                {tab === 'upcoming' && (
                  <div className="pol">🛈 {t('free_until', { h: b.policy.freeUntilHours })}</div>
                )}
                {b.cancellation && (
                  <div className="pol">
                    {b.cancellation.feeCents > 0
                      ? t('cancel_fee', {
                          fee: money(b.cancellation.feeCents, lang),
                          refund: money(b.cancellation.refundCents, lang),
                        })
                      : b.refundedCents > 0
                        ? t('refunded_full', { refund: money(b.refundedCents, lang) })
                        : t('cancel_nothing_paid')}
                  </div>
                )}
              </div>
              <div className="bk-side">
                <span className={`st-badge st-${b.status}`}>{t(`st_${b.status}` as MsgKey)}</span>
                <span style={{ fontWeight: 800 }}>{money(b.totalCents, lang)}</span>
                {b.paidCents > 0 && b.paidCents < b.totalCents && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)' }}>
                    {money(b.paidCents, lang)} {b.cancellation ? t('fee_kept') : `${t('deposit')} ${t('paid')}`}
                  </span>
                )}
                {b.refundedCents > 0 && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--teal)', fontWeight: 700 }}>
                    ↩ {money(b.refundedCents, lang)} {t('refunded')}
                  </span>
                )}
                {tab === 'upcoming' && b.status === 'confirmed' && (
                  <button className="btn btn-soft sm" onClick={() => void previewCancel(b.id)}>
                    {t('cancel_booking')}
                  </button>
                )}
              </div>
            </div>
            {tab === 'upcoming' && b.status === 'confirmed' && b.shop && (
              <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  className="btn btn-soft sm"
                  href={icsHref({
                    reference: b.reference,
                    title: `${b.shop.name} — ${b.services.map((s) => s.name[lang]).join(', ')}`,
                    location: b.shop.district,
                    startsAt: b.startsAt,
                    endsAt: b.endsAt,
                  })}
                  download={`stylenow-${b.reference}.ics`}
                >
                  📅 {t('add_calendar')}
                </a>
              </div>
            )}
            {b.status === 'completed' && b.shop && (
              <CompletedExtras booking={b} onChanged={() => { setToast('✅'); void load(); }} />
            )}
            {cancelFor?.id === b.id && (
              <div style={{ padding: '0 18px 16px' }}>
                <div className="alert" style={{ marginBottom: 10 }}>
                  {cancelFor.feeCents === 0
                    ? t('cancel_free', { refund: money(cancelFor.refundCents, lang) })
                    : t('cancel_fee', {
                        fee: money(cancelFor.feeCents, lang),
                        refund: money(cancelFor.refundCents, lang),
                      })}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-soft sm" onClick={() => setCancelFor(null)}>
                    {t('keep_booking')}
                  </button>
                  <button
                    className="btn sm"
                    style={{ background: 'var(--danger)', color: '#fff' }}
                    onClick={() => void doCancel()}
                  >
                    {t('confirm_cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
      {waitlist.length > 0 && (
        <section className="section">
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 10 }}>🔔 {t('waitlist_title')}</h2>
          {waitlist.map((w) => (
            <div className="bk-card" key={w.id}>
              <div className="bk-main" style={{ alignItems: 'center' }}>
                <div className="bk-when">
                  <div className="d">{w.isoDate.slice(8, 10)}.{w.isoDate.slice(5, 7)}.</div>
                </div>
                <div className="bk-info">
                  <div className="shop">{w.shop?.emoji} {w.shop?.name}</div>
                  <div className="svc">{w.serviceNames.map((n) => n[lang]).join(' · ')}</div>
                </div>
                <button
                  className="btn btn-soft sm"
                  onClick={() => {
                    void apiWaitlistLeave(w.id).then(load);
                  }}
                >
                  {t('waitlist_leave')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function CompletedExtras({ booking, onChanged }: { booking: Bk; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submitReview = async () => {
    if (rating < 1) return;
    setBusy(true);
    await apiSetReview(booking.id, rating, text.trim());
    setBusy(false);
    onChanged();
  };

  const tip = async (cents: number) => {
    setBusy(true);
    await apiSetTip(booking.id, cents);
    setBusy(false);
    onChanged();
  };

  return (
    <div style={{ padding: '0 18px 16px', borderTop: '1px dashed var(--line)', marginTop: 4 }}>
      {booking.review ? (
        <p style={{ marginTop: 10, fontSize: '0.85rem' }}>
          <strong>{t('your_review')}:</strong>{' '}
          <span style={{ color: 'var(--amber)' }}>{'★'.repeat(booking.review.rating)}</span>
          {booking.review.text && <> · “{booking.review.text}”</>}
        </p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>⭐ {t('review_cta')}</div>
          <div style={{ display: 'flex', gap: 4, margin: '6px 0' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                style={{ fontSize: '1.4rem', opacity: n <= rating ? 1 : 0.3 }}
                aria-label={`${n} stars`}
              >
                ⭐
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={t('review_ph')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
            />
            <button className="btn btn-primary sm" disabled={rating < 1 || busy} onClick={() => void submitReview()}>
              {t('review_send')}
            </button>
          </div>
        </div>
      )}
      {booking.tipCents > 0 ? (
        <p style={{ marginTop: 10, fontSize: '0.85rem' }}>
          💶 <strong>{t('tip_label')}:</strong> {money(booking.tipCents, lang)} · {t('tip_added')}
        </p>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>💶 {t('tip_cta')}:</span>
          {[200, 500, 1000].map((c) => (
            <button key={c} className="btn btn-soft sm" disabled={busy} onClick={() => void tip(c)}>
              +{money(c, lang)}
            </button>
          ))}
        </div>
      )}
      {booking.shop && (
        <div style={{ marginTop: 10 }}>
          <Link className="btn btn-soft sm" href={`/shops/${booking.shop.slug}/book?service=${booking.serviceIds[0]}`}>
            🔄 {t('rebook')}
          </Link>
        </div>
      )}
    </div>
  );
}
