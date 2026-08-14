# Expense Splitter

A single-page app for splitting shared expenses among a group and settling up
with as few payments as possible. All amounts are in Sri Lankan Rupees (LKR).

The flow is four sections top to bottom: **Add People → Add Expense → Balances
→ Settle Up**.

Built against [ASSIGNMENT.md](ASSIGNMENT.md); the up-front build plan is in
[PLAN.md](PLAN.md).

---

## Running it

Requires Node 20+ (built and tested on Node 22).

```bash
npm install
npm run dev      # dev server at http://localhost:5173
```

```bash
npm test         # run the full suite once (184 tests)
npm run test:watch
npm run build    # typecheck + production build
```

There is **no `.env` file and no configuration of any kind** in this project —
no API keys, no secrets, no environment variables. Nothing needs to be sent
separately.

---

## Tech stack, and why

| Choice | Why | Tradeoff |
|---|---|---|
| **Vite + React + TypeScript** | Fastest path to a running app with no server. TypeScript earns its place specifically because money is a branded integer type — the compiler rejects a raw float reaching the ledger, which is the exact bug class this exercise is about. | Heavier than plain HTML/JS. Accepted: the type safety targets the graded failure mode. |
| **localStorage** | The assignment says to pick whatever preserves time for split/settle-up logic. Zero infrastructure — no DB, no schema, no server. | Per-browser, per-device. See [Assumptions](#assumptions). |
| **Vitest** | Ships with Vite, no extra config. Makes the assignment's own scenario an executable test instead of something clicked through by hand. | ~10 min setup, repaid on the first refactor. |
| **No backend** | Nothing in the spec needs one. "No login or user accounts needed." | See [What I'd build next](#what-id-build-next). |

The architecture is deliberately layered so the money math is testable in
isolation, with no DOM involved:

```
src/domain/    money.ts, split.ts, balances.ts, settle.ts   — pure TS, no React
src/state/     store.ts, storage.ts, useStore.ts            — plain class + thin React binding
src/ui/        four section components                      — presentation only
```

`src/state/store.ts` has no React import at all; `useStore.ts` is the only
React-aware file in the state layer. That is what let the store be tested in
Vitest's fast `node` environment rather than under jsdom.

---

## Assumptions

### Money is integer cents, never floats

Every amount is an integer number of cents (`LKR × 100`) in a branded type
`Cents = number & { __brand: 'Cents' }`. Rupee strings are parsed to cents at
the input boundary and formatted back only at the render boundary; nothing in
between is a float.

The brand is enforced, not decorative — passing a bare `number` where `Cents`
is expected is a compile error (verified: `formatCents(1234)` fails with
TS2345).

Parsing builds the integer from digit strings rather than multiplying a float,
because `parseFloat("3333.34") * 100` is `333333.99999999994`. Input with more
than two decimal places is **rejected, never truncated** — silently accepting
`12000.005` as `Rs. 12,000.01` would put a number in the ledger the user never
typed.

### Uneven splits use largest-remainder with a deterministic recipient order

`Rs. 100` three ways is `3334 / 3333 / 3333` cents — the leftover cent is
**allocated**, not rounded away. Because every split's shares sum to the total
by construction, and each expense credits the payer exactly what it debits the
participants, all balances sum to **exactly zero**. This is a structural
guarantee, not a tolerance check: `computeBalances` throws if the ledger ever
fails to reconcile, on the grounds that a non-zero sum means a split function
regressed and every displayed balance is untrustworthy.

Remainder cents go to participants ordered by **person ID, not input order**,
so re-saving an unchanged expense never shifts anyone's balance by a cent.

*Known tradeoff:* the same early-sorted participants absorb the extra cent on
every uneven split. At one cent per split this is immaterial, and the stability
it buys is worth more than rotating fairness. IDs are generated, never derived
from names, so renaming someone cannot reallocate a cent.

### localStorage, single-session and single-device

State persists to one localStorage key and rehydrates on load. It does not sync
across devices or browsers, and there is no multi-user support — squarely within
the assignment's "no login or user accounts needed — this is a single-session
tool, not a multi-user app."

Rehydration **validates structurally, not just as JSON**. A payload that parses
but is wrong (non-integer cents, an expense referencing an unknown person, an
unrecognised split kind) is rejected *whole* and falls back to empty state,
rather than being half-loaded — a partial load would render plausible but wrong
balances, which is worse than starting clean.

### Single currency (LKR)

No currency field, no conversion, no locale switching, per the assignment.
Formatting is fixed to `Rs. 1,234.56`.

### Settle-up is greedy and near-optimal, not provably minimal

Settlement repeatedly matches the largest debtor against the largest creditor.

**This is a heuristic, and I'd rather state that than overclaim.** True
minimum-transaction settlement is NP-hard — it reduces to the partition
problem, since any subset of balances summing to zero could be settled among
itself. Greedy is optimal whenever no proper subset cancels exactly, and can
miss the true optimum by a transaction or two on contrived inputs.

What it *does* guarantee: every iteration zeroes at least one person, so the
result is always **at most n−1 transactions** for n non-zero balances — far
below the pairwise-debt list the assignment rules out. It runs in O(n log n)
versus exponential for an exact solver, which is the right trade here.

### Both exact-amount and percentage split modes were built

The assignment says to pick one. I built both, and this was decided **up front
in PLAN.md, not bolted on late**: once money is integer cents and all splits
route through one shared `distributeRemainder` helper, the third mode is a thin
input form over machinery that already exists and is already tested. The
marginal cost was one extra UI branch and one test group, and the time budget
had room.

It was scheduled late precisely so it could be dropped if earlier phases
overran. They didn't.

Exact-amount also reproduces the grader's literal test numbers (Alice 3,333.33 /
Bob 3,333.33 / Dave 3,333.34) without substitution.

### Other judgment calls made during the build

These came up while building and aren't all in PLAN.md:

- **Error handling is split by cause.** User-input problems return a
  discriminated union (`{ok: false, error}`); violated internal invariants
  throw. So `parseRupees("abc")` returns an error the form can render, while
  `toCents(10.5)` throws — a non-integer cent value means a float leaked into
  the money path, which is a programming error, not a user error.
- **`Math.trunc`, not `Math.floor`, in remainder distribution.** They are
  identical for positive totals but diverge on negatives: `floor` makes the
  remainder's sign oppose the total, so the correction pushes away from the
  target. Only matters if a negative amount (a refund) is ever entered, but the
  invariant should hold unconditionally.
- **Percentages are validated in integer basis points.** `33.33 + 33.33 +
  33.34` does not equal `100` in floating point, so a naive `=== 100` check
  would have rejected the assignment's own example.
- **Deleting a person is blocked, not cascaded**, when any expense references
  them as payer *or* participant. Silently dropping someone from a split would
  change what everyone else owes without being asked. The error names the
  offending expenses.
- **Duplicate participants in one split are rejected**, since the same person
  listed twice would be charged twice.
- **Editing an exact-split expense must submit amount and shares together.**
  Changing the amount alone would leave shares inconsistent with the total, so
  the store rejects it and the form always sends both.
- **A failed localStorage write does not break the session.** If storage is
  full or disabled, the mutation still applies in memory, subscribers still
  fire, and the UI shows a warning that changes won't survive a reload. (My
  first implementation let the write error propagate and skip the subscriber
  notification, which would have silently desynced the screen from the data.)
- **Blank per-person fields count as zero in the live running total**, so the
  shortfall stays visible while the form is being filled — that is when the
  guidance is most useful. Only genuinely unparseable text suppresses it.
- **Balance direction is not conveyed by colour alone.** A `+`/`−` sign and a
  trailing "is owed" / "owes" label carry the same information.
- **The bonus validation was completed.** Exact amounts that don't sum to the
  total and percentages that don't sum to 100% block submission and show the
  precise shortfall or excess (`short by Rs. 12.50`, `over by 3.00%`). Values
  are never silently auto-corrected.

---

## Verification

184 tests across 5 files. The money core is property-tested, not just
example-tested:

- `splitEqual` shares sum to the total exactly across **1,000 random
  (total, participant-count) pairs**.
- Settlement drives every balance to exactly zero across **1,000 random balance
  sheets**, with no self-transactions, no zero-amount transactions, and never
  more than n−1 transactions.
- An end-to-end property test runs random expenses → balances → settlement →
  all zero.

**The assignment's scenario is committed as a named test** with hand-derived
expected values, and was also walked through the rendered UI in a real browser
(typing into inputs, ticking checkboxes, clicking submit — not calling code):

| Person | Balance |
|---|---|
| Alice | +Rs. 5,666.67 |
| Bob | −Rs. 9,333.33 |
| Carol | +Rs. 7,000.00 |
| Dave | −Rs. 3,333.34 |
| **Total** | **Rs. 0.00** |

Settle Up — **3 transactions** (n−1 for 4 people, not the 5 pairwise debts):

1. Bob pays Carol Rs. 7,000.00
2. Bob pays Alice Rs. 2,333.33
3. Dave pays Alice Rs. 3,333.34

Tests were also **mutation-tested** rather than trusted for being green: I
deliberately broke the remainder allocation (10 failures), the sorted recipient
order (1), the settle-up sort direction (2), the payer reference check on person
deletion (2), and added a stale balance cache (1) — each was caught, then
reverted. A suite that passes against broken code is worth nothing.

---

## What I'd build next

**A real backend — a small Node/Express API with a proper database
(Postgres or SQLite) behind it.** Right now a trip lives in one browser's
localStorage: clear site data or open the app on your phone and it's gone.
Replacing the persistence layer with an API would let a group share one ledger
across devices and over time, and would open the door to the things that
actually follow from it — multiple named groups, a shareable link, and an audit
trail of who changed which expense.

This is deliberately not built here. The assignment scores split and settle-up
correctness over infrastructure, and localStorage was the fastest route to
spending the time there. The architecture anticipates the swap: persistence is
already behind a two-method `Storage` interface (`src/state/storage.ts`), and
the domain layer has no idea where data comes from — an HTTP-backed
implementation would not touch a line of the money math.

After that, in rough order:

- **Settlement optimality** — for small groups, an exact solver (subset-sum over
  balance groups) could replace greedy where it's tractable, falling back to
  greedy beyond a size threshold.
- **Undo** for deletes, currently irreversible with no confirmation.
- **Multiple payers on one expense** — common in practice, unsupported here.
- **Rotating the remainder cent** across expenses so the same alphabetically-early
  person doesn't always absorb it.

---

## What's intentionally incomplete

Prioritisation followed the assignment's own guidance: *"a correct,
plain-looking app beats a beautiful one with wrong balances."* Phases 1–3 (the
money core) were finished and fully tested **before any UI existed**.

Left undone, deliberately:

- **UI polish.** Unstyled-ish, single page, no responsive design, no loading or
  empty-state art, no animation. It is usable and the flow is clear; that was
  the bar the assignment set.
- **No component tests beyond the split-validation form.** The 12 UI tests
  cover the validation seam specifically. Rendering of the balances and
  settle-up sections was verified by driving a real browser, not by automated
  assertions.
- **No accessibility audit.** Inputs are labelled, errors use `role="alert"`,
  and balance direction doesn't depend on colour — but there's been no
  screen-reader or keyboard-navigation pass.
- **Delete has no confirmation dialog**, and there's no undo.
- **No multi-currency, categories, tags, search, filtering, CSV export, or
  multi-group support.** None were requested.
- **Expense descriptions aren't required** — an empty one defaults to
  "Expense".
- **No date on expenses**, so no chronological ordering or filtering. The
  settle-up math doesn't need one.

The one place I spent time beyond the strict minimum was building both split
modes and property-testing the money core. Both were judged worth it: the
former was cheap once the split engine existed, and the latter is the actual
evidence that the balances are right.
