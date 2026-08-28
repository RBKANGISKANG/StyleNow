/**
 * Prime times.
 *
 * A prime appointment is a peak slot that costs more — Friday evening, Saturday
 * morning, the senior colourist. The shop already expresses exactly that
 * through its pricing rules, and the engine already returns both the base price
 * and the names of the rules that moved it. So Prime is *derived* from what the
 * engine charged rather than stored as a second flag: a label computed from the
 * price can never disagree with the price, and a shop that edits its evening
 * rule does not then have to remember to edit a "prime" list as well.
 *
 * The point of naming it is honesty. A slot that silently costs eight euros
 * more reads as a pricing bug; the same slot labelled Prime, with the reason
 * shown and the base price beside it, is an upgrade the customer can accept or
 * step around. Which is also why the cheaper slots stay labelled too — if only
 * the dear ones were marked, the label would be a sales tactic.
 */

export interface PricedSlot {
  priceCents: number;
  basePriceCents: number;
  appliedNames?: string[];
}

export type SlotTone = 'prime' | 'saver' | 'base';

/**
 * A couple of euros of rounding is not a tier. The threshold keeps single-cent
 * drift out of the badge, so "Prime" always means a difference worth choosing
 * between.
 */
const MEANINGFUL_CENTS = 200;

export function slotTone(s: PricedSlot): SlotTone {
  const delta = s.priceCents - s.basePriceCents;
  if (delta >= MEANINGFUL_CENTS) return 'prime';
  if (delta <= -MEANINGFUL_CENTS) return 'saver';
  return 'base';
}

/** What the customer pays above (or below) the listed price, in cents. */
export function slotDelta(s: PricedSlot): number {
  return s.priceCents - s.basePriceCents;
}

/**
 * Why this slot costs what it does, in the shop's own words — these are the
 * rule names the operator typed, which is the answer to "why is this more?"
 * that the audit trail was built to give.
 */
export function slotReason(s: PricedSlot): string | null {
  const names = (s.appliedNames ?? []).filter(Boolean);
  return names.length > 0 ? names.join(' · ') : null;
}
