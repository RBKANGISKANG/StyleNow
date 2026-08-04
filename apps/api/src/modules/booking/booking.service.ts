/**
 * StyleNow — booking service.
 *
 * The one flow that must never be wrong. Three properties are non-negotiable:
 *
 *  1. No double-booking, ever. Guaranteed by the database, not by application
 *     logic: `staff_occupancy` and `resource_occupancy` carry GiST EXCLUDE
 *     constraints, so two concurrent transactions inserting overlapping ranges
 *     end with one of them raising 23P01 (exclusion_violation).
 *
 *     Catching that is subtler than it looks. A failed statement poisons the
 *     whole transaction — every subsequent query returns 25P02
 *     ("current transaction is aborted"). So the insert runs inside a SAVEPOINT
 *     and the catch rolls back to it before looking up alternatives. Without the
 *     savepoint the friendly "here are six other times" response is unreachable
 *     and the user gets a 500.
 *
 *  2. No charge without a seat, no seat without a charge. The hold is written
 *     and committed first; the payment intent is opened only afterwards, outside
 *     the lock, because a PSP round trip inside a SERIALIZABLE transaction holds
 *     row locks across a network call to a third party. A crash between the two
 *     resolves to "hold expires, money never taken" — the safe direction.
 *
 *  3. Idempotency. Every mutating booking call takes an Idempotency-Key, stored
 *     with the response, so a retry on a flaky mobile connection returns the
 *     original booking rather than a second one.
 *
 * Notifications go through the transactional outbox (`notification_outbox`),
 * written inside the same transaction as the state change. A direct call after
 * commit would lose the confirmation on a crash — and, worse, an enqueue before
 * a rollback would send an SMS for a booking that does not exist.
 *
 * `Db`, `Psp`, `Notifier` are ports; wire them to Prisma/pg, Stripe, and the
 * notification worker respectively.
 */

import {
  staffOccupancy,
  resourceOccupancy,
  type Interval,
  type ServiceTiming,
  type ShopBookingRules,
} from '../../domain/availability.js';
import { evaluatePrice, cancellationOutcome, type PricingRule, type PriceContext } from '../../domain/pricing.js';

export class SlotTakenError extends Error {
  readonly code = 'SLOT_TAKEN';
  constructor(readonly alternatives: Array<{ start: number; staffId: string }>) {
    super('slot_taken');
  }
}
export class HoldExpiredError extends Error {
  readonly code = 'HOLD_EXPIRED';
}
export class QuoteExpiredError extends Error {
  readonly code = 'QUOTE_EXPIRED';
}

export interface CreateHoldInput {
  shopId: string;
  serviceIds: string[];
  variantIds?: string[];
  staffId?: string | null;
  startsAt: number;
  customerId?: string;
  /** Guest checkout. A phone number is the only hard requirement: it is what the
   *  shop calls if something goes wrong, and what the OTP was sent to. */
  guest?: { phone: string; name?: string; email?: string };
  locale: string;
  sessionId: string;
  isMobile?: boolean;
  serviceAddress?: { line1: string; postalCode: string; city: string; lat: number; lng: number };
  voucherCode?: string;
  loyaltyPointsToSpend?: number;
  /** Signed quote issued with the slot list; replayed here so the customer pays
   *  what they were shown even if the shop's rules changed in between. */
  priceQuoteId?: string;
  idempotencyKey: string;
}

export interface Quote {
  subtotalCents: number;
  travelFeeCents: number;
  discountCents: number;
  vatCents: number;
  totalCents: number;
  depositCents: number;
  breakdown: Array<{ label: string; cents: number }>;
}

export interface HoldResult {
  bookingId: string;
  reference: string;
  holdExpiresAt: number;
  quote: Quote;
  paymentIntentClientSecret: string | null;
}

/** Seconds a checkout seat is reserved before it is released back to the market. */
export const HOLD_TTL_SECONDS = 480; // 8 minutes — long enough for SCA/3-DS

export class BookingService {
  constructor(
    private readonly db: Db,
    private readonly psp: Psp,
    private readonly notifier: Notifier,
    private readonly clock: () => number = () => Date.now(),
    private readonly limits: { maxUpliftPct: number; maxDiscountPct: number } = {
      maxUpliftPct: 25,
      maxDiscountPct: 60,
    },
  ) {}

  /**
   * Step 1 of checkout: reserve the seat and price the basket in one short
   * transaction, then open the payment intent outside it.
   */
  async createHold(input: CreateHoldInput): Promise<HoldResult> {
    const cached = await this.db.findIdempotent<HoldResult>(input.idempotencyKey);
    if (cached) return cached;

    // ---- phase 1: seat + price, committed before anyone talks to Stripe ----
    const held = await this.db.transaction('serializable', async (tx) => {
      const shop = await tx.getShopRules(input.shopId);
      const services = await tx.getServices(input.serviceIds);
      const staffId =
        input.staffId ??
        (await tx.pickLeastLoadedStaff(input.shopId, input.serviceIds, input.startsAt));

      const staffRanges = occupancyForBasket(input.startsAt, services, shop);
      const chairRange = resourceOccupancy(input.startsAt, aggregate(services), shop);

      const booking = await tx.insertBooking({
        ...input,
        staffId,
        period: { start: input.startsAt, end: chairRange.end - shop.bufferAfterMin * 60_000 },
        occupancy: chairRange,
        status: 'hold',
        holdExpiresAt: this.clock() + HOLD_TTL_SECONDS * 1000,
      });

      // The savepoint is the whole point: 23P01 aborts the statement, not the
      // transaction, so we can still query for alternatives after rolling back.
      try {
        await tx.savepoint('seat', async () => {
          for (const range of staffRanges) {
            await tx.insertStaffOccupancy({
              staffId,
              bookingId: booking.id,
              occupancy: range,
              kind: range === staffRanges[0] ? 'booking' : 'processing',
            });
          }
        });
      } catch (e) {
        if (isExclusionViolation(e)) {
          const alternatives = await tx.nearbySlots(
            input.shopId,
            input.serviceIds,
            input.startsAt,
            6,
          );
          throw new SlotTakenError(alternatives);
        }
        throw e;
      }

      const quote = await this.price(tx, input, services, staffId, shop);
      await tx.attachQuote(booking.id, quote);
      return { booking, quote, shop };
    });

    // ---- phase 2: money, outside the lock ----
    const { booking, quote, shop } = held;
    const needsPayment = quote.totalCents > 0 && shop.onlinePaymentRequired;
    const chargeCents = shop.depositPercent > 0 ? quote.depositCents : quote.totalCents;

    let clientSecret: string | null = null;
    if (needsPayment) {
      const intent = await this.psp.createIntent({
        amountCents: chargeCents,
        currency: 'EUR',
        connectedAccountId: shop.stripeAccountId,
        // Fee follows the amount actually charged. Computing it off the booking
        // total while charging only a deposit makes the fee exceed the charge
        // and Stripe rejects the intent outright.
        applicationFeeCents: Math.round((chargeCents * shop.commissionBps) / 10_000),
        metadata: { bookingId: booking.id, shopId: input.shopId },
        idempotencyKey: `${input.idempotencyKey}:intent`,
      });
      clientSecret = intent.clientSecret;
      await this.db.transaction('read committed', (tx) =>
        tx.updateBooking(booking.id, { status: 'pending_payment' }),
      );
    }

    const result: HoldResult = {
      bookingId: booking.id,
      reference: booking.reference,
      holdExpiresAt: booking.holdExpiresAt,
      quote,
      paymentIntentClientSecret: clientSecret,
    };
    await this.db.saveIdempotent(input.idempotencyKey, result);

    // Zero-total bookings — fully covered by loyalty or a gift card, or a
    // pay-on-site shop — never touch the PSP and confirm straight away.
    if (!needsPayment) await this.confirm(booking.id, { actor: 'system' });
    return result;
  }

  /**
   * Step 2. Called by the client after SCA succeeds, and — authoritatively — by
   * the Stripe webhook. Both paths are idempotent; whichever lands first wins.
   */
  async confirm(bookingId: string, ctx: { actor: string }): Promise<void> {
    await this.db.transaction('read committed', async (tx) => {
      const b = await tx.lockBooking(bookingId);
      if (b.status === 'confirmed') return;
      if (b.status !== 'hold' && b.status !== 'pending_payment') throw new HoldExpiredError();
      if (b.holdExpiresAt && b.holdExpiresAt < this.clock() && b.status === 'hold') {
        throw new HoldExpiredError();
      }

      await tx.updateBooking(bookingId, {
        status: 'confirmed',
        confirmedAt: this.clock(),
        holdExpiresAt: null,
      });
      await tx.appendEvent(bookingId, { to: 'confirmed', actor: ctx.actor });
      await tx.releaseHold(bookingId);

      // Outbox rows are written in the same transaction as the status change.
      // A worker drains them, so a rollback cannot leak a "confirmed" SMS and a
      // crash after commit cannot lose one.
      await tx.enqueueOutbox([
        { kind: 'booking_confirmed', bookingId, channels: ['push', 'email'] },
        { kind: 'booking_reminder', bookingId, channels: ['push', 'sms', 'whatsapp'], offsetHours: -24 },
        { kind: 'booking_reminder', bookingId, channels: ['push'], offsetHours: -2 },
        { kind: 'review_request', bookingId, channels: ['push', 'email'], afterCompletionHours: 3 },
      ]);
    });
    await this.notifier.wake();
  }

  /**
   * Cancellation and no-show. Fee and refund come from the policy snapshot
   * stored on the booking, not from the shop's *current* policy — a shop cannot
   * tighten its terms after you have booked.
   */
  async cancel(
    bookingId: string,
    by: 'customer' | 'shop',
    reason: string,
    opts: { isNoShow?: boolean } = {},
  ): Promise<{ feeCents: number; refundCents: number; policyReason: string }> {
    const outcome = await this.db.transaction('read committed', async (tx) => {
      const b = await tx.lockBooking(bookingId);
      const policy = await tx.getPolicySnapshot(bookingId);

      // One cancellation engine, the tested one. A second inline implementation
      // here is how the no-show branch went missing the first time.
      const o = cancellationOutcome({
        totalCents: b.totalCents,
        paidCents: b.paidCents,
        startsAt: b.startsAt,
        cancelledAt: this.clock(),
        freeUntilHours: policy.freeUntilHours,
        lateFeePercent: policy.lateFeePercent,
        noShowFeePercent: policy.noShowFeePercent,
        isNoShow: opts.isNoShow ?? false,
        cancelledBy: by,
      });

      await tx.updateBooking(bookingId, {
        status: opts.isNoShow
          ? 'no_show'
          : by === 'customer'
            ? 'cancelled_by_customer'
            : 'cancelled_by_shop',
        cancelledAt: this.clock(),
        cancelledReason: reason,
        cancellationFeeCents: o.feeCents,
      });

      // Deleting by booking id is why staff_occupancy carries one: a colour
      // service holds two rows, and leaving either behind blocks the stylist
      // forever and starves the waitlist.
      await tx.deleteOccupancyForBooking(bookingId);
      await tx.appendEvent(bookingId, { to: 'cancelled', actor: by, reason });
      await tx.enqueueOutbox([
        { kind: 'booking_cancelled', bookingId, channels: ['push', 'sms', 'email'] },
      ]);
      await tx.enqueueWaitlistFill(b.shopId, b.occupancy);
      return o;
    });

    if (outcome.refundCents > 0) {
      await this.psp.refund({ bookingId, amountCents: outcome.refundCents, reason });
    }
    await this.notifier.wake();
    return { ...outcome, policyReason: outcome.reason };
  }

  private async price(
    tx: Tx,
    input: CreateHoldInput,
    services: ServiceRow[],
    staffId: string,
    shop: ShopConfig,
  ): Promise<Quote> {
    if (input.priceQuoteId) {
      const q = await tx.consumeQuote(input.priceQuoteId, input);
      if (!q) throw new QuoteExpiredError();
      return q;
    }

    const rules: PricingRule[] = await tx.getPricingRules(input.shopId);
    const ctxBase = await tx.getPriceContext(input, staffId);
    const breakdown: Array<{ label: string; cents: number }> = [];
    let subtotal = 0;
    let vat = 0;

    for (const s of services) {
      const ctx: PriceContext = { ...ctxBase, basePriceCents: s.basePriceCents };
      const r = s.dynamicPricing
        ? evaluatePrice(rules, ctx, this.limits)
        : { finalPriceCents: s.basePriceCents, applied: [], basePriceCents: s.basePriceCents, clamped: false };
      subtotal += r.finalPriceCents;
      // VAT per item, from the service's own rate. Germany has a reduced rate,
      // and a hardcoded 19 % divisor mis-posts the §14 UStG invoice the moment a
      // shop sells anything that qualifies for it.
      vat += Math.round((r.finalPriceCents * s.vatRateBps) / (10_000 + s.vatRateBps));
      breakdown.push({ label: s.name, cents: r.finalPriceCents });
      for (const a of r.applied) breakdown.push({ label: a.name, cents: a.deltaCents });
    }

    const travelFeeCents = input.isMobile
      ? await tx.travelFee(input.shopId, input.serviceAddress!)
      : 0;
    if (travelFeeCents) breakdown.push({ label: 'Travel', cents: travelFeeCents });

    const discountCents = await tx.applyDiscounts(input, subtotal);
    if (discountCents) breakdown.push({ label: 'Discount', cents: -discountCents });

    const total = Math.max(subtotal + travelFeeCents - discountCents, 0);
    const depositCents = Math.round((total * shop.depositPercent) / 100);

    return {
      subtotalCents: subtotal,
      travelFeeCents,
      discountCents,
      vatCents: vat,
      totalCents: total,
      depositCents,
      breakdown,
    };
  }
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

/** Collapse a multi-service basket into one timing envelope. */
export function aggregate(services: ServiceTiming[]): ServiceTiming {
  return services.reduce<ServiceTiming>(
    (acc, s) => ({
      durationMin: acc.durationMin + s.durationMin,
      processingGapMin: acc.processingGapMin + s.processingGapMin,
      finishMin: acc.finishMin + s.finishMin,
    }),
    { durationMin: 0, processingGapMin: 0, finishMin: 0 },
  );
}

/**
 * The stylist-side occupancy for a basket. A single service with a processing
 * gap yields two ranges (application, then finishing) leaving the development
 * time genuinely free — which is what lets a colourist interleave a cut, exactly
 * as they do in a real salon.
 */
export function occupancyForBasket(
  startsAt: number,
  services: ServiceTiming[],
  rules: ShopBookingRules,
): Interval[] {
  if (services.length === 1) return staffOccupancy(startsAt, services[0], rules);
  return staffOccupancy(startsAt, aggregate(services), rules);
}

export function isExclusionViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23P01';
}

// --------------------------------------------------------------------------
// ports (implemented in infrastructure/)
// --------------------------------------------------------------------------

interface ServiceRow extends ServiceTiming {
  id: string;
  name: string;
  basePriceCents: number;
  vatRateBps: number;
  dynamicPricing: boolean;
}
interface ShopConfig extends ShopBookingRules {
  stripeAccountId: string;
  commissionBps: number;
  depositPercent: number;
  onlinePaymentRequired: boolean;
}
interface BookingRow {
  id: string;
  shopId: string;
  status: string;
  startsAt: number;
  totalCents: number;
  paidCents: number;
  holdExpiresAt: number | null;
  occupancy: Interval;
}
interface PolicySnapshot {
  freeUntilHours: number;
  lateFeePercent: number;
  noShowFeePercent: number;
}
interface Tx {
  /** Runs `fn` inside a SAVEPOINT; on error, rolls back to it so the outer
   *  transaction stays usable. This is what makes the 409-with-alternatives
   *  response possible after an exclusion violation. */
  savepoint<T>(name: string, fn: () => Promise<T>): Promise<T>;
  getShopRules(shopId: string): Promise<ShopConfig>;
  getServices(ids: string[]): Promise<ServiceRow[]>;
  pickLeastLoadedStaff(shopId: string, serviceIds: string[], startsAt: number): Promise<string>;
  insertStaffOccupancy(row: {
    staffId: string;
    bookingId: string;
    occupancy: Interval;
    kind: string;
  }): Promise<void>;
  deleteOccupancyForBooking(bookingId: string): Promise<void>;
  nearbySlots(
    shopId: string,
    serviceIds: string[],
    around: number,
    n: number,
  ): Promise<Array<{ start: number; staffId: string }>>;
  insertBooking(data: unknown): Promise<{ id: string; reference: string; holdExpiresAt: number }>;
  attachQuote(bookingId: string, quote: Quote): Promise<void>;
  consumeQuote(quoteId: string, input: CreateHoldInput): Promise<Quote | null>;
  lockBooking(id: string): Promise<BookingRow>;
  updateBooking(id: string, patch: Record<string, unknown>): Promise<void>;
  appendEvent(id: string, event: Record<string, unknown>): Promise<void>;
  releaseHold(bookingId: string): Promise<void>;
  enqueueOutbox(jobs: Array<Record<string, unknown>>): Promise<void>;
  getPolicySnapshot(bookingId: string): Promise<PolicySnapshot>;
  getPricingRules(shopId: string): Promise<PricingRule[]>;
  getPriceContext(input: CreateHoldInput, staffId: string): Promise<Omit<PriceContext, 'basePriceCents'>>;
  travelFee(shopId: string, address: NonNullable<CreateHoldInput['serviceAddress']>): Promise<number>;
  applyDiscounts(input: CreateHoldInput, subtotal: number): Promise<number>;
  enqueueWaitlistFill(shopId: string, occupancy: Interval): Promise<void>;
}
interface Db {
  transaction<T>(level: 'serializable' | 'read committed', fn: (tx: Tx) => Promise<T>): Promise<T>;
  findIdempotent<T>(key: string): Promise<T | null>;
  saveIdempotent(key: string, value: unknown): Promise<void>;
}
interface Psp {
  createIntent(args: Record<string, unknown>): Promise<{ clientSecret: string }>;
  refund(args: { bookingId: string; amountCents: number; reason: string }): Promise<void>;
}
interface Notifier {
  /** Nudges the outbox worker to drain immediately instead of waiting for its
   *  next poll. Purely a latency optimisation — correctness lives in the table. */
  wake(): Promise<void>;
}
