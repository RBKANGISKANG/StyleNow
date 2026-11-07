# Going live — server setup

The server build (`npm run build && npm run start` in `apps/web`) is the real product: logins, salon-only routes, payments, emails. Static builds (GitHub Pages, Android app) are demos that run in the browser.

## Environment variables

| Variable | Needed | What it does |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres (e.g. Supabase → Project settings → Database → connection string). Without it data is written to a local file. |
| `STYLENOW_SESSION_SECRET` | **yes** | Long random string that signs login cookies (`openssl rand -base64 32`). If missing, one is generated and kept in the database. |
| `STYLENOW_ADMIN_KEY` | **yes** | Password for `/admin`. |
| `NEXT_PUBLIC_SITE_ORIGIN` | **yes** | Public address, e.g. `https://stylenow.de` — used in email links and Stripe redirects. |
| `MAIL_FROM` | for email | e.g. `StyleNow <hallo@stylenow.de>` |
| `RESEND_API_KEY` **or** `SMTP_URL` | for email | Resend API key, or any SMTP server: `smtps://user:pass@smtp.ionos.de:465` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | optional | SMS confirmations + reminders |
| `STYLENOW_REMINDER_HOURS` | optional | Reminder lead time, default 24 |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | for payments | Stripe keys. Webhook events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`. Enable Connect → **Custom** accounts. |

Leave `NEXT_PUBLIC_BACKEND` unset on a server deployment (the default is the server). Static builds set it to `local`.

## Database

On first start the server creates `stylenow_records` (one row per booking, salon, account, lead …) and `stylenow_backups` (one full snapshot per day, last 14 kept). Data from the older single-row format is moved over automatically.

Run exactly **one** server process per database: a second one refuses to start (it would overwrite the first one's data). For more traffic, give that one process more CPU/RAM.

Check the database any time: `DATABASE_URL=… npm run db:check`.

## Before launch: test Stripe for real

With **test** keys on the server:

    STRIPE_SECRET_KEY=sk_test_… npm run stripe:test -- --url https://your-test-site

It signs up a salon with a test IBAN, completes payout setup with Stripe's test identity, pays a booking with card 4242 in the real checkout, completes the visit and checks the salon's transfer, then cancels a second paid booking and checks the refund.

## What emails go out

- Account: confirm email address; reset password (link valid 1 hour).
- Guest: booking confirmed; reminder ~24 h before (SMS too, if Twilio is set); cancelled (with refund amount); moved.
- Salon: new booking / cancelled / moved, to the email from its sign-up.

`GET /api/admin/outbox` (with the admin key) lists the last 200 attempts and whether each was sent.
