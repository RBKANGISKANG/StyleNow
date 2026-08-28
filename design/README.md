# Design canvas

Static mockups for the customer and operator surfaces, published as a Claude
Design canvas: <https://claude.ai/code/artifact/d38eda96-9505-4bc7-9f80-b0af94c830b0>

Each `*.dc.html` is one artboard; `canvas.json` places them and names the two
pages (Customer, Operator & system).

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

## Two things that are proposals, not descriptions

- The cover on `Main` is a **marked placeholder**. A salon page wants real
  photography there; it is the biggest remaining gap on that screen.
- The left sidebar on the operator boards **departs from the shipped app**,
  which uses a seven-tab bar. A tab bar is a customer-app pattern; a tool open
  all day wants a persistent spine with room for live counts.

## Re-publishing

The published page has the editor baked in, so it is a build artifact and is
gitignored. Rebuild it from these files with the `/design` skill's helper, then
publish to the URL above (updating in place rather than creating a new canvas).
