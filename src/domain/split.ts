/**
 * Split engine — Phase 2 of PLAN.md.
 *
 * Every split routes through `distributeRemainder`, so the invariant that
 * matters is enforced in exactly one place: the returned shares always sum to
 * the input total, exactly, for any total and any group size. Leftover cents
 * are *allocated*, never rounded away. That is what makes balances reconcile
 * to zero structurally rather than within a tolerance.
 */

import { toCents, type Cents } from './money'

/** A person's identifier. Opaque to this module. */
export type PersonId = string

/** The computed share owed by each participant, keyed by person. */
export type Shares = Record<PersonId, Cents>

/** Split failures are user-input problems, so they are returned, not thrown. */
export type SplitResult =
  | { ok: true; shares: Shares }
  | { ok: false; error: string }

/**
 * Largest-remainder method over integers.
 *
 * `base = floor(total / n)` goes to everyone; the leftover
 * `remainder = total - base * n` cents (necessarily 0 … n-1) are handed out one
 * each to the first `remainder` recipients. The caller fixes the recipient
 * order, so allocation is deterministic — see `orderedIds`.
 *
 * Returns an array of length `n` summing to exactly `totalCents`.
 * Throws on n < 1: a split with no recipients is a programming error here,
 * since the public entry points validate participant lists before calling.
 */
export function distributeRemainder(totalCents: Cents, n: number): Cents[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Cannot distribute across ${n} recipients; need at least 1.`)
  }

  // Math.trunc, not Math.floor: for a negative total (a refund), truncating
  // toward zero keeps the remainder's sign consistent with the total, so the
  // one-cent adjustments still push the sum to the exact target.
  const base = Math.trunc(totalCents / n)
  const remainder = totalCents - base * n

  // `remainder` is an integer in (-n, n); its sign follows the total.
  const step = remainder < 0 ? -1 : 1
  const extras = Math.abs(remainder)

  const out: Cents[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = toCents(i < extras ? base + step : base)
  }
  return out
}

/**
 * Deterministic recipient order for remainder allocation.
 *
 * Sorted by person id rather than by the order the caller happened to pass
 * them in, so re-saving an unchanged expense never shifts anyone's balance by
 * a cent. Tradeoff: the same early-sorting participants absorb the extra cent
 * on every uneven split. At one cent per split that is immaterial, and the
 * stability it buys is worth more than rotating fairness.
 */
function orderedIds(participantIds: readonly PersonId[]): PersonId[] {
  return [...participantIds].sort()
}

/** Reject duplicates: the same person listed twice would be charged twice. */
function findDuplicate(ids: readonly PersonId[]): PersonId | undefined {
  const seen = new Set<PersonId>()
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return undefined
}

/**
 * Equal split across the given participants.
 *
 * Rs. 100 across 3 people → 3334 / 3333 / 3333 cents, summing to exactly 10000.
 */
export function splitEqual(
  totalCents: Cents,
  participantIds: readonly PersonId[],
): SplitResult {
  if (participantIds.length === 0) {
    return { ok: false, error: 'Select at least one person to split between.' }
  }

  const duplicate = findDuplicate(participantIds)
  if (duplicate !== undefined) {
    return { ok: false, error: `"${duplicate}" is listed twice in this split.` }
  }

  const ids = orderedIds(participantIds)
  const amounts = distributeRemainder(totalCents, ids.length)

  const shares: Shares = {}
  ids.forEach((id, i) => {
    shares[id] = amounts[i]
  })
  return { ok: true, shares }
}

/**
 * Exact-amount split.
 *
 * The shares are already exact by definition, so there is nothing to
 * distribute — this validates rather than computes. The shares must sum to the
 * total; a mismatch is rejected so that invalid data cannot enter the ledger
 * and silently break the sum-to-zero guarantee.
 */
export function splitExact(totalCents: Cents, shares: Shares): SplitResult {
  const ids = Object.keys(shares)

  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one person to split between.' }
  }

  const sum = ids.reduce((acc, id) => acc + shares[id], 0)

  if (sum !== totalCents) {
    const difference = totalCents - sum
    const over = difference < 0
    return {
      ok: false,
      error:
        `Exact amounts must add up to the total. ` +
        `They are ${over ? 'over' : 'under'} by ${formatDiff(Math.abs(difference))}.`,
    }
  }

  // Re-brand into a fresh object so the caller cannot mutate our input.
  const out: Shares = {}
  for (const id of ids) out[id] = toCents(shares[id])
  return { ok: true, shares: out }
}

/**
 * Percentage split.
 *
 * Each share starts at `floor(total * pct / 100)`, computed in integer
 * hundredths-of-a-percent to keep the multiplication off the float path. The
 * leftover cents are then distributed by the same largest-remainder logic, so
 * the result sums to the total exactly.
 */
export function splitPercentage(
  totalCents: Cents,
  percentages: Record<PersonId, number>,
): SplitResult {
  const ids = orderedIds(Object.keys(percentages))

  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one person to split between.' }
  }

  for (const id of ids) {
    const pct = percentages[id]
    if (!Number.isFinite(pct)) {
      return { ok: false, error: `"${id}" has an invalid percentage.` }
    }
    if (pct < 0) {
      return { ok: false, error: `"${id}" has a negative percentage.` }
    }
    // Two decimal places of precision, matching what the input allows.
    if (Math.round(pct * 100) !== Number((pct * 100).toFixed(4))) {
      return {
        ok: false,
        error: `"${id}" has a percentage more precise than 2 decimal places.`,
      }
    }
  }

  // Work in basis points (hundredths of a percent) so the total check is an
  // integer comparison rather than a float one: 33.33 + 33.33 + 33.34 in
  // floats does not equal 100.
  const basisPoints = ids.map((id) => Math.round(percentages[id] * 100))
  const totalBp = basisPoints.reduce((a, b) => a + b, 0)

  if (totalBp !== 10_000) {
    const off = (totalBp - 10_000) / 100
    return {
      ok: false,
      error:
        `Percentages must add up to 100%. ` +
        `They currently add up to ${(totalBp / 100).toFixed(2)}% ` +
        `(${off > 0 ? 'over' : 'under'} by ${Math.abs(off).toFixed(2)}%).`,
    }
  }

  // Floor each share, then hand out the leftover cents in the same
  // deterministic id order used everywhere else.
  const floored = basisPoints.map((bp) =>
    Math.trunc((totalCents * bp) / 10_000),
  )
  const allocated = floored.reduce((a, b) => a + b, 0)
  const leftover = totalCents - allocated

  const step = leftover < 0 ? -1 : 1
  const extras = Math.abs(leftover)

  const shares: Shares = {}
  ids.forEach((id, i) => {
    shares[id] = toCents(i < extras ? floored[i] + step : floored[i])
  })
  return { ok: true, shares }
}

/** Minimal local formatter for error messages; display formatting lives in money.ts. */
function formatDiff(absCents: number): string {
  const rupees = Math.floor(absCents / 100)
  const cents = String(absCents % 100).padStart(2, '0')
  return `Rs. ${rupees.toLocaleString('en-US')}.${cents}`
}
