# Design canvas

Static mockups for the customer and operator surfaces, published as a Claude
Design canvas: <https://claude.ai/code/artifact/d38eda96-9505-4bc7-9f80-b0af94c830b0>

Each `*.dc.html` is one artboard; `canvas.json` places them and names the three
pages (Customer, Operator & system, Staff & gaps).

Everything here is matched to the shipped tokens in
`apps/web/src/app/globals.css` — Poppins/Inter, coral `#f0566e` on cream
`#fff9f3`, teal/amber/violet accents, radii 12/16/22/28. Values are copied, not
rounded to a grid, so the mockups and the app cannot drift apart quietly.

## Boards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | Shop landing page — cover, next-free rail, services, hours, team, reviews |
| `Discovery.dc.html` | Home feed — search hero, filters, tonight rail, result cards |
| `Booking.dc.html` | Pick a time — day strip with occupancy, slots by part of day, the hold bar |
| `Confirmed.dc.html` | Booked — ticket, add-to-calendar, cancellation terms |
| `Today.dc.html` | Back office Today — briefing, next up, the day's chairs |
| `Calendar.dc.html` | Week calendar with the appointment popup anchored beside the booking |
| `System.dc.html` | Colour, type, controls, the icon set, and what this pass changed |
| `StaffDay.dc.html` | Employee calendar — one stylist's day, their gaps, their next client |
| `StaffWeek.dc.html` | Employee calendar — the week, as sold hours against rostered hours |
| `Waitlist.dc.html` | Working the waiting list: people waiting, gaps that fit, what the pairing is worth |
| `StaffPhone.dc.html` | A stylist checking their own day on a phone |

## Two things that are proposals, not descriptions

- The cover on `Main` is a **marked placeholder**. A salon page wants real
  photography there; it is the biggest remaining gap on that screen.
- The left sidebar on the operator boards **departs from the shipped app**,
  which uses a seven-tab bar. A tab bar is a customer-app pattern; a tool open
  all day wants a persistent spine with room for live counts.
- The whole **Staff & gaps** page is proposal, not description: none of it is
  built yet. The employee calendar reframes a week as sold-against-rostered
  hours, which turns "Thursday is quiet" into "Thursday is eight paid hours
  nobody bought"; the waiting-list board is where that number gets acted on.
  The app already says "2 on the waiting list can be called" and gives nobody
  anywhere to call them.

Numbers on these boards are sample values consistent with the demo shop, not
measurements.

## Re-publishing

The published page has the editor baked in, so it is a build artifact and is
gitignored. Rebuild it from these files with the `/design` skill's helper, then
publish to the URL above (updating in place rather than creating a new canvas).
