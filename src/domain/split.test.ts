import { describe, expect, it } from 'vitest'
import { centsValue, toCents, type Cents } from './money'
import {
  distributeRemainder,
  splitEqual,
  splitExact,
  splitPercentage,
  type PersonId,
  type Shares,
} from './split'

/** Unwrap a split expected to succeed. */
function ok(result: ReturnType<typeof splitEqual>): Shares {
  if (!result.ok) throw new Error(`Expected split to succeed: ${result.error}`)
  return result.shares
}

function sumShares(shares: Shares): number {
  return Object.values(shares).reduce((a, c) => a + centsValue(c), 0)
}

function sumArray(amounts: Cents[]): number {
  return amounts.reduce((a, c) => a + centsValue(c), 0)
}

/** Deterministic PRNG so a property-test failure is reproducible. */
function makeRng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

describe('distributeRemainder', () => {
  it('sums to exactly the total', () => {
    expect(sumArray(distributeRemainder(toCents(10_000), 3))).toBe(10_000)
  })

  it('uses the largest-remainder method: Rs. 100 / 3 → 3334, 3333, 3333', () => {
    const amounts = distributeRemainder(toCents(10_000), 3)
    expect(amounts.map(centsValue)).toEqual([3334, 3333, 3333])
  })

  it('gives one extra cent to exactly `remainder` recipients', () => {
    // 10 cents across 4 → base 2, remainder 2 → two recipients get 3.
    expect(distributeRemainder(toCents(10), 4).map(centsValue)).toEqual([3, 3, 2, 2])
  })

  it('splits evenly when the total divides exactly', () => {
    expect(distributeRemainder(toCents(9000), 3).map(centsValue)).toEqual([
      3000, 3000, 3000,
    ])
  })

  it('returns the full total for a single recipient', () => {
    expect(distributeRemainder(toCents(7777), 1).map(centsValue)).toEqual([7777])
  })

  it('handles a total smaller than the recipient count', () => {
    // 2 cents across 5 people: two get a cent, three get nothing, sum is still 2.
    const amounts = distributeRemainder(toCents(2), 5)
    expect(amounts.map(centsValue)).toEqual([1, 1, 0, 0, 0])
    expect(sumArray(amounts)).toBe(2)
  })

  it('handles zero', () => {
    const amounts = distributeRemainder(toCents(0), 4)
    expect(sumArray(amounts)).toBe(0)
    expect(amounts.every((c) => centsValue(c) === 0)).toBe(true)
  })

  it('sums exactly for negative totals (refunds)', () => {
    const amounts = distributeRemainder(toCents(-10_000), 3)
    expect(amounts.map(centsValue)).toEqual([-3334, -3333, -3333])
    expect(sumArray(amounts)).toBe(-10_000)
  })

  it('returns exactly n amounts', () => {
    expect(distributeRemainder(toCents(500), 7)).toHaveLength(7)
  })

  it.each([0, -1, 1.5, NaN])('rejects an invalid recipient count: %p', (n) => {
    expect(() => distributeRemainder(toCents(100), n)).toThrow()
  })

  it('never spreads the remainder more than one cent per person', () => {
    const amounts = distributeRemainder(toCents(10_001), 3).map(centsValue)
    expect(Math.max(...amounts) - Math.min(...amounts)).toBe(1)
  })
})

describe('splitEqual', () => {
  it('Rs. 100 three ways sums to exactly 10000 cents', () => {
    const shares = ok(splitEqual(toCents(10_000), ['alice', 'bob', 'carol']))
    expect(sumShares(shares)).toBe(10_000)
    expect(Object.values(shares).map(centsValue).sort((a, b) => b - a)).toEqual([
      3334, 3333, 3333,
    ])
  })

  it('returns the full total when splitting across 1 person', () => {
    const shares = ok(splitEqual(toCents(12_345), ['alice']))
    expect(centsValue(shares.alice)).toBe(12_345)
  })

  it('rejects a split across 0 participants', () => {
    const result = splitEqual(toCents(10_000), [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/at least one person/)
  })

  it('rejects a duplicated participant rather than charging them twice', () => {
    const result = splitEqual(toCents(10_000), ['alice', 'bob', 'alice'])
    expect(result.ok).toBe(false)
  })

  it('includes every participant exactly once', () => {
    const ids = ['alice', 'bob', 'carol', 'dave']
    const shares = ok(splitEqual(toCents(12_000), ids))
    expect(Object.keys(shares).sort()).toEqual([...ids].sort())
  })

  it('allocates the remainder in sorted id order, not input order', () => {
    // Same set, two input orders — the extra cent must land on the same person.
    const a = ok(splitEqual(toCents(10_000), ['carol', 'alice', 'bob']))
    const b = ok(splitEqual(toCents(10_000), ['bob', 'carol', 'alice']))
    expect(a).toEqual(b)
    expect(centsValue(a.alice)).toBe(3334)
  })

  it('is deterministic across repeated calls', () => {
    const ids = ['dave', 'alice', 'carol', 'bob', 'erin', 'frank', 'grace']
    const first = ok(splitEqual(toCents(10_000), ids))
    for (let i = 0; i < 50; i++) {
      expect(ok(splitEqual(toCents(10_000), ids))).toEqual(first)
    }
  })

  it('sums exactly for every group size from 1 to 100', () => {
    for (let n = 1; n <= 100; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`)
      expect(sumShares(ok(splitEqual(toCents(10_000), ids)))).toBe(10_000)
    }
  })
})

describe('splitEqual — property: shares always sum to the total exactly', () => {
  it('holds over 1000 random (total, participantCount) pairs', () => {
    const rng = makeRng(20_260_814)
    const failures: string[] = []

    for (let iteration = 0; iteration < 1000; iteration++) {
      // Up to Rs. 10,000,000 in cents, and 1–40 participants.
      const total = Math.floor(rng() * 1_000_000_000)
      const n = 1 + Math.floor(rng() * 40)
      const ids = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`)

      const shares = ok(splitEqual(toCents(total), ids))
      const sum = sumShares(shares)

      if (sum !== total) {
        failures.push(`total=${total} n=${n} sum=${sum}`)
      }
      if (Object.keys(shares).length !== n) {
        failures.push(`total=${total} n=${n} produced ${Object.keys(shares).length} shares`)
      }
    }

    expect(failures).toEqual([])
  })

  it('never differs by more than one cent between any two participants', () => {
    const rng = makeRng(7)
    for (let iteration = 0; iteration < 200; iteration++) {
      const total = Math.floor(rng() * 10_000_000)
      const n = 1 + Math.floor(rng() * 25)
      const ids = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`)
      const amounts = Object.values(ok(splitEqual(toCents(total), ids))).map(centsValue)
      expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
    }
  })
})

describe('splitExact', () => {
  const shares = (o: Record<PersonId, number>): Shares => {
    const out: Shares = {}
    for (const [k, v] of Object.entries(o)) out[k] = toCents(v)
    return out
  }

  it('accepts shares that sum to the total', () => {
    // The assignment scenario's exact-amount step.
    const result = splitExact(
      toCents(1_000_000),
      shares({ alice: 333_333, bob: 333_333, dave: 333_334 }),
    )
    expect(result.ok).toBe(true)
    expect(sumShares(ok(result))).toBe(1_000_000)
  })

  it('passes the shares through unchanged', () => {
    const input = shares({ alice: 333_333, bob: 333_333, dave: 333_334 })
    expect(ok(splitExact(toCents(1_000_000), input))).toEqual(input)
  })

  it('does not alias the caller-supplied object', () => {
    const input = shares({ alice: 5000, bob: 5000 })
    const result = ok(splitExact(toCents(10_000), input))
    expect(result).not.toBe(input)
  })

  it('rejects shares that are under the total', () => {
    const result = splitExact(toCents(10_000), shares({ alice: 4000, bob: 5000 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/under by Rs\. 10\.00/)
  })

  it('rejects shares that are over the total', () => {
    const result = splitExact(toCents(10_000), shares({ alice: 6000, bob: 5000 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/over by Rs\. 10\.00/)
  })

  it('rejects a one-cent mismatch — the case that would break sum-to-zero', () => {
    expect(splitExact(toCents(10_000), shares({ alice: 5000, bob: 5001 })).ok).toBe(
      false,
    )
  })

  it('rejects an empty share set', () => {
    expect(splitExact(toCents(10_000), {}).ok).toBe(false)
  })

  it('accepts a zero share for a participant', () => {
    const result = splitExact(toCents(10_000), shares({ alice: 10_000, bob: 0 }))
    expect(result.ok).toBe(true)
    expect(sumShares(ok(result))).toBe(10_000)
  })
})

describe('splitPercentage', () => {
  it('splits 40/30/30 exactly', () => {
    // The assignment's percentage variant.
    const result = ok(
      splitPercentage(toCents(1_000_000), { alice: 40, bob: 30, dave: 30 }),
    )
    expect(centsValue(result.alice)).toBe(400_000)
    expect(centsValue(result.bob)).toBe(300_000)
    expect(centsValue(result.dave)).toBe(300_000)
    expect(sumShares(result)).toBe(1_000_000)
  })

  it('distributes leftover cents so an uneven percentage split still sums exactly', () => {
    // 33.33 / 33.33 / 33.34 of Rs. 100 does not divide cleanly.
    const result = ok(
      splitPercentage(toCents(10_000), { alice: 33.33, bob: 33.33, carol: 33.34 }),
    )
    expect(sumShares(result)).toBe(10_000)
  })

  it('sums exactly for thirds that float arithmetic would break', () => {
    const result = ok(
      splitPercentage(toCents(10_001), { a: 33.33, b: 33.33, c: 33.34 }),
    )
    expect(sumShares(result)).toBe(10_001)
  })

  it('handles 100% to a single person', () => {
    const result = ok(splitPercentage(toCents(12_345), { alice: 100 }))
    expect(centsValue(result.alice)).toBe(12_345)
  })

  it('accepts a 0% participant', () => {
    const result = ok(splitPercentage(toCents(10_000), { alice: 100, bob: 0 }))
    expect(centsValue(result.bob)).toBe(0)
    expect(sumShares(result)).toBe(10_000)
  })

  it('rejects percentages that do not add up to 100', () => {
    const result = splitPercentage(toCents(10_000), { alice: 50, bob: 40 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/add up to 100%/)
    expect(result.error).toMatch(/under by 10\.00%/)
  })

  it('rejects percentages summing over 100', () => {
    const result = splitPercentage(toCents(10_000), { alice: 60, bob: 50 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/over by 10\.00%/)
  })

  it('accepts 33.33/33.33/33.34, which floats would not sum to 100', () => {
    expect(
      splitPercentage(toCents(10_000), { a: 33.33, b: 33.33, c: 33.34 }).ok,
    ).toBe(true)
  })

  it('rejects a negative percentage', () => {
    expect(splitPercentage(toCents(10_000), { alice: 110, bob: -10 }).ok).toBe(false)
  })

  it('rejects an empty percentage set', () => {
    expect(splitPercentage(toCents(10_000), {}).ok).toBe(false)
  })

  it('is deterministic across repeated calls', () => {
    const pcts = { dave: 33.33, alice: 33.33, carol: 33.34 }
    const first = ok(splitPercentage(toCents(10_000), pcts))
    for (let i = 0; i < 50; i++) {
      expect(ok(splitPercentage(toCents(10_000), pcts))).toEqual(first)
    }
  })

  it('property: sums exactly across 500 random totals at 33.33/33.33/33.34', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 500; i++) {
      const total = Math.floor(rng() * 100_000_000)
      const result = ok(
        splitPercentage(toCents(total), { a: 33.33, b: 33.33, c: 33.34 }),
      )
      expect(sumShares(result)).toBe(total)
    }
  })
})

describe('all three modes sum to the total exactly', () => {
  it('agrees across modes for the same underlying split', () => {
    const total = toCents(1_000_000)

    const equal = ok(splitEqual(total, ['alice', 'bob', 'carol', 'dave']))
    expect(sumShares(equal)).toBe(1_000_000)

    const exact = ok(
      splitExact(total, {
        alice: toCents(250_000),
        bob: toCents(250_000),
        carol: toCents(250_000),
        dave: toCents(250_000),
      }),
    )
    expect(sumShares(exact)).toBe(1_000_000)

    const pct = ok(
      splitPercentage(total, { alice: 25, bob: 25, carol: 25, dave: 25 }),
    )
    expect(sumShares(pct)).toBe(1_000_000)

    // An even 4-way split is the same however it is expressed.
    expect(equal).toEqual(exact)
    expect(equal).toEqual(pct)
  })
})
