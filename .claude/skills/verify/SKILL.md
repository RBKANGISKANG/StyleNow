---
name: verify
description: Build, serve and drive the StyleNow web app (browser + API) to observe a change actually running. Use when verifying a diff at its real surface rather than via tests.
---

# Verifying StyleNow at runtime

Two surfaces, and most changes need both:

- **Local/static mode** (what the demo ships as): the browser is the whole
  backend — the engine runs in-page and state lives in `localStorage`.
- **Server mode** (`next dev`): holds are priced by API routes in the server
  process. A shop setting that never reaches this store is a promotion no
  customer can receive — always check a pricing/booking change here too.

## Build and serve

Static export — **run from the repo root**, and move the API routes aside
(they can't be statically exported):

```bash
BK=$(mktemp -d) && cp -r apps/web/src/app/api "$BK/" && rm -rf apps/web/src/app/api \
  && (cd apps/web && STATIC_EXPORT=1 PAGES_BASE_PATH=/StyleNow NEXT_PUBLIC_BACKEND=local npx next build) ; \
  cp -r "$BK/api" apps/web/src/app/
```

Serve it under the `/StyleNow` base path (symlink, then `serve`):

```bash
mkdir -p <scratch>/serve && ln -sfn $PWD/apps/web/out <scratch>/serve/StyleNow
(cd <scratch>/serve && nohup npx serve -l 8211 &)   # → http://localhost:8211/StyleNow/
```

Server mode, for the API routes: `(cd apps/web && npx next dev -p 8311)`.

## Drive the browser

`playwright-core` with the preinstalled browser:
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`.

**Do the whole journey in ONE browser context.** `storageState` does not
reliably carry this app's `localStorage` between contexts — a restored
context can come up with an empty store and make a working feature look
broken. Everything (owner setup → customer booking → floor view) shares the
same store in local mode, so one context is also the realistic simulation.

### Selectors that actually work

| Thing | Selector |
|---|---|
| Connect a demo shop | `/dashboard/` → `selectOption('select', {label: '🎨 Chroma Studio Mitte'})`, then wait ~6s |
| Service picker | `.pick-row` (buttons, not labels/checkboxes) |
| Booking-page slots | buttons matching `/\d{2}:\d{2}/` — **unanchored**: the text is `SAVER\n17:00\n€52.00` |
| Day chips | buttons matching `/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\d+$/i` |
| Move dialog (dashboard) | row `Move` opens a drawer → click `↔ Move` inside `.cd-backdrop`; set `input[type=date]`; slot buttons read `09:00€49.00` |
| Shop settings panels | `section` filtered by its `h2` (e.g. `h2` hasText `Bundle`) |
| Inbox rows | `.inbox-row` (both customer and shop) |

### Paying (demo checkout)

Click `Card`, fill the three inputs by placeholder (`Card number` →
`4242424242424242`, `MM/YY` → `12/30`, `CVC` → `123`), then
`Pay & confirm`.

## Gotchas

- **Booking lead times differ per shop.** Schwarzwerk (tattoo) has a 4-hour
  lead, so "today" is often unbookable in the afternoon — step to a later
  day chip. Chroma Mitte usually has one late slot today.
- **Seeded days fill up**, so the move dialog often says "No free slots this
  day" for the current date; set the date input forward a few days.
- To prove a roster-derived filter (e.g. "Open now") is not a no-op, create
  the condition: add a closing day for today in the shop dashboard and watch
  the shop drop out of the filtered feed.
- Reading state directly is fine as corroboration:
  `JSON.parse(localStorage.getItem('sn-state-v1'))`.

## Useful API probes (server mode, :8311)

```bash
curl -s "localhost:8311/api/availability?shopId=shop-chroma-mitte&serviceIds=svc-cm-cut,svc-cm-blowdry&date=YYYY-MM-DD&deviceId=dev"
curl -s -X POST -H 'content-type: application/json' -H 'idempotency-key: k1' \
  -d '{"shopId":"...","serviceIds":["svc-cm-cut","svc-cm-blowdry"],"startsAt":<ms>,"deviceId":"dev","guestName":"T"}' \
  localhost:8311/api/bookings/hold
curl -s localhost:8311/api/shop/<id>/overview   # the floor's view: occasion, lateByMin, status
```

Service ids follow `svc-<shop>-<slug>` (`svc-cm-cut`, `svc-cm-blowdry`,
`svc-ec-consult` …) — grep `seed.ts`; an unknown id is silently dropped from
a basket, which looks like a pricing bug if you don't notice.
