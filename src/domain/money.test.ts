import { describe, expect, it } from 'vitest'
import { centsValue, formatCents, parseRupees, toCents } from './money'

/** Parse helper for cases that are expected to succeed. */
function parseOk(input: string) {
  const result = parseRupees(input)
  if (!result.ok) {
    throw new Error(`Expected "${input}" to parse, got error: ${result.error}`)
  }
  return result.value
}

describe('parseRupees → formatCents round-trips', () => {
  // The cases named in the Phase 1 "done" criteria of PLAN.md.
  const cases: Array<{ input: string; cents: number; formatted: string }> = [
    { input: '0', cents: 0, formatted: 'Rs. 0.00' },
    { input: '0.01', cents: 1, formatted: 'Rs. 0.01' },
    { input: '12000', cents: 1_200_000, formatted: 'Rs. 12,000.00' },
    { input: '3333.34', cents: 333_334, formatted: 'Rs. 3,333.34' },
    // Above Rs. 10,000,000.
    { input: '10,500,000.75', cents: 1_050_000_075, formatted: 'Rs. 10,500,000.75' },
  ]

  for (const { input, cents, formatted } of cases) {
    it(`round-trips ${input}`, () => {
      const parsed = parseOk(input)
      expect(centsValue(parsed)).toBe(cents)
      expect(formatCents(parsed)).toBe(formatted)
      // Formatting and re-parsing must be stable: the displayed value is itself
      // valid input, so editing an existing expense cannot drift by a cent.
      expect(centsValue(parseOk(formatted.replace('Rs. ', '')))).toBe(cents)
    })
  }
})

describe('parseRupees accepts valid forms', () => {
  it('accepts thousands separators', () => {
    expect(centsValue(parseOk('12,000'))).toBe(1_200_000)
    expect(centsValue(parseOk('1,234.56'))).toBe(123_456)
  })

  it('accepts the same number with and without separators identically', () => {
    expect(centsValue(parseOk('12000.50'))).toBe(centsValue(parseOk('12,000.50')))
  })

  it('treats a single decimal digit as tenths, not hundredths', () => {
    // "0.5" is 50 cents, not 5 cents.
    expect(centsValue(parseOk('0.5'))).toBe(50)
  })

  it('trims surrounding whitespace', () => {
    expect(centsValue(parseOk('  3333.34  '))).toBe(333_334)
  })

  it('parses negative amounts', () => {
    expect(centsValue(parseOk('-250.25'))).toBe(-25_025)
  })

  it('avoids binary floating-point error on values that are not exactly representable', () => {
    // 0.1 + 0.2 !== 0.3 in float; parsing must not go through that path.
    expect(centsValue(parseOk('0.1')) + centsValue(parseOk('0.2'))).toBe(
      centsValue(parseOk('0.3')),
    )
    // 3333.34 * 100 is 333333.99999999994 as a float multiplication.
    expect(centsValue(parseOk('3333.34'))).toBe(333_334)
  })
})

describe('parseRupees rejects over-precise input', () => {
  it('rejects more than 2 decimal places rather than truncating', () => {
    const result = parseRupees('12000.005')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/2 decimal places/)
  })

  it.each(['1.234', '0.001', '99.999', '10,000.5551'])(
    'rejects %s',
    (input) => {
      expect(parseRupees(input).ok).toBe(false)
    },
  )

  it('does not round over-precise input to the nearest cent', () => {
    // The danger case: silently accepting this as Rs. 12000.01 would put a
    // value in the ledger the user never typed.
    expect(parseRupees('12000.005').ok).toBe(false)
  })
})

describe('parseRupees rejects malformed input', () => {
  it.each([
    '',
    '   ',
    'abc',
    'Rs. 100',
    '12000.',
    '.',
    '1,00,000', // wrong grouping
    '12,00', // wrong grouping
    '1..2',
    '1 000',
    '--5',
    '5-',
    '1e3', // scientific notation is not user-typed money
    'NaN',
    'Infinity',
  ])('rejects %j', (input) => {
    expect(parseRupees(input).ok).toBe(false)
  })

  it('returns a usable message for empty input', () => {
    const result = parseRupees('')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('Enter an amount.')
  })
})

describe('formatCents', () => {
  it('always shows exactly two decimal places', () => {
    expect(formatCents(toCents(0))).toBe('Rs. 0.00')
    expect(formatCents(toCents(500))).toBe('Rs. 5.00')
    expect(formatCents(toCents(5))).toBe('Rs. 0.05')
  })

  it('pads a single-digit cents remainder', () => {
    // Rs. 10.05 must not render as "Rs. 10.5".
    expect(formatCents(toCents(1005))).toBe('Rs. 10.05')
  })

  it('groups thousands', () => {
    expect(formatCents(toCents(1_200_000))).toBe('Rs. 12,000.00')
    expect(formatCents(toCents(1_050_000_075))).toBe('Rs. 10,500,000.75')
  })

  it('formats negative amounts with the sign before the currency', () => {
    expect(formatCents(toCents(-25_025))).toBe('-Rs. 250.25')
  })
})

describe('toCents', () => {
  it('rejects non-integers, which indicate a float leaked into the money path', () => {
    expect(() => toCents(10.5)).toThrow(/whole number/)
  })

  it('rejects unsafe integers', () => {
    expect(() => toCents(Number.MAX_SAFE_INTEGER + 2)).toThrow()
  })

  it('accepts zero and negatives', () => {
    expect(centsValue(toCents(0))).toBe(0)
    expect(centsValue(toCents(-1))).toBe(-1)
  })
})
