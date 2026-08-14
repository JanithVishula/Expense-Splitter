/**
 * Balances — Phase 3 of PLAN.md.
 *
 * Balances are always *derived* from the full expense list, never patched
 * incrementally. That is what makes edit and delete correct by construction:
 * there is no running total to keep in sync, so a mis-applied reversal is not
 * a bug that can exist.
 *
 * Sign convention: a positive balance means the person is owed money (they
 * paid more than their share); negative means they owe.
 */

import { toCents, type Cents } from './money'
import {
  splitEqual,
  splitExact,
  splitPercentage,
  type PersonId,
  type Shares,
} from './split'

export interface Person {
  id: PersonId
  name: string
}

/** How an expense divides among its participants. */
export type SplitMode =
  | { kind: 'equal'; participantIds: PersonId[] }
  | { kind: 'exact'; shares: Shares }
  | { kind: 'percentage'; percentages: Record<PersonId, number> }

export interface Expense {
  id: string
  description: string
  /** Total amount paid, in cents. */
  amount: Cents
  /** The single person who fronted the money. */
  paidBy: PersonId
  split: SplitMode
}

export type Balances = Record<PersonId, Cents>

export type BalancesResult =
  | { ok: true; balances: Balances }
  | { ok: false; error: string }

/** Dispatch an expense's split mode to the matching split function. */
function computeShares(expense: Expense) {
  switch (expense.split.kind) {
    case 'equal':
      return splitEqual(expense.amount, expense.split.participantIds)
    case 'exact':
      return splitExact(expense.amount, expense.split.shares)
    case 'percentage':
      return splitPercentage(expense.amount, expense.split.percentages)
  }
}

/**
 * Net balance per person across all expenses.
 *
 * For each expense the payer is credited the full amount and every participant
 * is debited their share. Since each split's shares sum to exactly the expense
 * total (guaranteed by `distributeRemainder`), every expense contributes a net
 * zero to the ledger — so the sum of all balances is exactly zero, for any set
 * of expenses. No tolerance check needed.
 *
 * Every person is present in the result, including those with no expenses,
 * so the UI can list a zero balance rather than a missing row.
 */
export function computeBalances(
  people: readonly Person[],
  expenses: readonly Expense[],
): BalancesResult {
  const known = new Set(people.map((p) => p.id))

  // Start everyone at zero so people with no activity still appear.
  const running = new Map<PersonId, number>()
  for (const person of people) running.set(person.id, 0)

  for (const expense of expenses) {
    if (!known.has(expense.paidBy)) {
      return {
        ok: false,
        error: `Expense "${expense.description}" is paid by an unknown person.`,
      }
    }

    const result = computeShares(expense)
    if (!result.ok) {
      return {
        ok: false,
        error: `Expense "${expense.description}": ${result.error}`,
      }
    }

    for (const id of Object.keys(result.shares)) {
      if (!known.has(id)) {
        return {
          ok: false,
          error: `Expense "${expense.description}" splits to an unknown person.`,
        }
      }
    }

    // Credit the payer the full amount; debit each participant their share.
    running.set(expense.paidBy, running.get(expense.paidBy)! + expense.amount)
    for (const [id, share] of Object.entries(result.shares)) {
      running.set(id, running.get(id)! - share)
    }
  }

  const balances: Balances = {}
  for (const [id, value] of running) balances[id] = toCents(value)

  // Structural invariant, not a sanity check: if this ever trips, a split
  // function has stopped summing to its total and every balance is suspect.
  const total = Object.values(balances).reduce((a, b) => a + b, 0)
  if (total !== 0) {
    throw new Error(
      `Balances failed to reconcile to zero (off by ${total} cents). ` +
        `This indicates a split function is not summing to its total.`,
    )
  }

  return { ok: true, balances }
}
