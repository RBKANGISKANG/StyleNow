# Offline mode — the contract

The mobile app is usable on the U-Bahn. That means three guarantees.

## 1 · Read: a local mirror, not a cache

WatermelonDB (SQLite) holds `bookings`, `favourites`, `shops` (visited only),
`services`, and the user profile. `GET /sync/pull?since=<cursor>` returns
changes + tombstones + a new cursor. The cursor is a server-issued opaque
string (a logical clock), never a client timestamp — clients lie about time.

Cold start with no network renders the mirror instantly; a stale banner appears
once the mirror is older than 15 minutes.

## 2 · Write: a durable mutation queue

Actions taken offline (`booking.cancel`, `review.create`, `favourite.toggle`,
`waitlist.join`, `profile.update`) go into an append-only queue with a
client-generated `client_id`. On reconnect, `POST /sync/push` replays them in
order under one `Idempotency-Key`.

Notably absent: **`booking.create` cannot be queued.** A slot held on a device
with no network is a slot sold twice. The UI is explicit about this — offline,
the booking button becomes "Save for later", which pre-fills the sheet and
re-checks availability the moment connectivity returns.

## 3 · Conflict resolution: server wins, user is told

`/sync/push` returns per-mutation `applied | conflict | rejected`. A conflict
carries the current server state so the app can show a specific message —
"Your 15:00 cut was already cancelled by the salon" — rather than a generic
sync error. Rejected mutations are surfaced once and dropped.

## Stylist app additions

- Location pings are batched (30 s cadence, 200-ping envelope) and survive
  process death in a WAL. `POST /trips/{id}/pings` accepts them out of order.
- The day's schedule is pre-fetched at 05:00 local so a stylist without signal
  at a client's flat still knows where to be next.
- Check-in / complete / no-show are queued mutations — the stylist is never
  blocked by connectivity from closing out a job.
