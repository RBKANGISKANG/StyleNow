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
  apiMyUnread,
  apiMyGiftCards,
  apiMyStampCards,
  apiSetCustomerMemo,
  apiSendBookingMessage,
  apiRebookCadence,
  apiSavedPeople,
  apiCustomerRecap,
  apiCheckIn,
  apiRecordPatchTest,
  apiDayDrift,
  apiMyPackages,
  apiSetWouldRepeat,
  apiMyWatches,
  apiRemoveWatch,
  apiOpenDispute,
  apiMyDisputes,
  type GiftCard,
} from '@/lib/api';
import type { DueRebook, SavedPerson, YearRecap, ReviewTag } from '@/core/store';
import { REVIEW_TAGS } from '@/core/store';
import { icsHref } from '@/lib/ics';
import { MoveBooking } from '@/components/MoveBooking';
import { Receipt, type ReceiptData } from '@/components/Receipt';
import { ReferralPanel } from '@/components/ReferralPanel';

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
  isPrime: boolean;
  shop: { id: string; slug: string; name: string; emoji: string; district: string; gradient: [string, string] } | null;
  services: Array<{ name: { en: string; de: string }; emoji: string }>;
  serviceIds: string[];
  staffId: string;
  staffName: string | null;
  vatCents: number;
  breakdown: Array<{ label: string; cents: number }>;
  shopAddress: string;
  guestName: string;
  seriesId: string | null;
  duoId: string | null;
  customerMemo: string | null;
  forPersonId: string | null;
  goodwillCode: string | null;
  checkedInAt: number | null;
  needsPatchTest: boolean;
  wouldRepeat: boolean;
  review: { rating: number; text: string; date: string } | null;
  tipCents: number;
  payment: { method: string; label: string } | null;
}

interface Wl {
  id: string;
  isoDate: string;
  serviceIds: string[];
  offer?: { startsAt: number; expiresAt: number };
  shop: { slug: string; name: string; emoji: string } | null;
  serviceNames: Array<{ en: string; de: string }>;
}

export default function BookingsPage() {
  const { t, lang } = useI18n();
  const [bookings, setBookings] = useState<Bk[] | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelFor, setCancelFor] = useState<{ id: string; feeCents: number; refundCents: number; reason: string } | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<ReceiptData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [waitlist, setWaitlist] = useState<Wl[]>([]);
  const [unread, setUnread] = useState(0);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [stampCards, setStampCards] = useState<Awaited<ReturnType<typeof apiMyStampCards>>>([]);
  const [lateSent, setLateSent] = useState<string[]>([]);
  const [due, setDue] = useState<DueRebook[]>([]);
  const [people, setPeople] = useState<SavedPerson[]>([]);
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [recap, setRecap] = useState<YearRecap | null>(null);
  const [myPacks, setMyPacks] = useState<Awaited<ReturnType<typeof apiMyPackages>>>([]);
  const [watches, setWatches] = useState<Awaited<ReturnType<typeof apiMyWatches>>>([]);
  useEffect(() => {
    void apiMyWatches().then(setWatches);
  }, []);
  // Live day-drift per salon, only asked for salons where I sit today.
  const [drift, setDrift] = useState<Record<string, number>>({});
  useEffect(() => {
    const today = new Date().toDateString();
    const shops = new Set(
      (bookings ?? [])
        .filter((b) => b.status === 'confirmed' && b.startsAt > Date.now() && new Date(b.startsAt).toDateString() === today && b.shop)
        .map((b) => b.shop!.id),
    );
    let alive = true;
    for (const id of shops) {
      void apiDayDrift(id).then((n) => {
        if (alive && n >= 10) setDrift((cur) => ({ ...cur, [id]: n }));
      });
    }
    return () => {
      alive = false;
    };
  }, [bookings]);

  const load = useCallback(async () => {
    // One round-trip's worth of waiting, not eight: these reads are
    // independent, and each one pays the backend sync budget on its own.
    const [bk, pts, wl, un, gc, st, du, pp, pks] = await Promise.all([
      apiMyBookings(),
      apiLoyaltyBalance(),
      apiMyWaitlist(),
      apiMyUnread(),
      apiMyGiftCards(),
      apiMyStampCards(),
      apiRebookCadence(),
      apiSavedPeople(),
      apiMyPackages(),
    ]);
    setBookings(bk);
    setPoints(pts);
    setWaitlist(wl);
    setUnread(un);
    setGiftCards(gc);
    setStampCards(st);
    setDue(du);
    setPeople(pp);
    setMyPacks(pks);
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
  const byPerson = (bookings ?? []).filter((b) =>
    personFilter === 'all' ? true : personFilter === 'me' ? !b.forPersonId : b.forPersonId === personFilter,
  );
  const upcoming = byPerson.filter(
    (b) => b.startsAt > now && ['confirmed', 'pending_payment'].includes(b.status),
  );
  const past = byPerson.filter((b) => !upcoming.includes(b));
  const list = tab === 'upcoming' ? upcoming : past;
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;

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
        <Link className="btn btn-soft sm" href="/messages">
          {t('mg_open')}
          {unread > 0 && <em className="tab-badge">{unread > 99 ? '99+' : unread}</em>}
        </Link>
        <div className="seg">
          <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>
            {t('upcoming')} ({upcoming.length})
          </button>
          <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>
            {t('past')} ({past.length})
          </button>
        </div>
      </div>

      {/* "You're due" — the customer's own rhythm noticed something. */}
      {tab === 'upcoming' && due.length > 0 && (
        <div className="due-strip">
          {due.slice(0, 2).map((d) => (
            <div className="due-card" key={`${d.shopId}-${d.serviceId}-${d.personId ?? 'me'}`}>
              <span className="due-emoji">{d.shopEmoji}</span>
              <span className="due-main">
                <b>
                  {t('due_title')}
                  {d.personName ? ` — ${d.personName}` : ''}: {d.serviceName[lang]}
                </b>
                <span>
                  {d.shopName} · {t('due_line', { n: d.medianGapDays, date: dateOf(d.lastVisit, lang) })}
                </span>
              </span>
              <Link
                className="btn btn-primary sm"
                href={`/shops/${d.slug}/book?service=${d.serviceId}${d.staffId ? `&staff=${d.staffId}` : ''}${d.personId ? `&for=${d.personId}` : ''}`}
              >
                {t('due_book')}
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Family & friends: one device, several rhythms. */}
      {people.length > 0 && (
        <div className="addon-row" style={{ marginBottom: 12 }}>
          <button className={`chip ${personFilter === 'all' ? 'on-primary' : ''}`} onClick={() => setPersonFilter('all')}>
            {t('for_all')}
          </button>
          <button className={`chip ${personFilter === 'me' ? 'on-primary' : ''}`} onClick={() => setPersonFilter('me')}>
            {t('for_me')}
          </button>
          {people.map((p) => (
            <button
              key={p.id}
              className={`chip ${personFilter === p.id ? 'on-primary' : ''}`}
              onClick={() => setPersonFilter(p.id)}
            >
              {p.emoji ?? '👤'} {p.name}
            </button>
          ))}
        </div>
      )}

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
                {b.startsAt > now && ['confirmed', 'pending_payment'].includes(b.status) && (
                  <div className="bk-count">
                    {b.startsAt - now < 864e5 && new Date(b.startsAt).getDate() === new Date(now).getDate()
                      ? t('nu_today')
                      : b.startsAt - now < 2 * 864e5
                        ? t('nu_tomorrow')
                        : t('nu_in_days', { days: String(Math.round((b.startsAt - now) / 864e5)) })}
                  </div>
                )}
              </div>
              <div className="bk-info">
                <div className="shop">
                  {b.shop?.emoji} {b.shop?.name ?? '—'}
                  {b.isPrime && <span className="prime-flag">★ {t('prime_flag')}</span>}
                  {b.seriesId && <span className="series-badge">🔁 {t('sr_badge')}</span>}
                  {b.duoId && <span className="series-badge">👯 {t('duo_badge')}</span>}
                  {b.forPersonId && personName(b.forPersonId) && (
                    <span className="series-badge">👤 {t('bk_for', { name: personName(b.forPersonId)! })}</span>
                  )}
                  {b.goodwillCode && (
                    <span className="series-badge" title={b.goodwillCode}>🎁 {b.goodwillCode}</span>
                  )}
                </div>
                <div className="svc">
                  {b.services.map((s) => `${s.emoji} ${s.name[lang]}`).join(' · ')}
                  {b.staffName ? ` · ${b.staffName}` : ''}
                </div>
                {tab === 'upcoming' && (
                  <div className="pol">🛈 {t('free_until', { h: b.policy.freeUntilHours })}</div>
                )}
                {/* the waiting-room question, answered before leaving home */}
                {tab === 'upcoming' && b.shop && drift[b.shop.id] !== undefined && (
                  <div className="pol" style={{ color: 'var(--amber, #b8860b)', fontWeight: 700 }}>
                    ⏱ {t('drift_line', { n: drift[b.shop.id] })}
                  </div>
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
                {['confirmed', 'completed'].includes(b.status) && b.shop && (
                  <button
                    className="btn btn-ghost sm"
                    onClick={() =>
                      setReceiptFor({
                        reference: b.reference,
                        startsAt: b.startsAt,
                        shopId: b.shop!.id,
                        shopName: b.shop!.name,
                        shopAddress: b.shopAddress,
                        guestName: b.guestName || undefined,
                        breakdown: b.breakdown,
                        totalCents: b.totalCents,
                        vatCents: b.vatCents,
                        paidCents: b.paidCents,
                        refundedCents: b.refundedCents,
                        tipCents: b.tipCents,
                        staffName: b.staffName,
                        paidVia: b.payment?.label ?? null,
                      })
                    }
                  >
                    🧾 {t('rc_open')}
                  </button>
                )}
                {tab === 'upcoming' && b.status === 'confirmed' && (
                  <>
                    {/* Moving is only offered while cancelling would still be
                        free — later than that it would be fee-dodging, and the
                        message thread is the honest door. */}
                    {Date.now() <= b.startsAt - b.policy.freeUntilHours * 36e5 && (
                      <button
                        className="btn btn-soft sm"
                        onClick={() => {
                          setMoveFor(moveFor === b.id ? null : b.id);
                          setCancelFor(null);
                        }}
                      >
                        ⇄ {t('mv_open')}
                      </button>
                    )}
                    <button className="btn btn-soft sm" onClick={() => { setMoveFor(null); void previewCancel(b.id); }}>
                      {t('cancel_booking')}
                    </button>
                  </>
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
                    location: `${b.shop.name}, ${b.shopAddress || b.shop.district}`,
                    startsAt: b.startsAt,
                    endsAt: b.endsAt,
                    description: `${b.services.map((s) => s.name[lang]).join(', ')}${b.staffName ? ` · ${b.staffName}` : ''}\n${t('booked_sub')}: ${b.reference}`,
                  })}
                  download={`stylenow-${b.reference}.ics`}
                >
                  📅 {t('add_calendar')}
                </a>
                <button
                  className="btn btn-soft sm"
                  onClick={() => {
                    const text = `${b.shop!.name} — ${b.services.map((s) => s.name[lang]).join(', ')}\n${dateOf(b.startsAt, lang)} ${timeOf(b.startsAt, lang)}\n${b.shopAddress}`;
                    if (navigator.share) {
                      void navigator.share({ text }).catch(() => {});
                    } else {
                      try {
                        void navigator.clipboard.writeText(text);
                        setToast('📋 ' + t('appt_copied'));
                      } catch {
                        // no clipboard — nothing sensible to do
                      }
                    }
                  }}
                >
                  📤 {t('share_appt')}
                </button>
                <a
                  className="btn btn-soft sm"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.shop.name}, ${b.shopAddress}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🗺 {t('open_maps')}
                </a>
                {/* Straight into the right conversation — "can I move this?" is
                    the message people actually want to send from here. */}
                <Link className="btn btn-soft sm" href={`/messages?shop=${b.shop.id}`}>
                  💬 {t('mg_shop_thread')}
                </Link>
                {/* One tap at the door: the floor sees an arrived dot. */}
                {Math.abs(b.startsAt - now) <= 45 * 60000 &&
                  (b.checkedInAt ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--teal)', fontWeight: 700, alignSelf: 'center' }}>
                      ✅ {t('ci_done', { who: b.staffName ?? b.shop.name })}
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary sm"
                      onClick={() => {
                        void apiCheckIn(b.id).then((ok) => {
                          if (ok) {
                            setToast('📍 ' + t('ci_toast'));
                            void load();
                          }
                        });
                      }}
                    >
                      📍 {t('ci_here')}
                    </button>
                  ))}
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', alignSelf: 'center' }}>
                  {t('cal_reminder_hint')}
                </span>
              </div>
            )}
            {b.status === 'completed' && b.shop && (
              /* review, tip and the rebook link live in here — no second
                 "book again" button outside it */
              <CompletedExtras booking={b} onChanged={() => { setToast('✅'); void load(); }} />
            )}
            {moveFor === b.id && b.shop && (
              <div style={{ padding: '0 18px 16px' }}>
                <MoveBooking
                  shopId={b.shop.id}
                  bookingId={b.id}
                  serviceIds={b.serviceIds}
                  staffId={b.staffId}
                  currentStartsAt={b.startsAt}
                  onDone={(msg) => {
                    setMoveFor(null);
                    setToast('✅ ' + msg);
                    void load();
                  }}
                  onClose={() => setMoveFor(null)}
                />
              </div>
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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary sm"
                    onClick={() => {
                      // half of all "cancellations" are really "wrong time" —
                      // hand them the move tool before they burn the booking
                      setMoveFor(cancelFor!.id);
                      setCancelFor(null);
                    }}
                  >
                    🔀 {t('mv_instead')}
                  </button>
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
            <div className={`bk-card${w.offer ? ' wl-has-offer' : ''}`} key={w.id}>
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
              {/* The other half of the waitlist: the shop proposed an exact
                  time. The button goes straight into checkout with that slot
                  selected — the offer flags it, the seat stays on open sale. */}
              {w.offer && w.shop && (
                <div className="wl-offer-banner">
                  <span>
                    ✨ {t('wl_cus_offer', { time: timeOf(w.offer.startsAt, lang), date: dateOf(w.offer.startsAt, lang) })}
                    <em> · {t('wl_offer_expires', { m: String(Math.max(1, Math.round((w.offer.expiresAt - Date.now()) / 60_000))) })}</em>
                  </span>
                  <Link
                    className="btn btn-primary sm"
                    href={`/shops/${w.shop.slug}/book?service=${w.serviceIds[0] ?? ''}&date=${w.isoDate}&at=${w.offer.startsAt}`}
                  >
                    {t('wl_cus_take')}
                  </Link>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {giftCards.length > 0 && (
        <section className="section" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 10 }}>🎁 {t('gc_mine')}</h2>
          {giftCards.map((c) => (
            <div key={c.code} className="gc-row">
              <span className="gc-row-code">{c.code}</span>
              <span className="gc-row-meta">
                {c.toName ? `${t('gc_for')} ${c.toName} · ` : ''}
                {dateOf(c.createdAt, lang)}
              </span>
              <span className="gc-row-bal">
                <strong>{money(c.balanceCents, lang)}</strong>
                {c.balanceCents !== c.initialCents && <em> / {money(c.initialCents, lang)}</em>}
              </span>
            </div>
          ))}
          <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 6 }}>{t('gc_mine_hint')}</p>
        </section>
      )}
      {stampCards.length > 0 && (
        <section className="section" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 10 }}>💮 {t('stamp_wallet')}</h2>
          {stampCards.map((c) => (
            <div key={c.shopId} className="gc-row">
              <span style={{ fontSize: '1.2rem' }}>{c.shopEmoji}</span>
              <span style={{ flex: 1, minWidth: 140 }}>
                <strong>{c.shopName}</strong>
                <span className="stamp-row" aria-label={`${c.stamps % c.required}/${c.required}`}>
                  {Array.from({ length: c.required }, (_, i) => (
                    <span key={i} className={`stamp-dot${i < c.stamps % c.required || (c.rewardsAvailable > 0 && c.stamps > 0) ? ' on' : ''}`} />
                  ))}
                </span>
              </span>
              {c.rewardsAvailable > 0 ? (
                <Link className="btn btn-primary sm" href={`/shops/${c.shopSlug}/book`}>
                  🎉 {t('stamp_reward_ready')}
                </Link>
              ) : (
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--ink-soft)' }}>
                  {c.stamps % c.required}/{c.required}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
      {/* Standing constraints: "tell me when Yara has a Saturday". */}
      {watches.length > 0 && (
        <section className="section" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 10 }}>🔔 {t('wt_title')}</h2>
          {watches.map((w) => (
            <div className="due-card" key={w.id}>
              <span className="due-emoji">🔔</span>
              <span className="due-main">
                <b>
                  {w.serviceName[lang]}
                  {w.staffName ? ` · ${w.staffName}` : ''}
                  {w.dow ? ` · ${t(`dow_${w.dow}` as MsgKey)}` : ''}
                </b>
                <span>
                  {w.shopName} ·{' '}
                  {w.hit ? `✅ ${dateOf(w.hit.start, lang)} ${timeOf(w.hit.start, lang)}` : t('wt_none_yet')}
                </span>
              </span>
              {w.hit && (
                <Link
                  className="btn btn-primary sm"
                  href={`/shops/${w.slug}/book?service=${w.serviceId}${w.staffId ? `&staff=${w.staffId}` : ''}&date=${w.hit.iso}&at=${w.hit.start}`}
                >
                  {t('due_book')}
                </Link>
              )}
              <button
                className="btn btn-ghost sm"
                aria-label={t('a11y_delete')}
                onClick={() => void apiRemoveWatch(w.id).then(() => apiMyWatches().then(setWatches))}
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Prepaid cards: what is left to sit through, where. */}
      {myPacks.length > 0 && (
        <section className="section" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 10 }}>🎟 {t('pk_wallet')}</h2>
          {myPacks.map((pk) => (
            <div className="due-card" key={pk.id}>
              <span className="due-emoji">🎟</span>
              <span className="due-main">
                <b>{pk.total}× {pk.serviceName[lang]}</b>
                <span>{pk.shopName} · {pk.remaining}/{pk.total}</span>
              </span>
              {pk.remaining > 0 && (
                <Link className="btn btn-soft sm" href={`/shops/${pk.slug}/book?service=${pk.serviceId}`}>
                  {t('due_book')}
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {/* The year, as this device saw it — computed locally, shared only if
          the customer says so. */}
      <section className="section" style={{ marginTop: 18 }}>
        {recap === null ? (
          <button
            className="btn btn-soft"
            onClick={() => void apiCustomerRecap(new Date().getFullYear()).then(setRecap)}
          >
            {t('recap_btn', { year: new Date().getFullYear() })}
          </button>
        ) : recap.visits === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{t('recap_none')}</p>
        ) : (
          <div className="recap-card">
            <h2>{t('recap_title', { year: recap.year })}</h2>
            <div className="recap-grid">
              <div><b>{recap.visits}</b><span>{t('recap_visits')}</span></div>
              <div><b>{money(recap.spentCents, lang)}</b><span>{t('recap_spent')}</span></div>
              <div><b>{money(recap.savedCents, lang)}</b><span>{t('recap_saved')}</span></div>
              {recap.freeVisits > 0 && <div><b>{recap.freeVisits}</b><span>{t('recap_free')}</span></div>}
            </div>
            {recap.topShop && (
              <p className="recap-line">
                🏆 {t('recap_top_shop')}: <b>{recap.topShop.emoji} {recap.topShop.name}</b> ({recap.topShop.visits}×)
              </p>
            )}
            {recap.topStaff && (
              <p className="recap-line">
                💇 {t('recap_top_staff')} <b>{recap.topStaff.name}</b> ({recap.topStaff.visits}×)
              </p>
            )}
            {recap.favDow !== null && recap.favHour !== null && (
              <p className="recap-line">
                🕐 {t('recap_fav_time')}: <b>{t(`dow_${recap.favDow}` as MsgKey)} {String(recap.favHour).padStart(2, '0')}:00</b>
              </p>
            )}
            <p className="recap-note">{t('recap_device')}</p>
          </div>
        )}
      </section>

      <ReferralPanel />
      {receiptFor && <Receipt data={receiptFor} onClose={() => setReceiptFor(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function CompletedExtras({ booking, onChanged }: { booking: Bk; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<ReviewTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [ptDone, setPtDone] = useState(false);
  const [repeat, setRepeat] = useState(booking.wouldRepeat);

  const submitReview = async () => {
    if (rating < 1) return;
    setBusy(true);
    await apiSetReview(booking.id, rating, text.trim(), tags);
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
          {/* The countable half of the review — one tap per compliment. */}
          <div className="addon-row" style={{ margin: '4px 0 8px' }}>
            {REVIEW_TAGS.map((tg) => (
              <button
                key={tg}
                className={`chip ${tags.includes(tg) ? 'on-primary' : ''}`}
                onClick={() => setTags((cur) => (cur.includes(tg) ? cur.filter((x) => x !== tg) : [...cur, tg]))}
              >
                {t(`rt_${tg}` as MsgKey)}
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
      {/* A colour visit means a patch test happened — record it once and the
          next booking at this salon skips the warning. */}
      {booking.needsPatchTest && booking.shop && !ptDone && (
        <button
          className="btn btn-soft sm"
          style={{ marginTop: 10 }}
          onClick={() => {
            void apiRecordPatchTest(booking.shop!.id).then(() => setPtDone(true));
          }}
        >
          🧪 {t('pt_record')}
        </button>
      )}
      {ptDone && <p style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--teal)' }}>✅ {t('pt_recorded')}</p>}
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
      {/* The result journal: pin what worked, and how to care for it. */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className={`chip ${repeat ? 'on-primary' : ''}`}
          onClick={() => {
            void apiSetWouldRepeat(booking.id, !repeat).then((ok) => {
              if (ok) setRepeat(!repeat);
            });
          }}
        >
          {repeat ? '📌 ' : '☆ '}{t('jr_repeat')}
        </button>
        <AftercareTip colour={booking.needsPatchTest || booking.services.some((sv) => /colou?r|balayage|strähn|toner/i.test(sv.name.en + sv.name.de))} />
      </div>
      <DisputeBox bookingId={booking.id} />
      {booking.shop && (
        <div style={{ marginTop: 10 }}>
          <Link
            className="btn btn-soft sm"
            href={`/shops/${booking.shop.slug}/book?service=${booking.serviceIds[0]}${booking.staffId ? `&staff=${booking.staffId}` : ''}`}
          >
            🔄 {booking.staffName ? t('rebook_with', { name: booking.staffName }) : t('rebook')}
          </Link>
          {/* the note-to-self that makes next time as good as this time */}
          <input
            className="input"
            style={{ marginTop: 8, fontSize: '0.82rem' }}
            placeholder={`📝 ${t('memo_ph')}`}
            defaultValue={booking.customerMemo ?? ''}
            maxLength={200}
            onBlur={(e) => {
              if (e.target.value.trim() !== (booking.customerMemo ?? '')) {
                void apiSetCustomerMemo(booking.id, e.target.value).then((ok) => ok && onChanged());
              }
            }}
          />
          <p style={{ fontSize: '0.68rem', color: 'var(--ink-soft)', marginTop: 3 }}>{t('memo_hint')}</p>
        </div>
      )}
    </div>
  );
}


/** One honest sentence of aftercare — colour visits get the colour one. */
function AftercareTip({ colour }: { colour: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="chip" onClick={() => setOpen(!open)} aria-expanded={open}>
        🧴 {t('ac_btn')}
      </button>
      {open && (
        <p style={{ flexBasis: '100%', fontSize: '0.78rem', color: 'var(--ink-soft)', margin: '4px 0 0' }}>
          {colour ? t('ac_colour') : t('ac_general')}
        </p>
      )}
    </>
  );
}

/**
 * The remedy path: a structured complaint with a paper trail, instead of an
 * argument at the till. One open dispute per booking; the answer shows here.
 */
function DisputeBox({ bookingId }: { bookingId: string }) {
  const { t } = useI18n();
  const [mine, setMine] = useState<Awaited<ReturnType<typeof apiMyDisputes>>>([]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'result' | 'fee' | 'other'>('result');
  const [text, setText] = useState('');
  const load = useCallback(() => {
    void apiMyDisputes().then(setMine);
  }, []);
  useEffect(load, [load]);
  const existing = mine.find((d) => d.bookingId === bookingId);
  if (existing) {
    return (
      <p style={{ marginTop: 10, fontSize: '0.8rem' }}>
        ⚖️ {t(`dq_${existing.kind}` as MsgKey)}:{' '}
        {existing.status === 'open' ? (
          <em>{t('dq_open')}</em>
        ) : (
          <b>
            {t(`dq_res_${existing.resolution!.kind}` as MsgKey)}
            {existing.resolution?.note ? ` — “${existing.resolution.note}”` : ''}
          </b>
        )}
      </p>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <button className="btn btn-ghost sm" onClick={() => setOpen(true)}>
          ⚖️ {t('dq_report')}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="chip">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'result' | 'fee' | 'other')}>
              <option value="result">{t('dq_result')}</option>
              <option value="fee">{t('dq_fee')}</option>
              <option value="other">{t('dq_other')}</option>
            </select>
          </label>
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder={t('dq_ph')} value={text}
            maxLength={500} onChange={(e) => setText(e.target.value)} />
          <button
            className="btn btn-primary sm"
            disabled={!text.trim()}
            onClick={() => void apiOpenDispute(bookingId, kind, text).then((r) => r.ok && load())}
          >
            {t('dq_send')}
          </button>
        </div>
      )}
    </div>
  );
}