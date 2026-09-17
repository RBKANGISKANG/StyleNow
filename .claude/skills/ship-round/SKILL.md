---
name: ship-round
description: The end-to-end loop this repo ships features by — implement, run the five test suites, typecheck, build the static export, drive it in a browser, commit and push to the feature branch with the required trailer, then run an adversarial review workflow and fix what it confirms. Use this whenever you are asked to add features, implement a batch of work, or "ship" anything in StyleNow, and before saying a round is done — the review gate has caught real money and privacy defects in every round so far, so finishing without it is finishing early.
---

# Shipping a round of StyleNow work

Every round in this repo has followed the same loop, and the review gate at
the end has confirmed real defects every single time (29, then 24, then 10,
then 13). Treat it as part of "done", not as an optional extra.

## 1. Implement

Follow `stylenow-engine` for the six wiring places. Work in batches of
related features rather than one giant change — each batch typechecks and
tests before the next one starts, so a mistake stays small.

Typecheck early and often; it is fast and the i18n key check rides on it:

```bash
(cd apps/web && npx tsc --noEmit)
```

## 2. Test

```bash
npm test          # from the repo root — five suites, ~1 min
```

If a suite fails, check whether it fails on the *committed* tree too before
assuming your change caused it — this repo has had time-of-day fixture
flakes. Run the failing suite alone, and if it is a flake, widen the fixture's
search window rather than leaving it.

## 3. Build the static export

The API routes cannot be statically exported, so move them aside and put them
back. Run it **from the repo root**:

```bash
BK=$(mktemp -d) && cp -r apps/web/src/app/api "$BK/" && rm -rf apps/web/src/app/api \
  && (cd apps/web && STATIC_EXPORT=1 PAGES_BASE_PATH=/StyleNow NEXT_PUBLIC_BACKEND=local npx next build) ; \
  cp -r "$BK/api" apps/web/src/app/
```

Confirm the routes came back (`ls apps/web/src/app/api`) — the `;` is
deliberate so the restore runs even when the build fails.

## 4. Verify in the browser

Load the `verify` skill and drive the feature at its real surface. Tests
passing is not evidence the feature works: two features in round 5 passed
every suite while being completely inert in the default backend mode.

Verify both modes when a change touches pricing or bookings — the static
build on :8211 for the UI, and `npx next dev -p 8311` for the `/api` routes.

## 5. Commit and push

Branch is `claude/interactive-stylish-app-design-1mxyn4`. Never push
elsewhere without being asked.

Write the message as prose explaining *what changed and why it matters to a
user*, not a list of files. Every commit ends with the attribution trailer
given in the session's system reminder — check the reminder each session, the
model name in it changes.

```bash
git add -A && git commit -m "..." && git push -u origin claude/interactive-stylish-app-design-1mxyn4
```

## 6. Adversarial review — the gate

Run a `Workflow` over the round's diff with three or four lenses, each
finding verified by an independent skeptic before it counts. The shape that
has worked:

- **Lenses**: `engine-money` (pricing, seat contract, guard bypasses),
  `state-sync-privacy` (persistence, ShopConfig, erase/export, server-mode
  coverage), `ui-i18n-a11y` (dataflow, both catalogues, labels and pressed
  state). Add a fourth when the round is large.
- **Pipeline**: lens agent → per-finding verifier agents, defaulting to
  `real: false` unless the failure scenario holds in the code as written.
- Tell each lens to `call StructuredOutput exactly once with {"findings": [...]}`
  — without that sentence the schema call fails repeatedly.

Then fix everything confirmed, add a regression test per fix, and push a
second commit that names the count ("Fix the N confirmed findings from …").

**If the workflow reports agents that errored** (usage limits are common),
the empty result is not a clean bill of health — resume it:

```
Workflow({scriptPath: "<path from the launch result>", resumeFromRunId: "<runId>"})
```

## What the review keeps finding

Worth checking yourself before you run it, because these recur:

- A wrapper with no server-mode branch — the feature exists only in one
  browser.
- Money stacking additively instead of compounding on the remaining payable.
- A flag that is never cleared (survives a reschedule, a check-in, a cancel).
- "Off" that cannot round-trip through ShopConfig or a backup.
- Personal data the erase path misses — and copies of it elsewhere (a name
  stamped onto every minted gift card, not just the order).
- A second thread/row that the UI addresses by one key and therefore cannot
  reach.
