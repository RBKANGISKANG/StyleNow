'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, dateOf, timeOf } from '@/lib/format';
import { deviceId } from '@/lib/device';

interface Bk {
  id: string;
  reference: string;
  status: string;
  startsAt: number;
  endsAt: number;
  totalCents: number;
  paidCents: number;
  depositCents: number;
  cancellation: { feeCents: number; refundCents: number; reason: string } | null;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  shop: { slug: string; name: string; emoji: string; district: string; gradient: [string, string] } | null;
  services: Array<{ name: { en: string; de: string }; emoji: string }>;
  staffName: string | null;
}

export default function BookingsPage() {
  const { t, lang } = useI18n();
  const [bookings, setBookings] = useState<Bk[] | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelFor, setCancelFor] = useState<{ id: string; feeCents: number; refundCents: number; reason: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/me/bookings?deviceId=${encodeURIComponent(deviceId())}`);
    const data = await res.json();
    setBookings(data.bookings);
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
    const res = await fetch(`/api/bookings/${id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preview: true }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setCancelFor({ id, ...data });
  };

  const doCancel = async () => {
    if (!cancelFor) return;
    await fetch(`/api/bookings/${cancelFor.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preview: false }),
    });
    setCancelFor(null);
    setToast('✅ ' + t('st_cancelled_by_customer'));
    void load();
  };

  return (
    <div>
      <div className="page-title">
        <h1>{t('nav_bookings')}</h1>
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
                {b.cancellation && b.cancellation.feeCents > 0 && (
                  <div className="pol">
                    {t('cancel_fee', {
                      fee: money(b.cancellation.feeCents, lang),
                      refund: money(b.cancellation.refundCents, lang),
                    })}
                  </div>
                )}
              </div>
              <div className="bk-side">
                <span className={`st-badge st-${b.status}`}>{t(`st_${b.status}` as MsgKey)}</span>
                <span style={{ fontWeight: 800 }}>{money(b.totalCents, lang)}</span>
                {b.paidCents > 0 && b.paidCents < b.totalCents && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)' }}>
                    {money(b.paidCents, lang)} {t('deposit')} {t('paid')}
                  </span>
                )}
                {tab === 'upcoming' && b.status === 'confirmed' && (
                  <button className="btn btn-soft sm" onClick={() => void previewCancel(b.id)}>
                    {t('cancel_booking')}
                  </button>
                )}
              </div>
            </div>
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
