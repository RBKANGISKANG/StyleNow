/**
 * StyleNow — availability engine (pure, dependency-free).
 *
 * The database owns truth (EXCLUDE constraints on staff_occupancy /
 * resource_occupancy make double-booking physically impossible). This module
 * owns *speed*: it projects free slots from a small, cacheable set of inputs so
 * the discovery feed can answer "who is free at 15:00 near me" in one Redis hop.
 *
 * Everything here works in UTC epoch-milliseconds. Local-time conversion
 * happens at the edges (shop.timezone), never in the middle of the maths.
 */

export interface Interval {
  /** inclusive start, epoch ms */
  start: number;
  /** exclusive end, epoch ms */
  end: number;
}

export interface ShopBookingRules {
  slotGranularityMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** minimum notice before an appointment may start */
  bookingLeadMin: number;
  /** how far ahead the calendar is open */
  bookingHorizonDays: number;
}

export interface ServiceTiming {
  durationMin: number;
  /** colour develops — the chair is held, the stylist is not */
  processingGapMin: number;
  finishMin: number;
}

export interface StaffDay {
  staffId: string;
  /** working windows for the day, already resolved from shifts + overrides */
  working: Interval[];
  /** everything that blocks the stylist: bookings, breaks, absences, travel */
  busy: Interval[];
}

export interface Slot {
  staffId: string;
  start: number;
  end: number;
  /** window actually reserved, including buffers */
  occupancy: Interval;
}

const MIN = 60_000;

export const totalServiceMinutes = (s: ServiceTiming): number =>
  s.durationMin + s.processingGapMin + s.finishMin;

/** Merge overlapping/adjacent intervals into a normalised, sorted list. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0] }];
  for (const cur of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** Subtract `busy` from `base`, returning the free remainder. */
export function subtractIntervals(base: Interval[], busy: Interval[]): Interval[] {
  const blocks = mergeIntervals(busy);
  const free: Interval[] = [];
  for (const window of base) {
    let cursor = window.start;
    for (const b of blocks) {
      if (b.end <= cursor || b.start >= window.end) continue;
      if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, window.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= window.end) break;
    }
    if (cursor < window.end) free.push({ start: cursor, end: window.end });
  }
  return free.filter((f) => f.end > f.start);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The window(s) a booking actually blocks on the *stylist's* calendar.
 *
 * A colour service is 30 min of application, 40 min of development, 20 min of
 * finishing. The chair is held for 90 minutes; the stylist is genuinely free for
 * 40 of them, and in a real salon they use that gap for a cut. So a service with
 * a processing gap produces TWO occupancy rows, not one — which is exactly what
 * `staff_occupancy` is shaped to store.
 *
 * The resource (chair, basin, room) is blocked contiguously; see
 * `resourceOccupancy` below.
 */
export function staffOccupancy(
  start: number,
  service: ServiceTiming,
  rules: ShopBookingRules,
): Interval[] {
  const before = rules.bufferBeforeMin * MIN;
  const after = rules.bufferAfterMin * MIN;
  const application = start + service.durationMin * MIN;
  if (service.processingGapMin <= 0) {
    return [{ start: start - before, end: application + service.finishMin * MIN + after }];
  }
  const finishStart = application + service.processingGapMin * MIN;
  return [
    { start: start - before, end: application },
    { start: finishStart, end: finishStart + service.finishMin * MIN + after },
  ];
}

/** The contiguous window the chair / basin / room is held for. */
export function resourceOccupancy(
  start: number,
  service: ServiceTiming,
  rules: ShopBookingRules,
): Interval {
  return {
    start: start - rules.bufferBeforeMin * MIN,
    end: start + totalServiceMinutes(service) * MIN + rules.bufferAfterMin * MIN,
  };
}

/**
 * Project bookable slots for one staff member on one day.
 *
 * The candidate grid is anchored to the start of the *working window*, not to
 * the start of each free fragment and not to an absolute epoch grid. This
 * matters: `find_free_slots()` in SQL anchors the same way, and the two
 * implementations are required to agree slot-for-slot. Anchoring to an epoch
 * grid silently diverges for any shift that does not start on a granularity
 * boundary (08:50 opening, 15-minute slots) or any timezone with a sub-hour
 * offset.
 *
 * `now` is injected rather than read from the clock so the function stays pure
 * and the lead-time rule is testable.
 */
export function slotsForStaff(
  day: StaffDay,
  service: ServiceTiming,
  rules: ShopBookingRules,
  now: number,
): Slot[] {
  const serviceMs = totalServiceMinutes(service) * MIN;
  const before = rules.bufferBeforeMin * MIN;
  const after = rules.bufferAfterMin * MIN;
  const step = Math.max(rules.slotGranularityMin, 1) * MIN;
  const earliest = now + rules.bookingLeadMin * MIN;
  const horizon = now + rules.bookingHorizonDays * 24 * 60 * MIN;

  const windows = mergeIntervals(day.working);
  const busy = mergeIntervals(day.busy);
  const slots: Slot[] = [];

  for (const window of windows) {
    const last = window.end - serviceMs - after;
    for (let start = window.start + before; start <= last; start += step) {
      if (start < earliest || start > horizon) continue;
      const held = staffOccupancy(start, service, rules);
      if (held.some((h) => busy.some((b) => overlaps(h, b)))) continue;
      slots.push({
        staffId: day.staffId,
        start,
        end: start + serviceMs,
        occupancy: resourceOccupancy(start, service, rules),
      });
    }
  }
  return slots;
}

/**
 * Collapse per-staff slots into the customer-facing time list.
 * "Any available stylist" picks the least-loaded staff member for each time,
 * which spreads work across the team instead of hammering the first one.
 */
export function aggregateSlots(
  perStaff: Slot[],
  loadByStaff: Record<string, number> = {},
): Array<{ start: number; end: number; staffIds: string[]; suggestedStaffId: string }> {
  const byStart = new Map<number, Slot[]>();
  for (const s of perStaff) {
    const bucket = byStart.get(s.start);
    if (bucket) bucket.push(s);
    else byStart.set(s.start, [s]);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, group]) => {
      const suggested = [...group].sort(
        (a, b) => (loadByStaff[a.staffId] ?? 0) - (loadByStaff[b.staffId] ?? 0),
      )[0];
      return {
        start,
        end: group[0].end,
        staffIds: group.map((g) => g.staffId),
        suggestedStaffId: suggested.staffId,
      };
    });
}

/**
 * Mobile stylists: a slot is only real if the stylist can physically get from
 * the previous job to this address and on to the next one. Travel time is
 * modelled as an extra occupancy block on either side.
 */
export function applyTravelWindows(
  slots: Slot[],
  travel: { toMin: number; fromMin: number },
  busy: Interval[],
): Slot[] {
  const blocks = mergeIntervals(busy);
  return slots.filter((s) => {
    const withTravel: Interval = {
      start: s.occupancy.start - travel.toMin * MIN,
      end: s.occupancy.end + travel.fromMin * MIN,
    };
    return !blocks.some((b) => overlaps(withTravel, b));
  });
}
