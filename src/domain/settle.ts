/**
 * Settle-up — Phase 3 of PLAN.md.
 *
 * Turns a balance sheet into a short list of payments that zeroes everyone out.
 */

import { toCents, type Cents } from './money'
import type { PersonId } from './split'
import type { Balances } from './balances'

export interface Transaction {
  from: PersonId
  to: PersonId
  amount: Cents
}

/**
 * Greedy max-debtor / max-creditor settlement.
 *
 * Repeatedly matches the largest debtor against the largest creditor,
 * transferring `min(|debt|, credit)` and dropping whoever reaches zero.
 *
 * NOTE ON OPTIMALITY: finding the true minimum number of transactions is
 * NP-hard — it reduces to the partition problem, since any subset of balances
 * summing to zero could be settled among itself. This greedy approach is the
 * standard near-optimal heuristic, NOT a guaranteed minimum. It is optimal
 * whenever no proper subset of balances cancels exactly, and can miss the true
 * optimum by a transaction or two on contrived inputs. What it does guarantee:
 * every iteration zeroes at least one person, so it always terminates in at
 * most n-1 transactions for n non-zero balances — far below the pairwise-debt
 * count, which is what the requirement is really about. Runs in O(n log n).
 *
 * Determinism: debtors and creditors are sorted by amount, ties broken by
 * person id, so the same balance sheet always yields the same transaction list.
 */
export function settleUp(balances: Balances): Transaction[] {
  // Work in plain numbers internally, re-branding on output.
  const debtors: Array<{ id: PersonId; amount: number }> = []
  const creditors: Array<{ id: PersonId; amount: number }> = []

  for (const [id, balance] of Object.entries(balances)) {
    if (balance < 0) debtors.push({ id, amount: -balance })
    else if (balance > 0) creditors.push({ id, amount: balance })
    // Exactly-zero balances need no transaction and are dropped.
  }

  if (debtors.length === 0 || creditors.length === 0) return []

  // Largest first; ties by id so the output is stable across runs.
  const byAmountThenId = (
    a: { id: PersonId; amount: number },
    b: { id: PersonId; amount: number },
  ) => (b.amount - a.amount) || a.id.localeCompare(b.id)

  debtors.sort(byAmountThenId)
  creditors.sort(byAmountThenId)

  const transactions: Transaction[] = []
  let d = 0
  let c = 0

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]
    const creditor = creditors[c]

    const amount = Math.min(debtor.amount, creditor.amount)

    // Guard against emitting a no-op; with zero balances filtered out above,
    // `amount` is always positive, but this keeps the guarantee explicit.
    if (amount > 0) {
      transactions.push({
        from: debtor.id,
        to: creditor.id,
        amount: toCents(amount),
      })
    }

    debtor.amount -= amount
    creditor.amount -= amount

    // Advance past whoever is now settled. Both may settle in the same step.
    if (debtor.amount === 0) d++
    if (creditor.amount === 0) c++
  }

  return transactions
}

/**
 * Apply transactions to a balance sheet, returning the resulting balances.
 * Used by tests to verify settlement actually zeroes everyone out; also useful
 * for a "what's left" view in the UI.
 */
export function applyTransactions(
  balances: Balances,
  transactions: readonly Transaction[],
): Balances {
  const out: Record<PersonId, number> = {}
  for (const [id, value] of Object.entries(balances)) out[id] = value

  for (const { from, to, amount } of transactions) {
    // The payer's negative balance moves toward zero; the receiver's positive
    // balance moves toward zero.
    out[from] = (out[from] ?? 0) + amount
    out[to] = (out[to] ?? 0) - amount
  }

  const result: Balances = {}
  for (const [id, value] of Object.entries(out)) result[id] = toCents(value)
  return result
}
