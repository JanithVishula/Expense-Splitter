/**
 * Money primitive — Phase 1 of PLAN.md.
 *
 * Every monetary value in this app is an integer number of cents
 * (1 LKR = 100 cents). Floats never touch stored values or arithmetic:
 * rupee strings are parsed to cents at the input boundary and formatted
 * back to rupees only at the render boundary. Between those two points
 * nothing is a float, so no rounding drift can accumulate.
 */

/**
 * An integer number of cents.
 *
 * The brand means a bare `number` cannot be passed where cents are expected
 * without an explicit conversion, so mixing rupees and cents fails to compile
 * rather than showing up later as a one-cent discrepancy in someone's balance.
 */
export type Cents = number & { __brand: 'Cents' }

/** The result of parsing user input: either a value or a reason it was rejected. */
export type ParseResult =
  | { ok: true; value: Cents }
  | { ok: false; error: string }

/**
 * Construct `Cents` from a number already known to be an integer count of cents.
 *
 * This is the single sanctioned way into the branded type. Callers doing
 * arithmetic on cents (splitting, summing balances) use this to re-brand their
 * results. It throws on non-integers because that indicates a programming error
 * — a float leaked into the money path — not bad user input.
 */
export function toCents(n: number): Cents {
  if (!Number.isInteger(n)) {
    throw new Error(`Cents must be a whole number, got ${n}`)
  }
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Cents value out of safe integer range: ${n}`)
  }
  return n as Cents
}

/** Escape hatch for reading the underlying number, e.g. for comparisons. */
export function centsValue(c: Cents): number {
  return c
}

/**
 * Matches an optional sign, digits with optional thousands separators, and an
 * optional fractional part. The fractional part is capped at two digits here,
 * in the grammar itself, so over-precise input like "12000.005" fails to match
 * and is rejected rather than silently truncated.
 */
const RUPEE_PATTERN = /^(-)?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/

/**
 * Parse a user-typed rupee string such as "12,000" or "3333.34" into cents.
 *
 * Rejects, rather than truncating:
 *   - more than two decimal places ("12000.005")
 *   - malformed thousands separators ("1,00,000", "12,00")
 *   - empty, non-numeric, or bare-separator input
 */
export function parseRupees(input: string): ParseResult {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { ok: false, error: 'Enter an amount.' }
  }

  // Distinguish "too precise" from "not a number" so the UI can say something
  // useful. A bare-dot form like "12000." is malformed, not over-precise.
  if (!RUPEE_PATTERN.test(trimmed)) {
    const overPrecise = /^-?[\d,]+\.\d{3,}$/.test(trimmed)
    if (overPrecise) {
      return {
        ok: false,
        error: 'Amounts cannot be more precise than 2 decimal places (cents).',
      }
    }
    return { ok: false, error: `"${input}" is not a valid amount.` }
  }

  const match = RUPEE_PATTERN.exec(trimmed)!
  const [, sign, whole, fraction = ''] = match

  const rupees = whole.replace(/,/g, '')
  // Right-pad so ".5" is 50 cents, not 5.
  const centsPart = fraction.padEnd(2, '0')

  // Build the integer directly from the digit strings — no float multiplication,
  // so values like 3333.34 cannot land on 333333.99999999994.
  const total = Number(rupees) * 100 + Number(centsPart)

  if (!Number.isSafeInteger(total)) {
    return { ok: false, error: 'Amount is too large.' }
  }

  return { ok: true, value: toCents(sign === '-' ? -total : total) }
}

/**
 * Format cents for display, e.g. `toCents(123456)` → "Rs. 1,234.56".
 *
 * Always shows exactly two decimal places, so a column of amounts aligns and
 * a whole-rupee value still reads as money.
 */
export function formatCents(c: Cents): string {
  const negative = c < 0
  const abs = Math.abs(c)

  const rupees = Math.floor(abs / 100)
  const remainder = abs % 100

  const grouped = rupees.toLocaleString('en-US')
  const fraction = String(remainder).padStart(2, '0')

  return `${negative ? '-' : ''}Rs. ${grouped}.${fraction}`
}
