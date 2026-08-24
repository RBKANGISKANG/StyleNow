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
import { useI18n } from '@/lib/i18n';
import { money, timeOf, dateOf, fullDateOf, weekdayShort, dayNum } from '@/lib/format';
import { apiAvailability, apiHold, apiConfirm, apiLoyaltyBalance, apiWaitlistJoin } from '@/lib/api';
import { validateVoucher } from '@/core/store';
import { LOYALTY_POINTS_PER_EURO_REDEEMED } from '@/core/seed';
import { todayIso, addDays } from '@/core/time';

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

export function BookFlow({ shop }: { shop: ShopInfo }) {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <BookFlowInner shop={shop} />
    </Suspense>
  );
}

function BookFlowInner({ shop }: { shop: ShopInfo }) {
  const { t, lang } = useI18n();
  const initialServiceId = useSearchParams().get('service');
  const days = useMemo(() => Array.from({ length: 12 }, (_, i) => addDays(todayIso(), i)), []);
  const [step, setStep] = useState(0);
  const [serviceIds, setServiceIds] = useState<string[]>(
    initialServiceId && shop.services.some((s) => s.id === initialServiceId) ? [initialServiceId] : [],
  );
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState(days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [hold, setHold] = useState<Hold | null>(null);
  const [holding, setHolding] = useState(false);
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirmed, setConfirmed] = useState<{ reference: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<{ code: string; discountCents: number } | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [waitlisted, setWaitlisted] = useState<string[]>([]);

  useEffect(() => {
    if (step === 2) void apiLoyaltyBalance().then(setPoints);
  }, [step]);

  const applyVoucher = () => {
    if (!slot) return;
    const r = validateVoucher(voucherInput, slot.priceCents);
    if (r.ok) {
      setVoucher({ code: r.voucher.code, discountCents: r.discountCents });
      setVoucherError(null);
    } else {
      setVoucher(null);
      setVoucherError(
        r.reason === 'min_subtotal'
          ? t('voucher_min', { min: money(r.minSubtotalCents ?? 0, lang) })
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

  const selected = shop.services.filter((s) => serviceIds.includes(s.id));

  // ---- slots -------------------------------------------------------------
  const loadSlots = useCallback(async () => {
    if (serviceIds.length === 0) return;
    setSlots(null);
    setSlot(null);
    setSlots(await apiAvailability(shop.id, serviceIds, date, staffId));
  }, [shop.id, serviceIds, date, staffId]);

  useEffect(() => {
    if (step === 1) void loadSlots();
  }, [step, loadSlots]);

  // ---- hold + countdown --------------------------------------------------
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const left = Math.max(0, Math.round((hold.holdExpiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !confirmed) {
        setHold(null);
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

  const createHold = async (startsAt: number, chosenStaff: string | null) => {
    setHolding(true);
    setAlternatives(null);
    setExpired(false);
    const outcome = await apiHold({
      shopId: shop.id,
      serviceIds,
      staffId: chosenStaff,
      startsAt,
      guestName: name.trim() || 'Guest',
      voucherCode: voucher?.code,
      pointsToSpend: usePoints ? points : undefined,
    });
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
    setHold(outcome.hold);
  };

  const confirm = async () => {
    if (!hold) return;
    const outcome = await apiConfirm(hold.bookingId);
    if (!outcome.ok) {
      if (outcome.code === 'hold_expired') {
        setHold(null);
        setExpired(true);
        setStep(1);
      }
      return;
    }
    setConfirmed({ reference: outcome.reference });
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
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '12px 0 16px' }}>{t('price_note')}</p>
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
          {shop.services.map((s) => {
            const sel = serviceIds.includes(s.id);
            const totalMin = s.durationMin + s.processingGapMin + s.finishMin;
            return (
              <button
                key={s.id}
                className={`pick-row ${sel ? 'sel' : ''}`}
                onClick={() =>
                  setServiceIds(sel ? serviceIds.filter((x) => x !== s.id) : [...serviceIds, s.id])
                }
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

          <div className="panel">
            <h3>{t('choose_staff')}</h3>
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
              {days.map((d) => (
                <button key={d} className={`date-pill ${d === date ? 'sel' : ''}`} onClick={() => setDate(d)}>
                  <div className="dow">{weekdayShort(d, lang)}</div>
                  <div className="num">{dayNum(d)}</div>
                </button>
              ))}
            </div>
            {slots === null ? (
              <div className="spinner" />
            ) : slots.length === 0 ? (
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
              <div className="slot-grid">
                {slots.map((s, i) => {
                  const delta = s.priceCents - s.basePriceCents;
                  return (
                    <button
                      key={s.start}
                      className={`slot-chip ${slot?.start === s.start ? 'sel' : ''}`}
                      style={{ animationDelay: `${Math.min(i * 0.015, 0.3)}s` }}
                      onClick={() => {
                        setSlot(s);
                        setStep(2);
                      }}
                    >
                      <div className="t">{timeOf(s.start, lang)}</div>
                      <div className={`p ${delta < 0 ? 'deal' : delta > 0 ? 'surge' : ''}`}>
                        {money(s.priceCents, lang)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
              <span>📅 {dateOf(slot.start, lang)}</span>
              <span style={{ fontWeight: 700 }}>{timeOf(slot.start, lang)}</span>
            </div>
            <div className="quote-line muted">
              <span>
                {selected.map((s) => s.name[lang]).join(' + ')} ·{' '}
                {shop.staff.find((st) => st.id === (staffId ?? slot.suggestedStaffId))?.name ?? t('any_staff')}
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
                <div className="quote-line total">
                  <span>{t('total')}</span>
                  <span>{money(hold.quote.totalCents, lang)}</span>
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
              <input
                className="input"
                placeholder={t('your_name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
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
                    <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
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

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => (hold ? undefined : setStep(1))} disabled={Boolean(hold)}>
              ← {t('back')}
            </button>
            {!hold ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={holding || name.trim().length === 0}
                onClick={() => void createHold(slot.start, staffId)}
              >
                {holding ? '…' : `${t('continue')} →`}
              </button>
            ) : (
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void confirm()}>
                💳{' '}
                {hold.quote.depositCents > 0
                  ? `${t('pay_confirm')} · ${money(hold.quote.depositCents, lang)}`
                  : hold.quote.totalCents > 0
                    ? `${t('pay_confirm')} · ${money(hold.quote.totalCents, lang)}`
                    : t('confirm_free')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
