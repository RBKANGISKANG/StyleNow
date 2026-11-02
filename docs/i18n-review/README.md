# Translation review: legal, privacy and payment wording

One file per language (`fr.csv`, `pl.csv`, …), 354 rows each — every string about
terms and privacy consent, GDPR rights, cancellation and no-show fees, deposits,
refunds, payments, invoices/VAT, the partner contract, payouts, and treatment
safety consent. Opens in Excel, Numbers or Google Sheets.

Columns: `key`, `english`, `translation` (what the app shows today),
`ai_review_note` (what an automated review already changed — check these first),
then for the native speaker: `reviewer_ok` (y/n) and `reviewer_correction`.

Rules for corrections: keep every `{placeholder}` exactly as in the English, keep
emoji and symbols, and keep button-length text short.

To apply a returned file:

    node scripts/apply-i18n-review.mjs docs/i18n-review/fr.csv

It writes each non-empty `reviewer_correction` into
`apps/web/src/lib/locales/<code>.json`, and refuses any row whose placeholders
don't match the English.
