'use client';
/**
 * Checkout, mirroring the platform contract end to end:
 * pick services → real projected slots (each carrying its dynamically priced
 * quote) → an 8-minute hold → pay → confirmed. A 409 on the hold renders the
 * six alternatives the API returns; an expired hold sends you back to the grid.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { icsHref } from '@/lib/ics';
import { BookSeries } from '@/components/BookSeries';
import { SlotList, SlotViewToggle, useSlotView } from '@/components/SlotPicker';
import { PayMethod } from '@/components/PayMethod';
import { rememberPayment, type PaymentChoice } from '@/lib/payments';
import { useI18n } from '@/lib/i18n';
import { slotTone, slotDelta, slotReason } from '@/lib/prime';
import { money, timeOf, dateOf, fullDateOf, weekdayShort, dayNum, monthShort } from '@/lib/format';
import { apiAvailability, apiHold, apiDuoHold, apiConfirm, apiLoyaltyBalance, apiWaitlistJoin, apiShopServices, apiPrimeWindows, apiShopAnnouncement, apiStampStatus } from '@/lib/api';
import { validateVoucher, referralUsable, PRIME_PERCENT, PRIME_MIN_CENTS, primeSurcharge } from '@/core/store';
import { deviceId } from '@/lib/device';
import { LOYALTY_POINTS_PER_EURO_REDEEMED } from '@/core/seed';
import { todayIso, addDays, dayStart } from '@/core/time';
import { useAuth } from '@/lib/auth';

interface Svc {
  id: string;
  emoji: string;
  name: { en: string; de: string };
  durationMin: number;
  processingGapMin: number;
  finishMin: number;
  basePriceCents: number;
  dynamicPricing: boolean;
  popular: boolean;
}
interface ShopInfo {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  gradient: [string, string];
  depositPercent: number;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  isMobile: boolean;
  services: Svc[];
  staff: Array<{ id: string; name: string; role: { en: string; de: string } }>;
}
interface Slot {
  start: number;
  end: number;
  staffIds: string[];
  suggestedStaffId: string;
  priceCents: number;
  basePriceCents: number;
  appliedNames: string[];
}
interface Hold {
  bookingId: string;
  reference: string;
  holdExpiresAt: number;
  quote: {
    subtotalCents: number;
    travelFeeCents: number;
    vatCents: number;
    totalCents: number;
    depositCents: number;
    breakdown: Array<{ label: string; cents: number }>;
  };
}

const GUEST_KEY = 'stylenow.guest';

export function BookFlow({ shop }: { shop: ShopInfo }) {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <BookFlowInner shop={shop} />
    </Suspense>
  );
}

function BookFlowInner({ shop }: { shop: ShopInfo }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const params = useSearchParams();
  const initialServiceId = params.get('service');
  // A tap on a time on the shop's own page arrives here already decided: which
  // service, which day, which minute. Re-asking all three would throw that away.
  const initialDate = params.get('date');
  const initialAt = Number(params.get('at')) || null;
  const initialStaff = params.get('staff');
  // Two months of bookable days (matches the shops' 62-day booking horizon).
  const days = useMemo(() => Array.from({ length: 62 }, (_, i) => addDays(todayIso(), i)), []);
  // A ?service= deep link IS the service choice — the customer tapped "Book"
  // next to that service on the shop page. Making them re-confirm the same
  // pick on step 0 was the flow's one genuinely wasted tap; they start on
  // the times instead, with an "edit" back to the menu for adding more.
  const [step, setStep] = useState(
    initialServiceId && shop.services.some((s) => s.id === initialServiceId) ? 1 : 0,
  );
  // Live menu: the shop may have added or archived services since build time.
  const [menu, setMenu] = useState<Svc[]>(shop.services);
  useEffect(() => {
    void apiShopServices(shop.id).then((live) => {
      if (!Array.isArray(live) || live.length === 0) return;
      setMenu(live as Svc[]);
      // A service added after build time is only known once the live menu
      // arrives — honour ?service= for those too.
      if (initialServiceId && (live as Svc[]).some((s) => s.id === initialServiceId)) {
        setServiceIds((cur) => (cur.length === 0 ? [initialServiceId] : cur));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id]);
  const [serviceIds, setServiceIds] = useState<string[]>(
    initialServiceId && shop.services.some((s) => s.id === initialServiceId) ? [initialServiceId] : [],
  );
  // "Book again with Lena" arrives with the stylist already chosen.
  const [staffId, setStaffId] = useState<string | null>(
    initialStaff && shop.staff.some((s) => s.id === initialStaff) ? initialStaff : null,
  );
  const [date, setDate] = useState(initialDate && days.includes(initialDate) ? initialDate : days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  // Grid on a laptop, day-part list on a phone — remembered either way.
  const [slotView, setSlotView] = useSlotView();
  // Prime: an extra appointment on top of the grid, any time the doors are
  // open, at a premium. Chosen instead of a slot, never alongside one.
  const [prime, setPrime] = useState(false);
  const [primeOpen, setPrimeOpen] = useState(false);
  const [primeWindows, setPrimeWindows] = useState<Array<{ startMin: number; endMin: number }> | null>(null);

  useEffect(() => {
    let alive = true;
    setPrimeWindows(null);
    void apiPrimeWindows(shop.id, date).then((w) => {
      if (alive) setPrimeWindows(w);
    });
    return () => {
      alive = false;
    };
  }, [shop.id, date]);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    void apiShopAnnouncement(shop.id).then(setAnnouncement);
  }, [shop.id]);
  const [name, setName] = useState('');
  // Optional, but the shop needs a way to reach you if something changes —
  // and a note is where "I'm allergic to bleach" belongs, not a phone call.
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  // Nobody should type their own name a second time. The last booking's
  // details prefill the next one (notes stay per-visit — allergies travel,
  // parking questions don't... the note is the one field that's really new).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GUEST_KEY);
      if (!raw) return;
      const g = JSON.parse(raw) as { name?: string; phone?: string };
      setName((cur) => cur || g.name || '');
      setPhone((cur) => cur || g.phone || '');
    } catch {
      // private mode — they type it once more
    }
  }, []);

  useEffect(() => {
    if (user && !name) setName(user.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [pay, setPay] = useState<PaymentChoice | null>(null);
  const [holding, setHolding] = useState(false);
  // Together: two chairs, the same minute. The second seat gets its own hold
  // and its own guest name; the engine guarantees two different stylists.
  const [duo, setDuo] = useState(false);
  const [friendName, setFriendName] = useState('');
  const [hold2, setHold2] = useState<Hold | null>(null);
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirmed, setConfirmed] = useState<{ reference: string; reference2?: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<{ code: string; discountCents: number } | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [stamp, setStamp] = useState<Awaited<ReturnType<typeof apiStampStatus>> | null>(null);
  const [useStamp, setUseStamp] = useState(false);
  const [waitlisted, setWaitlisted] = useState<string[]>([]);

  useEffect(() => {
    if (step === 2) {
      void apiLoyaltyBalance().then(setPoints);
      void apiStampStatus(shop.id).then(setStamp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const applyVoucher = () => {
    if (!slot) return;
    const r = validateVoucher(voucherInput, slot.priceCents);
    if (r.ok && voucherInput.trim().toUpperCase().startsWith('REF-') && !referralUsable(voucherInput, deviceId())) {
      setVoucher(null);
      setVoucherError(t('ref_not_usable'));
      return;
    }
    if (r.ok) {
      setVoucher({ code: r.voucher.code, discountCents: r.discountCents });
      setVoucherError(null);
    } else {
      setVoucher(null);
      setVoucherError(
        r.reason === 'min_subtotal'
          ? t('voucher_min', { min: money(r.minSubtotalCents ?? 0, lang) })
          : r.reason === 'empty_card'
            ? t('gc_empty')
            : t('voucher_unknown'),
      );
    }
  };

  const pointsValueCents = slot
    ? Math.min(
        Math.floor(points / LOYALTY_POINTS_PER_EURO_REDEEMED) * 100,
        Math.max(slot.priceCents - (voucher?.discountCents ?? 0), 0),
      )
    : 0;

  const selected = menu.filter((s) => serviceIds.includes(s.id));
  // The expandable service editor on the time step — the same multi-select
  // rows as step 0, so a deep-linked customer can still build a basket.
  const [editServices, setEditServices] = useState(false);
  const [svcQuery, setSvcQuery] = useState('');
  const svcNeedle = svcQuery.trim().toLowerCase();
  const filteredMenu = svcNeedle
    ? menu.filter((s) => `${s.name.en} ${s.name.de}`.toLowerCase().includes(svcNeedle))
    : menu;
  const serviceRows = (
    <>
      {menu.length > 6 && (
        <input
          className="input"
          style={{ marginBottom: 8 }}
          placeholder={`🔎 ${t('svc_filter_ph')}`}
          value={svcQuery}
          onChange={(e) => setSvcQuery(e.target.value)}
        />
      )}
      {filteredMenu.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>{t('no_results')}</p>}
      {filteredMenu.map((s) => {
    const sel = serviceIds.includes(s.id);
    const totalMin = s.durationMin + s.processingGapMin + s.finishMin;
    return (
      <button
        key={s.id}
        className={`pick-row ${sel ? 'sel' : ''}`}
        onClick={() => setServiceIds(sel ? serviceIds.filter((x) => x !== s.id) : [...serviceIds, s.id])}
      >
        <span className="svc-ico">{s.emoji}</span>
        <span className="grow">
          <div className="t">
            {s.name[lang]} {s.popular && '🔥'}
          </div>
          <div className="s">
            {totalMin} {t('min')}
            {s.dynamicPricing && ` · ${t('dynamic_badge')}`}
          </div>
        </span>
        <span className="svc-price">{money(s.basePriceCents, lang)}</span>
      </button>
      );
      })}
    </>
  );

  // ---- slots -------------------------------------------------------------
  const loadSlots = useCallback(async () => {
    if (serviceIds.length === 0) {
      // deselecting everything must not leave yesterday's times on screen
      setSlots([]);
      setSlot(null);
      return;
    }
    setSlots(null);
    setSlot(null);
    setSlots(await apiAvailability(shop.id, serviceIds, date, staffId));
  }, [shop.id, serviceIds, date, staffId]);

  useEffect(() => {
    if (step === 1) void loadSlots();
  }, [step, loadSlots]);

  // Honour ?at= exactly once. Doing it on every slot load would teleport the
  // customer forward again the moment they pressed Back to pick another time.
  const deepLinkUsed = useRef(false);
  useEffect(() => {
    if (deepLinkUsed.current || initialAt === null || slots === null) return;
    deepLinkUsed.current = true;
    const match = slots.find((s) => s.start === initialAt);
    if (!match) return; // taken while they were deciding — leave them on the day
    setSlot(match);
    setStep(2);
  }, [slots, initialAt]);

  // ---- hold + countdown --------------------------------------------------
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const left = Math.max(0, Math.round((hold.holdExpiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !confirmed) {
        setHold(null);
        setHold2(null);
        setExpired(true);
        setStep(1);
      }
    };
    tick();
    holdTimer.current = setInterval(tick, 1000);
    return () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
    };
  }, [hold, confirmed]);

  /** what must be paid now for one hold: the deposit, or everything */
  const dueOf = (h: Hold) => (h.quote.depositCents > 0 ? h.quote.depositCents : h.quote.totalCents);

  // Together mode only shows times where a second chair is genuinely free.
  const shownSlots = slots === null ? null : duo ? slots.filter((s) => s.staffIds.length >= 2) : slots;

  const createHold = async (startsAt: number, chosenStaff: string | null) => {
    setHolding(true);
    setAlternatives(null);
    setExpired(false);
    const input = {
      shopId: shop.id,
      serviceIds,
      staffId: chosenStaff,
      startsAt,
      guestName: name.trim() || 'Guest',
      guestPhone: phone.trim() || undefined,
      guestNote: note.trim() || undefined,
      voucherCode: useStamp ? undefined : voucher?.code,
      pointsToSpend: useStamp || !usePoints ? undefined : points,
      useStampReward: useStamp || undefined,
    };
    const outcome = duo
      ? await apiDuoHold(input, friendName)
      : await apiHold({ ...input, prime });
    setHolding(false);
    if (!outcome.ok) {
      if (outcome.code === 'slot_taken') {
        setAlternatives(outcome.alternatives);
        setSlot(null);
        setStep(1);
        void loadSlots();
      }
      return;
    }
    try {
      window.localStorage.setItem(GUEST_KEY, JSON.stringify({ name: name.trim(), phone: phone.trim() }));
    } catch {
      // ignore
    }
    if ('first' in outcome) {
      setHold(outcome.first);
      setHold2(outcome.second);
    } else {
      setHold(outcome.hold);
    }
  };

  const confirm = async () => {
    if (!hold) return;
    const due = dueOf(hold) + (hold2 ? dueOf(hold2) : 0);
    if (due > 0 && !pay) return; // the button is disabled, but belt and braces
    const method = due > 0 ? (pay ?? undefined) : undefined;
    const outcome = await apiConfirm(hold.bookingId, method);
    if (!outcome.ok) {
      if (outcome.code === 'hold_expired') {
        setHold(null);
        setHold2(null);
        setExpired(true);
        setStep(1);
      }
      return;
    }
    let reference2: string | undefined;
    if (hold2) {
      const second = await apiConfirm(hold2.bookingId, method);
      // The pair held together, so a second-seat expiry here is next to
      // impossible — but if it happens, the first booking still stands and
      // the confirmation says so by simply not naming a second reference.
      if (second.ok) reference2 = second.reference;
    }
    if (due > 0 && pay) rememberPayment(pay); // next checkout is one tap
    setConfirmed({ reference: outcome.reference, reference2 });
  };

  // ---- confirmation screen ----------------------------------------------
  if (confirmed && hold) {
    const q = hold.quote;
    return (
      <div className="confirm-card">
        <div className="confirm-top">
          <div className="tick">✓</div>
          <h2>{t('booked_title')}</h2>
        </div>
        <div className="confirm-body">
          <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{t('booked_sub')}</div>
          <div className="ref">{confirmed.reference}</div>
          {confirmed.reference2 && (
            <div style={{ margin: '2px 0 6px', fontSize: '0.85rem', fontWeight: 700 }}>
              👯 {friendName || t('duo_friend_name')}: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{confirmed.reference2}</span>
            </div>
          )}
          <div style={{ fontWeight: 700 }}>
            {shop.emoji} {shop.name}
          </div>
          <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', margin: '4px 0 14px' }}>
            {slot ? fullDateOf(slot.start, lang) : ''}
          </div>
          <div className="receipt-rows">
            {q.breakdown.map((line, i) => (
              <div className="quote-line" key={i}>
                <span>{line.label}</span>
                <span className={line.cents < 0 ? 'neg' : ''}>{money(line.cents, lang)}</span>
              </div>
            ))}
            <div className="quote-line muted">
              <span>{t('vat_incl')}</span>
              <span>{money(q.vatCents, lang)}</span>
            </div>
            <div className="quote-line total">
              <span>{t('total')}</span>
              <span>{money(q.totalCents, lang)}</span>
            </div>
            {q.depositCents > 0 && (
              <div className="quote-line">
                <span>{t('deposit_now')} ✅</span>
                <span>{money(q.depositCents, lang)}</span>
              </div>
            )}
            {pay && (
              <div className="quote-line muted">
                <span>{t('paid_via')}</span>
                <span>{pay.label}</span>
              </div>
            )}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '12px 0 16px' }}>{t('price_note')}</p>

          {/* The moment the reminder matters most. A static site cannot push a
              notification, so hand the appointment to the calendar they already
              carry — it alarms them the day before and two hours ahead. */}
          {slot && (
            <a
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
              href={icsHref({
                reference: confirmed.reference,
                title: `${shop.name} — ${selected.map((s) => s.name[lang]).join(', ')}`,
                location: shop.name,
                startsAt: slot.start,
                endsAt: slot.end,
                description: `${selected.map((s) => s.name[lang]).join(', ')}\n${t('booked_sub')}: ${confirmed.reference}`,
              })}
              download={`stylenow-${confirmed.reference}.ics`}
            >
              📅 {t('add_calendar')}
            </a>
          )}
          <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginBottom: 16 }}>{t('cal_reminder_hint')}</p>

          {/* The moment the time still feels chosen rather than remembered —
              lock the rhythm before life re-fills the calendar. Prime bookings
              are flexible capacity and deliberately have no series. */}
          {!prime && <BookSeries bookingId={hold.bookingId} />}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/bookings" className="btn btn-primary">
              {t('view_bookings')}
            </Link>
            <Link href="/" className="btn btn-soft">
              {t('back_home')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const steps = [t('step_service'), t('step_time'), t('step_pay')];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-title">
        <h1>
          {shop.emoji} {shop.name}
        </h1>
        <Link href={`/shops/${shop.slug}`} className="btn btn-ghost sm">
          ← {t('back')}
        </Link>
      </div>

      {announcement && <div className="shop-banner">📣 {announcement}</div>}

      <div className="steps">
        {steps.map((label, i) => (
          <div key={label} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
            {i < step ? '✓ ' : ''}
            {label}
          </div>
        ))}
      </div>

      {/* step 0: services */}
      {step === 0 && (
        <div className="panel">
          <h3>{t('choose_service')}</h3>
          {serviceRows}
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={serviceIds.length === 0}
            onClick={() => setStep(1)}
          >
            {t('continue')} →
          </button>
        </div>
      )}

      {/* step 1: staff + date + slot */}
      {step === 1 && (
        <>
          {/* What is being booked — step 0 may have been skipped by a deep
              link, so the whole service list lives right here behind one tap:
              the strip expands into the same multi-select rows as step 0, and
              every toggle re-derives the times below. */}
          <div className="panel bk-sum-panel">
            <div className="bk-summary">
              <span className="bk-summary-txt">
                {selected.length === 0
                  ? t('choose_service')
                  : <>
                      {selected.map((s) => `${s.emoji} ${s.name[lang]}`).join(' + ')}
                      {' · '}
                      {selected.reduce((n, s) => n + s.durationMin + s.processingGapMin + s.finishMin, 0)} {t('min')}
                      {' · '}
                      {money(selected.reduce((n, s) => n + s.basePriceCents, 0), lang)}
                    </>}
              </span>
              <button
                className={`btn sm ${editServices ? 'btn-primary' : 'btn-soft'}`}
                onClick={() => setEditServices(!editServices)}
                aria-expanded={editServices}
              >
                {editServices ? `✓ ${t('bk_services_done')}` : `＋ ${t('bk_edit_services')}`}
              </button>
            </div>
            {editServices && (
              <div className="bk-sum-edit">
                {serviceRows}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: 10 }}
                  disabled={serviceIds.length === 0}
                  onClick={() => setEditServices(false)}
                >
                  ✓ {t('bk_services_done')}
                </button>
              </div>
            )}
          </div>
          {expired && <div className="alert">⏱ {t('hold_expired')}</div>}
          {alternatives && (
            <div className="alert">
              <div style={{ fontWeight: 800 }}>{t('slot_taken_title')}</div>
              <div style={{ marginBottom: 8 }}>{t('slot_taken_body')}</div>
              <div className="slot-grid">
                {alternatives.map((a) => (
                  <button
                    key={a.start}
                    className="slot-chip"
                    onClick={() => {
                      setSlot(a);
                      setPrime(false);
                      setAlternatives(null);
                      setStep(2);
                    }}
                  >
                    <div className="t">{timeOf(a.start, lang)}</div>
                    <div className="p">{money(a.priceCents, lang)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Together: one flow, two chairs, two friends. The engine will only
              offer times where two stylists are simultaneously free. */}
          {shop.staff.length > 1 && (
            <div className="panel duo-panel">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={duo}
                    onChange={(e) => {
                      setDuo(e.target.checked);
                      if (e.target.checked) setPrime(false);
                      setSlot(null);
                    }}
                  />
                  <span className="knob" />
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>👯 {t('duo_toggle')}</span>
              </label>
              {duo && <p className="duo-hint">{t('duo_hint')}</p>}
            </div>
          )}

          <div className="panel">
            <h3>{duo ? t('duo_staff_first') : t('choose_staff')}</h3>
            <div className="filter-row" style={{ marginBottom: 0 }}>
              <button className={`chip ${staffId === null ? 'on-primary' : ''}`} onClick={() => setStaffId(null)}>
                ✨ {t('any_staff')}
              </button>
              {shop.staff.map((s) => (
                <button
                  key={s.id}
                  className={`chip ${staffId === s.id ? 'on-primary' : ''}`}
                  onClick={() => setStaffId(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            {staffId === null && (
              <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 8 }}>{t('any_staff_hint')}</p>
            )}
          </div>

          <div className="panel">
            <h3>{t('pick_time')}</h3>
            <div className="date-strip">
              {days.map((d, i) => (
                <span key={d} style={{ display: 'contents' }}>
                  {(i === 0 || d.slice(5, 7) !== days[i - 1].slice(5, 7)) && (
                    <span className="month-label">{monthShort(d, lang)}</span>
                  )}
                  <button className={`date-pill ${d === date ? 'sel' : ''}`} onClick={() => setDate(d)}>
                    <div className="dow">{weekdayShort(d, lang)}</div>
                    <div className="num">{dayNum(d)}</div>
                  </button>
                </span>
              ))}
            </div>
            {shownSlots === null ? (
              <div className="spinner" />
            ) : serviceIds.length === 0 ? (
              <div className="empty" style={{ padding: '28px 16px' }}>
                <p>{t('bk_pick_one')}</p>
              </div>
            ) : shownSlots.length === 0 && duo ? (
              <div className="empty" style={{ padding: '28px 16px' }}>
                <p>{t('duo_none')}</p>
              </div>
            ) : shownSlots.length === 0 ? (
              <div className="empty" style={{ padding: '28px 16px' }}>
                <p>{t('no_slots')}</p>
                {waitlisted.includes(date) ? (
                  <p style={{ marginTop: 10, color: 'var(--teal)', fontWeight: 600 }}>✅ {t('waitlist_joined')}</p>
                ) : (
                  <button
                    className="btn btn-soft"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      void apiWaitlistJoin(shop.id, serviceIds, date);
                      setWaitlisted((w) => [...w, date]);
                    }}
                  >
                    {t('waitlist_join')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="slot-tools">
                  {shownSlots!.some((s) => slotTone(s) !== 'base') ? (
                    <p className="slot-legend">
                      <span className="tone-dot prime" /> {t('prime_legend')}
                      <span className="tone-dot saver" /> {t('saver_legend')}
                      {/* the full story, one tap away from where the question arises */}
                      <Link href="/pricing" className="legend-link">ⓘ {t('price_how')}</Link>
                    </p>
                  ) : (
                    <span />
                  )}
                  <SlotViewToggle view={slotView} onChange={setSlotView} />
                </div>
                {slotView === 'list' ? (
                  <SlotList
                    slots={shownSlots!}
                    selectedStart={slot?.start ?? null}
                    onPick={(s) => {
                      setSlot(s as Slot);
                      setPrime(false);
                      setStep(2);
                    }}
                  />
                ) : (
                <div className="slot-grid">
                  {shownSlots!.map((s, i) => {
                    const tone = slotTone(s);
                    const delta = slotDelta(s);
                    return (
                      <button
                        key={s.start}
                        className={`slot-chip ${tone} ${slot?.start === s.start ? 'sel' : ''}`}
                        style={{ animationDelay: `${Math.min(i * 0.015, 0.3)}s` }}
                        title={slotReason(s) ?? undefined}
                        onClick={() => {
                          setSlot(s);
                          setPrime(false);
                          setStep(2);
                        }}
                      >
                        {tone === 'prime' && <span className="slot-tag prime">{t('prime')}</span>}
                        {tone === 'saver' && <span className="slot-tag saver">{t('saver')}</span>}
                        <div className="t">{timeOf(s.start, lang)}</div>
                        <div className={`p ${tone === 'saver' ? 'deal' : tone === 'prime' ? 'surge' : ''}`}>
                          {money(s.priceCents, lang)}
                        </div>
                        {/* The listed price stays visible beside the prime one:
                            an uplift you cannot see the baseline for is just a
                            higher number. */}
                        {tone !== 'base' && (
                          <div className="slot-base">
                            {money(s.basePriceCents, lang)}
                            <span> {delta > 0 ? '+' : '−'}{money(Math.abs(delta), lang)}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                )}
              </>
            )}
          </div>

          {/* Prime: for the customer whose day does not bend to the grid. Any
              time inside opening hours, at a premium, as *extra* capacity —
              the times below are the doors, not the free seats, which is why
              this list can be full when the grid above is empty and vice
              versa. Collapsed by default: the grid should stay the normal way
              to book, and Prime the deliberate exception. */}
          {!duo && primeWindows !== null && primeWindows.length > 0 && (() => {
            const durMin = selected.reduce((n, x) => n + x.durationMin, 0);
            const baseCents = selected.reduce((n, x) => n + x.basePriceCents, 0);
            const estCents = baseCents + primeSurcharge(baseCents);
            const now = Date.now();
            // Berlin midnight via the shared helper — a literal +02:00 is only
            // true half the year and would shift every winter chip by an hour.
            const dayMs = dayStart(date);
            const steps: number[] = [];
            for (const w of primeWindows) {
              for (let m = Math.ceil(w.startMin / 15) * 15; m + durMin <= w.endMin; m += 15) {
                const at = dayMs + m * 60_000;
                if (at > now) steps.push(at);
              }
            }
            if (steps.length === 0) return null;
            return (
              <div className={`panel prime-panel${primeOpen ? ' open' : ''}`}>
                <button className="prime-head" onClick={() => setPrimeOpen(!primeOpen)} aria-expanded={primeOpen}>
                  <span className="prime-star">★</span>
                  <span className="prime-txt">
                    <strong>{t('prime_flex_title')}</strong>
                    <span>{t('prime_flex_sub', { price: money(estCents, lang) })}</span>
                  </span>
                  <span className="prime-chev">{primeOpen ? '−' : '+'}</span>
                </button>
                {primeOpen && (
                  <>
                    <p className="prime-body">{t('prime_flex_body', { pct: String(PRIME_PERCENT), min: money(PRIME_MIN_CENTS, lang) })}</p>
                    <div className="slot-grid">
                      {steps.map((at) => (
                        <button
                          key={at}
                          className={`slot-chip prime-flex ${prime && slot?.start === at ? 'sel' : ''}`}
                          onClick={() => {
                            setSlot({
                              start: at,
                              end: at + durMin * 60_000,
                              staffIds: [],
                              suggestedStaffId: '',
                              priceCents: estCents,
                              basePriceCents: baseCents,
                              appliedNames: ['Prime flexible'],
                            });
                            setPrime(true);
                            setStep(2);
                          }}
                        >
                          <div className="t">{timeOf(at, lang)}</div>
                          <div className="p surge">{money(estCents, lang)}</div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <button className="btn btn-ghost" onClick={() => setStep(0)}>
            ← {t('back')}
          </button>
        </>
      )}

      {/* step 2: details + pay */}
      {step === 2 && slot && (
        <>
          {hold && (
            <div className="hold-bar">
              ⏳ <span style={{ flex: 1 }}>{t('hold_note')}</span>
              <span className="clock">
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </span>
            </div>
          )}

          <div className="panel">
            <h3>{t('summary')}</h3>
            <div className="quote-line">
              <span>
                📅 {dateOf(slot.start, lang)}
                {prime && <span className="prime-flag">★ {t('prime_flag')}</span>}
              </span>
              <span style={{ fontWeight: 700 }}>{timeOf(slot.start, lang)}</span>
            </div>
            <div className="quote-line muted">
              <span>
                {selected.map((s) => s.name[lang]).join(' + ')}
                {/* Prime is assigned by the shop, so no stylist promise here. */}
                {!prime && <> · {shop.staff.find((st) => st.id === (staffId ?? slot.suggestedStaffId))?.name ?? t('any_staff')}</>}
              </span>
            </div>
            {hold ? (
              <>
                {hold.quote.breakdown.map((line, i) => {
                  const isService = selected.some((s) => s.name.en === line.label);
                  const cls = line.cents < 0 ? 'neg' : !isService && line.cents > 0 ? 'pos-adj' : '';
                  return (
                    <div className="quote-line" key={i}>
                      <span>{line.label}</span>
                      <span className={cls}>{money(line.cents, lang)}</span>
                    </div>
                  );
                })}
                <div className="quote-line muted">
                  <span>{t('vat_incl')}</span>
                  <span>{money(hold.quote.vatCents, lang)}</span>
                </div>
                {hold2 && (
                  <div className="quote-line">
                    <span>👯 {friendName || t('duo_friend_name')}</span>
                    <span>{money(hold2.quote.totalCents, lang)}</span>
                  </div>
                )}
                <div className="quote-line total">
                  <span>{t('total')}</span>
                  <span>{money(hold.quote.totalCents + (hold2?.quote.totalCents ?? 0), lang)}</span>
                </div>
                {hold.quote.depositCents > 0 && (
                  <>
                    <div className="quote-line">
                      <span style={{ fontWeight: 700 }}>{t('deposit_now')}</span>
                      <span style={{ fontWeight: 800, color: 'var(--primary)' }}>
                        {money(hold.quote.depositCents, lang)}
                      </span>
                    </div>
                    <div className="quote-line muted">
                      <span>{t('rest_at_shop')}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="quote-line">
                  <span>{t('subtotal')}</span>
                  <span style={{ fontWeight: 700 }}>{money(slot.priceCents, lang)}</span>
                </div>
                {slot.appliedNames.map((n) => (
                  <div className="quote-line muted" key={n}>
                    <span>· {n}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {!hold && (
            <div className="panel">
              <h3>{t('your_details')}</h3>
              {/* the answer to "when am I out of here?" without mental math */}
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '2px 0 10px' }}>
                ⏱ {t('done_by', { time: timeOf(slot.end, lang) })}
              </p>
              {selected.some((s) => /colou?r|balayage|toner|blond|gloss|tint/i.test(s.name.en)) && (
                <p className="patch-hint">🧪 {t('patch_hint')}</p>
              )}
              <input
                className="input"
                placeholder={t('your_name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
              {duo && (
                <input
                  className="input"
                  style={{ marginTop: 8 }}
                  placeholder={`👯 ${t('duo_friend_name')}`}
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  maxLength={60}
                />
              )}
              <input
                className="input"
                style={{ marginTop: 8 }}
                type="tel"
                placeholder={t('your_phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={24}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 4 }}>{t('your_phone_hint')}</p>
              <textarea
                className="input"
                style={{ marginTop: 8, minHeight: 62, resize: 'vertical' }}
                placeholder={t('your_note')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={280}
              />
              {/* The things people want to say but rarely type — one tap each. */}
              <div className="filter-row" style={{ marginTop: 8 }}>
                {(['np_first', 'np_quiet', 'np_early', 'np_parking'] as const).map((k) => (
                  <button
                    key={k}
                    className="chip"
                    type="button"
                    onClick={() => setNote((cur) => (cur.includes(t(k)) ? cur : `${cur ? cur + ' · ' : ''}${t(k)}`))}
                  >
                    + {t(k)}
                  </button>
                ))}
              </div>
              {stamp && stamp.enabled && !duo && (stamp.stamps > 0 || stamp.rewardsAvailable > 0) && (
                <div className="stamp-box">
                  <div className="stamp-row" aria-hidden>
                    {Array.from({ length: stamp.required }, (_, i) => (
                      <span key={i} className={`stamp-dot${i < stamp.stamps % stamp.required || (stamp.rewardsAvailable > 0 && stamp.stamps > 0) ? ' on' : ''}`} />
                    ))}
                  </div>
                  {stamp.rewardsAvailable > 0 ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <span className="switch">
                        <input type="checkbox" checked={useStamp} onChange={(e) => {
                          setUseStamp(e.target.checked);
                          if (e.target.checked) {
                            setUsePoints(false);
                            setVoucher(null);
                            setVoucherInput('');
                          }
                        }} />
                        <span className="knob" />
                      </span>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>
                        💮 {t('stamp_use', { n: String(stamp.required) })}
                      </span>
                    </label>
                  ) : (
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, margin: 0 }}>
                      💮 {t('stamp_progress', { have: String(stamp.stamps % stamp.required), need: String(stamp.required) })}
                    </p>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  disabled={useStamp}
                  placeholder={`🎟️ ${t('voucher_label')} — ${t('voucher_ph')}`}
                  value={voucherInput}
                  onChange={(e) => {
                    setVoucherInput(e.target.value.toUpperCase());
                    setVoucher(null);
                    setVoucherError(null);
                  }}
                  maxLength={20}
                />
                <button className="btn btn-soft" onClick={applyVoucher} disabled={!voucherInput.trim()}>
                  {t('voucher_apply')}
                </button>
              </div>
              {voucher && (
                <p style={{ marginTop: 6, fontSize: '0.82rem', color: 'var(--teal)', fontWeight: 700 }}>
                  ✅ {voucher.code} {t('voucher_ok')} · −{money(voucher.discountCents, lang)}
                </p>
              )}
              {voucherError && (
                <p style={{ marginTop: 6, fontSize: '0.82rem', color: 'var(--danger)', fontWeight: 600 }}>
                  {voucherError}
                </p>
              )}
              {pointsValueCents > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, cursor: 'pointer' }}>
                  <span className="switch">
                    <input type="checkbox" checked={usePoints} disabled={useStamp} onChange={(e) => setUsePoints(e.target.checked)} />
                    <span className="knob" />
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                    ⭐ {t('loyalty_redeem', { points, value: money(pointsValueCents, lang) })}
                  </span>
                </label>
              )}
              <p style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--ink-soft)' }}>{t('loyalty_hint')}</p>
            </div>
          )}

          {hold && dueOf(hold) + (hold2 ? dueOf(hold2) : 0) > 0 && (
            <PayMethod
              amountCents={dueOf(hold) + (hold2 ? dueOf(hold2) : 0)}
              onChange={setPay}
            />
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => (hold ? undefined : setStep(1))} disabled={Boolean(hold)}>
              ← {t('back')}
            </button>
            {!hold ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={holding || name.trim().length === 0 || (duo && friendName.trim().length === 0)}
                onClick={() => void createHold(slot.start, staffId)}
              >
                {holding ? '…' : `${t('continue')} →`}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={dueOf(hold) + (hold2 ? dueOf(hold2) : 0) > 0 && !pay}
                onClick={() => void confirm()}
              >
                💳{' '}
                {dueOf(hold) + (hold2 ? dueOf(hold2) : 0) > 0
                  ? `${t('pay_confirm')} · ${money(dueOf(hold) + (hold2 ? dueOf(hold2) : 0), lang)}${hold2 ? ` · 👯` : ''}`
                  : t('confirm_free')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
