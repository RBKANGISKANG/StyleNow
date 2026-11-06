# Sales leads

`wandsbek-leads.csv` — 291 beauty businesses (hair, beauty/nails, massage, tattoo) in Bezirk Wandsbek, Hamburg.

- **Base data:** OpenStreetMap (© OpenStreetMap contributors, ODbL). Missing addresses were reverse-geocoded from the map position.
- **Enrichment:** each business was looked up on the web. Websites, phones and emails come from the business's own site or Impressum, or from public directory listings (Fresha, Treatwell, dasoertliche, Gelbe Seiten). The `source` column gives the URLs. Emails were never guessed.
- **No photos** are included. A salon's photos belong to the salon, so it uploads its own when it signs up.

Columns: `id, name, category, street, postcode, district, city, phone, email, website, instagram, owner_name, opening_hours, status, lat, lon, source, note`

Import into a running server (or use **Admin → Leads → Import**):

    npm run leads:import -- db/leads/wandsbek-leads.csv --url https://your-site --key $STYLENOW_ADMIN_KEY

Before you contact anyone, check these:
- In Germany, emailing a business that never agreed to it can count as unlawful advertising (UWG §7). Calling a business is allowed only if you can assume it would want the call. A personal visit, a letter, or a call to a salon that has shown interest is the safer first step.
- Some emails are freemail addresses. The business publishes them itself, but they may be the owner's personal inbox.
- Status is `new` for everything that wasn't confirmed closed. A few entries are marked as possibly outdated in the research notes.
