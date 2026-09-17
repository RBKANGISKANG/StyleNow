---
name: stylenow-engine
description: How StyleNow's domain engine (apps/web/src/core/store.ts) is built and the complete checklist for adding a feature to it — state map, persistence, ShopConfig sync, the three-transport API wrapper, EN+DE i18n, and tests. Use this whenever you are adding, changing or reviewing anything in store.ts, api.ts, a dashboard panel, the booking flow, or any StyleNow feature at all — the wiring has six places that must agree, and missing one produces a feature that works in the demo and silently does nothing in server mode or after a reload.
---

# Working inside the StyleNow engine

`apps/web/src/core/store.ts` is the whole domain: availability, the seat
contract, pricing, money products, the shop floor. It runs **in the browser**
in local/static mode and **in the server process** in server mode. That dual
life is the source of almost every defect found in review here, so the
conventions below exist to keep the two honest.

## The house rules

**Derive, don't store.** A number you can compute from bookings should be
computed. Uses left on a prepaid card, a shop's occupancy, how late the day is
running — all derived, so they cannot drift out of sync with reality. Store
only what a human decided (a price, a percent, a note) or what happened (a
booking, a signature).

**The engine is the gate, never the UI.** Every rule the UI enforces must be
enforced again in `createHold`/the engine function. The UI disabling a button
is a courtesy; the throw is the contract. Reviews here repeatedly find bypass
routes through duo/group seats, `forPersonId`, shop-created bookings and the
server routes — check all of them when you add a gate.

**Freeze what was agreed.** Consent text, policy snapshots and price
breakdowns are copied onto the booking at the time, not looked up later. If
the shop edits the wording tomorrow, what somebody signed yesterday must not
change underneath them.

**Percentage perks compound on the remaining payable**, never on the gross
subtotal — see `applyPercentPerk` in `createHold`. Additive stacking let three
perks give the work away. Gift cards clamp to what is still owed.

## Adding a feature: the six places

Miss one and the feature half-works in a way tests won't catch. In order:

1. **State** — add the map to the `State` interface *and* the initialiser.
   ```ts
   retailItems: Map<string, RetailItem[]>; // shopId → the shelf, priced for the till
   ```
2. **Persistence** — add it to the `persist()` snapshot, the hydrate type, and
   the hydrate assignment. Three separate edits; grep an existing map name
   (e.g. `bundleDiscounts`) to find all three sites at once.
3. **ShopConfig** — if a *shop* owns the data, add it to the `ShopConfig`
   interface, `exportShopConfig`, and `applyShopConfig`. Two traps that have
   both bitten here:
   - **Export "off" explicitly** (`?? 0`, `?? ''`), because `undefined` is
     dropped by JSON and `applyShopConfig` then reads it as "no change" — a
     cancelled promotion comes back from the dead on a tablet that still holds
     the old value.
   - **Clamp on apply.** A synced document is untrusted input; validate it the
     same way the owner's own setter does.
4. **API wrapper** in `apps/web/src/lib/api.ts` — and check all three
   transports. `backendMode()` is `'server'` by default when Supabase is
   unconfigured, so a wrapper that only calls the local store is **inert in
   the default deployment**:
   ```ts
   if (backendMode() === 'server') { /* fetch an /api route */ }
   await localWrite(); store.doThing(); syncConfig(shopId);   // local
   if (backendMode() === 'supabase') await sb.pushBooking(b); // booking data
   ```
   Rule of thumb: data the *shop* owns syncs with `syncConfig`; data on a
   *booking* needs `sb.pushBooking`. Anything that must reach the pricing
   engine or another device needs a real `/api` route.
5. **i18n** — `apps/web/src/lib/i18n.tsx` has one EN object and one DE object
   that must carry identical keys; `MsgKey` is derived from EN, so a missing
   key is a compile error (that safety net is deliberate — let it work for
   you). Check for an existing key before inventing one: duplicate keys inside
   a catalogue are a `TS1117` error, and prefixes collide (`lb_` was already
   the handover book).
6. **Tests** — `apps/web/src/core/__tests__/payments.test.ts` is the
   integration suite. Assert the *refusals* as much as the happy path; that is
   where the value is.

## Writing tests against seeded data

The demo seeds six weeks of history, so days fill up and shops differ:

- Loop days to find a free slot (`for (let d = 1; d <= 21 …)`) rather than
  assuming tomorrow is free; widen to ~45 days for shops with long booking
  leads (Schwarzwerk has a 4-hour lead and a Tue–Sat roster).
- `allShops()[0]` is often fully booked today — take a later day or another
  shop.
- `allShops()` returns raw seeds; `effectiveServices(shopId)` returns the menu
  with shop overrides applied. Assert against the latter.
- Fixture surgery (moving a booking's `startsAt` directly) is accepted in this
  suite for time-dependent behaviour — follow the existing blocks and say so
  in a comment.
- Bookings carry `staffRanges` that can extend past `endsAt` (the finish
  segment), so "immediately after" means after the last range, not after
  `endsAt`.

## Related skills

- `verify` — how to build, serve and drive the app to watch a change actually
  run. Use it before claiming a feature works.
- `ship-round` — the full per-round loop this repo has settled into, including
  the adversarial review gate.
