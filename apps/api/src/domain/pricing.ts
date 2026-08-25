/**
 * StyleNow — dynamic pricing evaluator (pure).
 *
 * Rules are data, not code: shops author them in the dashboard, the engine
 * applies them deterministically and returns an audit trail. The trail is
 * stored on booking_item.applied_rules so a customer asking "why was this
 * 8 EUR more?" gets a real answer, and so a regulator asking the same question
 * gets one too.
 *
 * Guard rails that are deliberately non-negotiable:
 *   - a listed price never rises above `ceilingCents` (default: +25 % of base)
 *   - surge is never applied to a returning customer's repeat of the same
 *     service within 90 days (anti-gouging, keeps NPS intact)
 *   - a discount never takes more than `maxDiscountPct` off (default 60 %), so a
 *     mis-keyed rule cannot hand out free appointments
 *   - only the highest-priority rule in each non-stackable group applies
 *
 * Both limits are platform config (MAX_PRICE_UPLIFT_PCT / MAX_PRICE_DISCOUNT_PCT)
 * threaded in by the caller; the defaults here are the last line of defence.
 */

export type PriceRuleKind =
  | 'time_of_day'
  | 'day_of_week'
  | 'lead_time'
  | 'occupancy'
  | 'seasonal'
  | 'new_customer'
  | 'loyalty_tier'
  | 'last_minute'
  | 'staff_tier';

export interface PricingRule {
  id: string;
  kind: PriceRuleKind;
  name: string;
  dows?: number[];
  minuteOfDayFrom?: number;
  minuteOfDayTo?: number;
  dateFrom?: string;
  dateTo?: string;
  leadHoursMin?: number;
  leadHoursMax?: number;
  occupancyMinPct?: number;
  occupancyMaxPct?: number;
  loyaltyTier?: string;
  staffTier?: string;
  adjustKind: 'percent' | 'fixed_cents' | 'set_cents';
  adjustValue: number;
  floorCents?: number;
  ceilingCents?: number;
  priority: number;
  stackable: boolean;
}

export interface PriceContext {
  basePriceCents: number;
  slotStart: number;
  now: number;
  /** 0–100, how full the shop's day already is */
  occupancyPct: number;
  dow: number;
  minuteOfDay: number;
  isoDate: string;
  loyaltyTier?: string;
  staffTier?: string;
  isNewCustomer: boolean;
  isRepeatOfSameServiceWithin90d: boolean;
}

export interface AppliedRule {
  ruleId: string;
  name: string;
  kind: PriceRuleKind;
  deltaCents: number;
}

export interface PriceResult {
  basePriceCents: number;
  finalPriceCents: number;
  applied: AppliedRule[];
  clamped: boolean;
}

const SURGE_KINDS: PriceRuleKind[] = ['occupancy', 'time_of_day', 'day_of_week', 'seasonal'];

/**
 * Does this rule raise the price? Checked by effect, not by the sign of
 * `adjustValue` — a `set_cents` rule's value is an absolute price and is always
 * positive, so a sign test would strip "set this to EUR 40" promos from exactly
 * the loyal customers the guard rail exists to protect.
 */
function isUplift(rule: PricingRule, basePriceCents: number): boolean {
  return applyOne(rule, basePriceCents, basePriceCents) > basePriceCents;
}

function matches(rule: PricingRule, ctx: PriceContext): boolean {
  if (rule.dows && !rule.dows.includes(ctx.dow)) return false;
  if (rule.minuteOfDayFrom !== undefined && ctx.minuteOfDay < rule.minuteOfDayFrom) return false;
  if (rule.minuteOfDayTo !== undefined && ctx.minuteOfDay >= rule.minuteOfDayTo) return false;
  if (rule.dateFrom && ctx.isoDate < rule.dateFrom) return false;
  if (rule.dateTo && ctx.isoDate > rule.dateTo) return false;
  if (rule.occupancyMinPct !== undefined && ctx.occupancyPct < rule.occupancyMinPct) return false;
  if (rule.occupancyMaxPct !== undefined && ctx.occupancyPct > rule.occupancyMaxPct) return false;
  if (rule.loyaltyTier && rule.loyaltyTier !== ctx.loyaltyTier) return false;
  if (rule.staffTier && rule.staffTier !== ctx.staffTier) return false;
  if (rule.kind === 'new_customer' && !ctx.isNewCustomer) return false;

  const leadHours = (ctx.slotStart - ctx.now) / 3_600_000;
  if (rule.leadHoursMin !== undefined && leadHours < rule.leadHoursMin) return false;
  if (rule.leadHoursMax !== undefined && leadHours > rule.leadHoursMax) return false;

  return true;
}

function applyOne(rule: PricingRule, current: number, base: number): number {
  switch (rule.adjustKind) {
    case 'percent':
      return Math.round(current + (base * rule.adjustValue) / 100);
    case 'fixed_cents':
      return current + Math.round(rule.adjustValue);
    case 'set_cents':
      return Math.round(rule.adjustValue);
  }
}

export function evaluatePrice(
  rules: PricingRule[],
  ctx: PriceContext,
  opts: { maxUpliftPct?: number; maxDiscountPct?: number } = {},
): PriceResult {
  const maxUplift = opts.maxUpliftPct ?? 25;
  const maxDiscount = opts.maxDiscountPct ?? 60;

  const candidates = rules
    .filter((r) => matches(r, ctx))
    // Loyalty protection: repeat customers never see surge on a service they
    // already buy from this shop. Discounts still apply.
    .filter(
      (r) =>
        !(
          ctx.isRepeatOfSameServiceWithin90d &&
          SURGE_KINDS.includes(r.kind) &&
          isUplift(r, ctx.basePriceCents)
        ),
    )
    .sort((a, b) => b.priority - a.priority);

  let price = ctx.basePriceCents;
  const applied: AppliedRule[] = [];
  let nonStackableUsed = false;

  for (const rule of candidates) {
    if (!rule.stackable && nonStackableUsed) continue;
    const before = price;
    let next = applyOne(rule, price, ctx.basePriceCents);
    if (rule.floorCents !== undefined) next = Math.max(next, rule.floorCents);
    if (rule.ceilingCents !== undefined) next = Math.min(next, rule.ceilingCents);
    if (next === before) continue;
    price = next;
    applied.push({ ruleId: rule.id, name: rule.name, kind: rule.kind, deltaCents: next - before });
    if (!rule.stackable) nonStackableUsed = true;
  }

  const hardCeiling = Math.round(ctx.basePriceCents * (1 + maxUplift / 100));
  const hardFloor = Math.round(ctx.basePriceCents * (1 - maxDiscount / 100));
  const clampedPrice = Math.min(Math.max(price, hardFloor), hardCeiling);

  // The trail is persisted to booking_item.applied_rules and rendered as the
  // customer's price breakdown. If the cap silently swallowed part of the
  // uplift, the breakdown would not sum to what they are charged — so the cap
  // gets its own line, exactly like any other adjustment.
  if (clampedPrice !== price) {
    applied.push({
      ruleId: 'platform_cap',
      name: clampedPrice < price ? `Platform cap (max +${maxUplift} %)` : `Platform floor (max −${maxDiscount} %)`,
      kind: 'seasonal',
      deltaCents: clampedPrice - price,
    });
  }

  return {
    basePriceCents: ctx.basePriceCents,
    finalPriceCents: Math.max(clampedPrice, 0),
    applied,
    clamped: clampedPrice !== price,
  };
}

/**
 * Cancellation / no-show fee, derived from the policy attached to the booking.
 * Returns cents to charge the customer and cents to refund.
 */
export function cancellationOutcome(params: {
  totalCents: number;
  paidCents: number;
  startsAt: number;
  cancelledAt: number;
  freeUntilHours: number;
  lateFeePercent: number;
  noShowFeePercent: number;
  isNoShow: boolean;
  cancelledBy: 'customer' | 'shop';
}): { feeCents: number; refundCents: number; reason: string } {
  // A no-show is recorded *by* the shop but is the customer's miss, so it is
  // checked before the shop branch — otherwise the no-show fee could never be
  // charged, since only a shop ever marks one.
  if (params.isNoShow) {
    // Capped once and reused: no_show_fee_percent is numeric(5,2), so a shop can
    // set 150 %. Charging the cap but refunding against the uncapped figure
    // would quietly short the customer.
    const fee = Math.min(
      Math.round((params.totalCents * params.noShowFeePercent) / 100),
      params.totalCents,
    );
    return {
      feeCents: fee,
      refundCents: Math.max(params.paidCents - fee, 0),
      reason: 'no_show',
    };
  }
  // The shop calling off an appointment is the shop's problem, never the
  // customer's money.
  if (params.cancelledBy === 'shop') {
    return { feeCents: 0, refundCents: params.paidCents, reason: 'shop_cancelled_full_refund' };
  }
  const hoursNotice = (params.startsAt - params.cancelledAt) / 3_600_000;
  if (hoursNotice >= params.freeUntilHours) {
    return { feeCents: 0, refundCents: params.paidCents, reason: 'within_free_window' };
  }
  const fee = Math.min(
    Math.round((params.totalCents * params.lateFeePercent) / 100),
    params.totalCents,
  );
  return {
    feeCents: fee,
    refundCents: Math.max(params.paidCents - fee, 0),
    reason: 'late_cancellation',
  };
}
