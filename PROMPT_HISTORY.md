# Prompt History

Every prompt used to build this project, in order, with what came of each and
any corrections needed along the way.

Tool: Claude Code (Opus 5). The working pattern throughout was
**plan → build the money core → prove it → only then build UI**, with each
phase gated on its tests passing.

---

## 1. Read the assignment and produce a build plan

> Read ASSIGNMENT.md in this directory — that's the full spec, don't skip any
> part of it, especially the "You Must Explicitly Handle" and "Try This Before
> You Submit" sections, since those are the actual grading criteria.
>
> Do not write any code yet. Produce a build plan in PLAN.md structured as:
> (1) tech stack choice with reasoning and tradeoffs, (2) phase-by-phase build
> order where correctness of money math comes before UI, with concrete/testable
> "done" criteria and dependencies, (3) specifically flag money representation,
> uneven-split rounding, and the settle-up algorithm, (4) what's genuinely
> optional vs non-negotiable given the time limit, (5) a rough time budget.
>
> Ask me any clarifying questions you have before finalizing the plan — don't
> guess on anything that changes the architecture.

**Outcome:** Four clarifying questions asked before planning (stack, second
split type, testing depth, bonus handling). Answers: Vite + React + TS with
localStorage; **both** split types rather than one; Vitest on the money core
only; validate-and-block for the bonus. [PLAN.md](PLAN.md) written with a 6-hour
budget and a hard correctness gate at 2:30.

**Note:** the "both split types" answer diverged from the recommended single
mode; the plan absorbed it by scheduling percentage mode late so it stayed
droppable.

---

## 2. 
Added Plan.md as a reference
Convert this plan into prompts (building order) each phase as a prompt


## 3. Scaffold the project and build the money primitive

> Set up a Vite + React + TypeScript project with Vitest configured. Then build
> ONLY src/domain/money.ts — no UI, no other domain files yet. Branded
> `Cents` type; `parseRupees` rejecting >2 decimal places (don't silently
> truncate); `formatCents`. Write Vitest tests asserting round-trips for 0,
> 0.01, 12000, 3333.34, and a value above Rs. 10,000,000, plus over-precise
> rejection. Run the tests and fix any failures before reporting back.

**Outcome:** Scaffold + [money.ts](src/domain/money.ts), 40 tests passing.
Verified the brand actually bites by compiling `formatCents(1234)` and
confirming TS2345, then deleting the scratch file.

**Corrections needed:** `npm create vite` ignored `--yes` and hung on an
interactive prompt, so the scaffold files were written directly instead. Added
three tests beyond the brief that catch real failure modes: format→reparse
stability, float-error guards, and `"0.5"` = 50 cents (not 5).

---

## 4. Build the split engine

> Build src/domain/split.ts. Add one shared helper `distributeRemainder`
> implementing largest-remainder, deterministic by index/id, summing to exactly
> the total. Then `splitEqual`, `splitExact` (validates as given), and
> `splitPercentage`. Tests: sum === total for all three modes; Rs. 100 / 3 →
> 10000 cents; a property test over ~1000 random pairs; determinism; 1
> participant returns the full total; 0 participants rejected.

**Outcome:** [split.ts](src/domain/split.ts) + 45 tests (85 total).

**Deviations from the prompt, both deliberate:** used `Math.trunc` rather than
the specified `Math.floor` — identical for positive totals, but `floor` breaks
the invariant for negative ones. Percentages are compared in integer basis
points, because `33.33 + 33.33 + 33.34 !== 100` in floating point would have
rejected the assignment's own example. Also mutation-tested the suite rather
than trusting a green run: breaking remainder allocation failed 10 tests,
breaking sort order failed 1.

---

## 5. Build balances and settle-up (hard gate)

> Build src/domain/balances.ts and src/domain/settle.ts. `computeBalances`
> crediting the payer and debiting participants, summing to exactly 0 — assert
> in tests. `settleUp` with greedy max-debtor/max-creditor matching, ties broken
> by person id, plus a comment noting true minimum settlement is NP-hard and
> this is a near-optimal heuristic. Commit the ASSIGNMENT.md four-person
> scenario as a named test asserting the specific transaction set. Assert ≤ n−1
> transactions, a property test that settlement zeroes everyone, and no
> self- or zero-amount transactions. Report the full test output — this phase is
> a hard gate.

**Outcome:** [balances.ts](src/domain/balances.ts),
[settle.ts](src/domain/settle.ts), 34 tests (119 total). Scenario balances
derived by hand *before* writing assertions, so the test checks the spec's
arithmetic rather than the code's output: Alice +566,667 / Bob −933,333 /
Carol +700,000 / Dave −333,334, summing to 0, settling in 3 transactions.

**Design decision:** made sum-to-zero a *thrown* invariant in production code,
not just a test assertion — a non-zero sum means a split function regressed and
every balance is untrustworthy. Mutation-testing confirmed a one-cent error
trips it.

---

## 6. Build the state layer

> Build src/state/useStore.ts holding people and expenses with add/edit/delete.
> Critical design rule: balances derived fresh from the full expense list on
> every read via computeBalances — never stored or incrementally patched.
> Deleting a person referenced by an expense is blocked, naming the expenses.
> Persist to localStorage on every mutation; rehydrate on load; fall back to
> empty state if absent or corrupt. Tests: edit expense 2's amount; delete
> expense 3 and assert balances return to pre-expense-3 values; simulate a
> reload; attempt a blocked person deletion.

**Outcome:** [store.ts](src/state/store.ts) (plain class, no React),
[storage.ts](src/state/storage.ts), [useStore.ts](src/state/useStore.ts),
53 tests (172 total). Splitting the store from React kept it testable in
Vitest's fast `node` environment without jsdom.

**Correction needed — caught by writing the test:** my first hostile-storage
test asserted that `addPerson` *throws* when localStorage is full. That
documented a real bug instead of fixing it — `commit()` updated state, then
threw before notifying subscribers, silently desyncing the UI. Changed
persistence failure to be non-fatal, with `getPersistError()` surfacing the
reason. Also verified the derive-fresh rule is load-bearing by adding a balance
cache: it immediately broke the delete-restores-balances test.

---

## 7. Build the UI and walk the scenario through it

> Build a single-page UI with four sections in vertical flow order. Add Expense
> form with amount via parseRupees, payer dropdown, participant checkboxes, and
> equal/exact/percentage mode selector with per-person inputs. Edit and Delete
> per expense. Balances with owed/owes distinguished and a total line reading
> Rs. 0.00. Settle Up as "X pays Y Rs. Z" lines plus a count. Then run the dev
> server and manually walk the full ASSIGNMENT.md scenario through the UI
> yourself — no console, no test file. Report the resulting balances and
> transactions and confirm they match Phase 3 exactly. If anything's off, find
> the root cause rather than patching the display.

**Outcome:** Four section components + [App.tsx](src/App.tsx). Drove a real
Chromium browser via Playwright — typing into inputs, ticking checkboxes,
selecting radios, clicking submit — then read values back off the rendered DOM.
Output matched the Phase 3 values **exactly**, so there was nothing to
root-cause. Also exercised percentage mode, blocked person deletion, edit, and
delete. Playwright and the walkthrough scripts were removed afterward so they
didn't pollute the repo.

---

## 8. Add live split validation and test it

> Add live validation to the expense form for exact and percentage modes.
> Running total as the user fills in shares; block submission on mismatch and
> show the exact shortfall or excess; do not auto-correct silently. Write a
> quick test confirming submission is blocked when shares don't sum correctly,
> and allowed when they do.

**Outcome:** The validation behaviour already existed from step 6, so this was
really about the test — and **writing it caught a real bug.** The shortfall was
gated on every field being parseable, so with one person filled in and another
blank the form showed a mismatched total with no explanation of how far off it
was — guidance vanished exactly when it was most useful. Blank fields now count
as zero. 12 UI tests added (184 total).

**Scope note:** this required Testing Library + jsdom, which the step-1
decisions had explicitly excluded. Contained the cost by splitting Vitest into
two projects so domain/state tests stay in fast `node` (~0.6s) and only the
component tests pay for jsdom.

---

## 9. Write the README and this file

> Write README.md covering what this is and how to run it, tech stack and why,
> assumptions (integer cents; largest-remainder with deterministic order;
> localStorage single-session; LKR-only; greedy settle-up as near-optimal not
> provably minimal; both split modes built deliberately up front), plus any
> other judgment call actually made during the build — pull these from what
> really happened, don't restate PLAN.md verbatim. Then what I'd build next (a
> real backend so sessions survive across devices), what's intentionally
> incomplete and why, and confirm no .env is used. Also create PROMPT_HISTORY.md
> listing each prompt in order with notes on outcomes and corrections.

**Outcome:** [README.md](README.md) and this file. The README's "other judgment
calls" section documents the eight decisions that emerged during the build
rather than during planning — error-handling split by cause, `Math.trunc` over
`Math.floor`, basis-point percentage validation, blocked-not-cascaded person
deletion, and the rest.

---

## Reflection on the process

What worked: **gating the UI behind a proven money core.** By the time any
component existed, the split, balance, and settle-up logic had 119 passing tests
including the graded scenario — so when the UI produced the right numbers on the
first run, that was expected rather than lucky.

What I'd repeat: **mutation-testing the tests.** Five deliberate bugs were
injected across the build and every one was caught. A green suite proves nothing
until you've watched it go red.

Where AI output needed correcting: three times, all caught by testing rather
than review — the localStorage failure path that silently desynced the UI, the
blank-field validation gap, and the initial `Math.floor` choice that would have
broken negative totals. Two of those were bugs in code I had written moments
earlier and believed correct.
