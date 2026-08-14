# Expense Splitter — Build Plan

Plan only. No implementation code is written until this is approved.

Source of truth: [ASSIGNMENT.md](ASSIGNMENT.md). The graded core is the two
sections "You Must Explicitly Handle" (rounding reconciles to exactly zero) and
"Try This Before You Submit" (the four-person scenario). Everything in this plan
is ordered so those two are provably done before any time goes into UI.

---

## 1. Tech stack

| Choice | Why | Tradeoff accepted |
|---|---|---|
| **Vite + React + TypeScript** | Single command to a running app, no server, no routing config. TS matters here specifically because money is modelled as a branded integer type — the compiler catches a raw float leaking into the ledger, which is the exact bug class being graded. | Heavier than plain HTML/JS (node_modules, build step). Accepted because the type safety is aimed at the graded failure mode, not at general polish. |
| **localStorage for persistence** | Spec explicitly says pick whatever preserves time for split/settle-up logic. Zero infrastructure: no DB, no schema migration, no server. Survives refresh, which is enough for a single-session tool. | State is per-browser and not shareable across devices; no concurrent editing. Both are out of scope per "no login or user accounts needed". Noted as an assumption in the README. |
| **Vitest for the money core** | Ships with Vite, no separate config. The assignment scenario becomes an executable test rather than something I click through by hand. | Adds ~10 min of setup. Bought back immediately: every later refactor of the split logic is re-verified for free instead of re-clicked. |
| **No UI test layer** | Testing Library setup competes directly with the graded logic for the same hours. | UI regressions are caught by hand only. Acceptable — spec says "a correct, plain-looking app beats a beautiful one with wrong balances". |
| **No backend, no API** | Nothing in the spec needs one. | None relevant at this scope. |
| **Both split types (equal, exact, percentage)** | Exact-amount reproduces the grader's literal test numbers; percentage is the spec's stated alternative. Once money is integer cents with a shared remainder-distribution helper, the third mode is a thin input form over machinery that already exists and is already tested. | One extra UI mode and one extra test group. This is the one place the plan spends time beyond the minimum; it is scheduled late (Phase 5) and is droppable if the clock runs out, since equal + exact alone satisfy the spec. |

**Overall reasoning.** Every choice above trades breadth for a short path to
verified money math. The stack is deliberately boring so that essentially all
thinking time lands in Phases 1–3.

---

## 2. Build order

Money math is fully tested and locked before a single component is written.
Phases 1–3 have no UI at all.

### Phase 1 — Money primitive
**Build:** `money.ts`. Integer-cents representation, a branded `Cents` type,
parse from a user-typed rupee string, format to a `Rs. 1,234.56` display string.

**Done means:**
- `parseRupees("12,000.005")` is rejected rather than silently truncated.
- `parseRupees` → `formatCents` round-trips for: `0`, `0.01`, `12000`, `3333.34`, and a value above `Rs. 10,000,000`.
- No `number` in the module represents rupees — only cents. Enforced by the branded type.
- Tests green.

**Depends on:** nothing. This is the foundation everything else asserts against.

### Phase 2 — Split engine
**Build:** `split.ts`. Three functions, one per mode, each taking a total in
cents plus participants and returning per-person cents. All three route through
one shared `distributeRemainder` helper.

**Done means:**
- For every mode, `sum(shares) === total` exactly. Property-tested over ~1,000 random (total, participant-count) pairs, not just hand-picked cases.
- `Rs. 100 / 3` → `3334, 3333, 3333` cents; sums to `10000`.
- Remainder assignment is deterministic — the same input yields the same allocation on repeated calls, so an unchanged expense never shifts anyone's balance.
- Equal split across 1 person returns the whole total; across 0 participants is rejected as invalid input.
- Tests green.

**Depends on:** Phase 1 (operates on `Cents`).

### Phase 3 — Balances and settle-up
**Build:** `balances.ts` (net position per person) and `settle.ts` (minimum
transaction list).

**Done means:**
- Across any expense list, `sum(all net balances) === 0` exactly, as an assertion in the code path, not a comment.
- **The assignment's four-person scenario is committed as a named test** and its expected transaction set is asserted, not eyeballed.
- Settle-up on `n` people with non-zero balances emits **at most `n - 1`** transactions — asserted, since this is the property the spec is actually checking for.
- Applying every emitted transaction to the balance sheet drives every person to exactly `0`. Property-tested over random balance sets.
- Nobody appears as both payer and receiver in the same emitted transaction; no zero-amount transactions are emitted.
- Tests green.

**Depends on:** Phases 1 and 2.

> **Gate.** Phases 1–3 must be green before Phase 4 starts. If the day gets cut
> short here, what exists is a tested, correct engine — the strongest partial
> submission available, given how the spec weights grading.

### Phase 4 — State layer
**Build:** `useStore` — people, expenses, add/edit/delete, localStorage
persistence.

**Done means:**
- Editing an expense's amount, payer, participants, or split mode recomputes balances from the full expense list. Balances are **derived on read, never incrementally patched** — this is what makes edit and delete correct by construction rather than by careful bookkeeping.
- Deleting an expense returns balances to exactly their pre-expense values.
- Deleting a person who appears in an existing expense is handled explicitly (blocked, with a message naming the expenses) rather than silently corrupting a split.
- A refresh restores people and expenses; a corrupt or absent localStorage entry falls back to empty state instead of throwing on boot.

**Depends on:** Phase 3.

### Phase 5 — UI
**Build:** One page, four sections in flow order — People → Add Expense →
Balances → Settle Up.

**Done means:**
- The full assignment scenario can be entered through the UI alone, with no console or code, and the on-screen balances match the Phase 3 test values exactly.
- All three split modes are reachable from the expense form.
- Balances show who owes vs. who is owed, distinguishably.
- Settle Up renders the minimized transaction list as plain "A pays B Rs. X" lines.

**Depends on:** Phase 4.

### Phase 6 — Bonus validation
**Build:** Live running total in the expense form for exact and percentage modes.

**Done means:** Exact amounts not summing to the total, and percentages not
summing to 100, both block submission and show the shortfall or excess. Invalid
data cannot enter the ledger, so balances can never be corrupted by it.

**Depends on:** Phase 5. Droppable — see §4.

### Phase 7 — Deliverables
**Build:** `README.md` (how to run, assumptions with reasoning, what's next,
what was cut and why) and the prompt-history file. Push to a public repo.

**Done means:** A clean clone runs with `npm install && npm run dev`, and
`npm test` passes from that clone. No `.env` is committed (none is expected;
if one appears, its contents go to a separate `env-values.txt` per spec §4).

---

## 3. The three flagged problems

### Money representation
All money is **integer cents** (`LKR × 100`), in a branded TypeScript type
`Cents = number & { __brand: 'Cents' }`. Floats never touch stored values or
arithmetic. Rupee strings are parsed to cents at the input boundary and
formatted back to rupees only at the render boundary; between those two points
nothing is a float. The brand means a bare `number` cannot be passed where cents
are expected without an explicit conversion, so the mistake fails to compile
rather than showing up as a rounding drift.

Sri Lanka's smallest legacy unit is the cent (1/100 of a rupee), matching the
spec's phrasing of "an extra cent (i.e., a fraction of a rupee)".

### Equal splits that don't divide evenly
The largest-remainder method, applied to integers:

1. `base = floor(total / n)`, given to everyone.
2. `remainder = total - (base × n)` — necessarily an integer in `0 … n-1`.
3. Distribute those leftover cents **one each** to the first `remainder`
   participants, ordered deterministically by participant ID.

Worked example — `Rs. 100` three ways: `10000` cents, `base = 3333`,
`remainder = 1`. Shares: `3334, 3333, 3333`. Sum: `10000`. Exact.

Because remainder cents are *allocated* rather than rounded away, the shares sum
to the total by construction for any total and any group size. Every person's
net balance is a sum of such exact allocations, so all balances sum to exactly
zero — reconciliation is a structural guarantee, not a tolerance check.

The same helper serves percentage mode (each share is `floor(total × pct/100)`,
then the leftover cents are distributed identically) and validates exact-amount
mode. Ordering by participant ID rather than by input order keeps the allocation
stable across edits, so re-saving an unchanged expense never shifts a balance by
a cent.

*Known tradeoff:* the same early-ordered participants absorb the extra cent on
every uneven split. At one cent per split this is immaterial, and the
determinism it buys is worth more than rotating fairness. Noted in the README.

### Minimum-transaction settle-up
Greedy max-debtor / max-creditor matching:

1. Compute net balances; drop everyone at exactly zero.
2. Put debtors and creditors in two max-heaps (or sorted arrays — group sizes
   here are small enough that sorting is not the bottleneck).
3. Repeatedly match the largest debtor against the largest creditor, transfer
   `min(|debt|, credit)`, and remove whichever side hits zero.
4. Each iteration zeroes at least one person, so with `n` non-zero people the
   result is **at most `n − 1` transactions** — far below the pairwise-debt
   count the spec explicitly rules out.

*Honest caveat, and I'd rather state it than overclaim:* exact minimum-transaction
settlement is NP-hard (it reduces to a partition problem). Greedy is optimal
whenever no subset of balances happens to cancel exactly, and otherwise can miss
the true optimum by a transaction or two on contrived inputs. For realistic trip
group sizes it is optimal or near-optimal, it always terminates at `≤ n − 1`, and
it runs in `O(n log n)` versus exponential for an exact solver. This is the right
trade for the time budget; the README will say so explicitly rather than claiming
a guaranteed minimum.

---

## 4. Optional vs. non-negotiable

**Non-negotiable** — these are the grading criteria:
- Integer-cents money, no floats in the ledger.
- Exact remainder distribution; balances summing to exactly zero.
- Equal split + at least one of exact/percentage.
- Edit and delete with correct recalculation.
- Balances view and minimized Settle Up view.
- The assignment scenario reproducible **through the UI**.
- README with assumptions, and the prompt-history file.

**Optional, in the order I'd drop them under time pressure:**
1. Any styling beyond readable defaults — spec says the UI needn't be polished.
2. Percentage mode (Phase 5 portion). Exact-amount alone satisfies the spec and matches the grader's literal test numbers; percentage is the first thing cut if Phases 1–4 overrun.
3. Bonus validation (Phase 6) — explicitly a bonus.
4. Blocking deletion of a person in use, beyond a plain guard.
5. Persistence itself. If localStorage fights back, in-memory is a spec-sanctioned fallback and costs one README line.

**Deliberately not building:** multi-currency, auth, categories/tags, expense
search or filtering, CSV export, undo, multi-group support, mobile-specific
layout. None are requested, and each would consume time the spec wants spent on
correctness.

---

## 5. Time budget

Assumes roughly a **6-hour** working day. Compress proportionally if shorter —
but the Phase 1–3 block should stay near half the total no matter what, since
that block is what's actually graded.

| Phase | Est. | Running | Note |
|---|---|---|---|
| 1 — Money primitive | 30 min | 0:30 | Includes Vite + Vitest scaffold. |
| 2 — Split engine | 45 min | 1:15 | Property tests are most of this. |
| 3 — Balances + settle-up | 75 min | 2:30 | Assignment scenario locked as a test here. |
| **Gate: core green** | — | **2:30** | **Correctness proven before any UI.** |
| 4 — State layer | 45 min | 3:15 | Derive-on-read makes edit/delete nearly free. |
| 5 — UI | 105 min | 5:00 | Largest single block; all three split modes. |
| 6 — Bonus validation | 25 min | 5:25 | First thing cut if Phase 5 overruns. |
| 7 — README + prompt history + push | 35 min | 6:00 | Do not compress — it's a graded deliverable. |

**Checkpoints.** At the 2:30 gate, the engine must be green; if it isn't, cut
percentage mode and the bonus rather than shortening tests. At 5:00, stop
building and start Phase 7 regardless of UI state — an unfinished feature with an
honest README beats a finished feature with no README, since the spec explicitly
asks what was left incomplete and why.
