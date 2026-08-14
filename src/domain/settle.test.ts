import { describe, expect, it } from 'vitest'
import { centsValue, toCents } from './money'
import {
  computeBalances,
  type Balances,
  type Expense,
  type Person,
} from './balances'
import { applyTransactions, settleUp, type Transaction } from './settle'

function ok(result: ReturnType<typeof computeBalances>): Balances {
  if (!result.ok) throw new Error(`Expected balances to compute: ${result.error}`)
  return result.balances
}

function sumBalances(balances: Balances): number {
  return Object.values(balances).reduce((a, b) => a + centsValue(b), 0)
}

/** Deterministic PRNG so a property-test failure is reproducible. */
function makeRng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function plain(transactions: Transaction[]) {
  return transactions.map((t) => ({
    from: t.from,
    to: t.to,
    amount: centsValue(t.amount),
  }))
}

// ---------------------------------------------------------------------------
// The scenario from ASSIGNMENT.md, "Try This Before You Submit".
// ---------------------------------------------------------------------------

describe('ASSIGNMENT.md scenario: Alice, Bob, Carol, Dave', () => {
  const people: Person[] = [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'carol', name: 'Carol' },
    { id: 'dave', name: 'Dave' },
  ]

  const expenses: Expense[] = [
    {
      id: 'e1',
      description: 'Dinner',
      amount: toCents(1_200_000), // Rs. 12,000
      paidBy: 'alice',
      split: {
        kind: 'equal',
        participantIds: ['alice', 'bob', 'carol', 'dave'],
      },
    },
    {
      id: 'e2',
      description: 'Hotel',
      amount: toCents(1_000_000), // Rs. 10,000
      paidBy: 'carol',
      split: {
        kind: 'exact',
        shares: {
          alice: toCents(333_333),
          bob: toCents(333_333),
          dave: toCents(333_334),
        },
      },
    },
    {
      id: 'e3',
      description: 'Gas',
      amount: toCents(600_000), // Rs. 6,000
      paidBy: 'dave',
      split: { kind: 'equal', participantIds: ['bob', 'dave'] },
    },
  ]

  const balances = ok(computeBalances(people, expenses))

  it('produces the hand-computed balances', () => {
    // Alice: +1,200,000 paid, -300,000 dinner, -333,333 hotel
    expect(centsValue(balances.alice)).toBe(566_667)
    // Bob: -300,000 dinner, -333,333 hotel, -300,000 gas
    expect(centsValue(balances.bob)).toBe(-933_333)
    // Carol: +1,000,000 paid, -300,000 dinner (not in the hotel split)
    expect(centsValue(balances.carol)).toBe(700_000)
    // Dave: +600,000 paid, -300,000 dinner, -333,334 hotel, -300,000 gas
    expect(centsValue(balances.dave)).toBe(-333_334)
  })

  it('balances sum to exactly zero', () => {
    expect(sumBalances(balances)).toBe(0)
  })

  it('includes everyone exactly once, with nobody double-counted or missing', () => {
    expect(Object.keys(balances).sort()).toEqual(['alice', 'bob', 'carol', 'dave'])
  })

  it('excludes Carol from the hotel split she paid for', () => {
    // Carol is owed the full hotel amount less only her dinner share.
    expect(centsValue(balances.carol)).toBe(1_000_000 - 300_000)
  })

  it('charges only Bob and Dave for the gas', () => {
    const withoutGas = ok(computeBalances(people, expenses.slice(0, 2)))
    expect(centsValue(balances.alice)).toBe(centsValue(withoutGas.alice))
    expect(centsValue(balances.carol)).toBe(centsValue(withoutGas.carol))
  })

  it('settles with this exact transaction set', () => {
    // Bob owes most, Carol is owed most: Bob → Carol clears Carol entirely.
    // Bob's remaining 233,333 goes to Alice; Dave's 333,334 clears Alice.
    expect(plain(settleUp(balances))).toEqual([
      { from: 'bob', to: 'carol', amount: 700_000 },
      { from: 'bob', to: 'alice', amount: 233_333 },
      { from: 'dave', to: 'alice', amount: 333_334 },
    ])
  })

  it('settles in at most n-1 transactions, not every pairwise debt', () => {
    const transactions = settleUp(balances)
    expect(transactions.length).toBeLessThanOrEqual(people.length - 1)
    expect(transactions).toHaveLength(3)
  })

  it('drives every balance to exactly zero when the transactions are applied', () => {
    const settled = applyTransactions(balances, settleUp(balances))
    for (const id of Object.keys(settled)) {
      expect(centsValue(settled[id])).toBe(0)
    }
  })

  it('is unaffected by the order expenses are entered in', () => {
    const reordered = ok(computeBalances(people, [expenses[2], expenses[0], expenses[1]]))
    expect(reordered).toEqual(balances)
  })
})

// ---------------------------------------------------------------------------
// computeBalances
// ---------------------------------------------------------------------------

describe('computeBalances', () => {
  const people: Person[] = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ]

  it('returns all-zero balances for no expenses', () => {
    const balances = ok(computeBalances(people, []))
    expect(Object.values(balances).map(centsValue)).toEqual([0, 0, 0])
  })

  it('includes people who took part in no expenses', () => {
    const balances = ok(
      computeBalances(people, [
        {
          id: 'e1',
          description: 'Lunch',
          amount: toCents(1000),
          paidBy: 'a',
          split: { kind: 'equal', participantIds: ['a', 'b'] },
        },
      ]),
    )
    expect(centsValue(balances.c)).toBe(0)
  })

  it('nets to zero when the payer is also the only participant', () => {
    const balances = ok(
      computeBalances(people, [
        {
          id: 'e1',
          description: 'Solo coffee',
          amount: toCents(500),
          paidBy: 'a',
          split: { kind: 'equal', participantIds: ['a'] },
        },
      ]),
    )
    expect(centsValue(balances.a)).toBe(0)
  })

  it('sums to zero for an uneven three-way split', () => {
    // Rs. 100 / 3 — the rounding case from the assignment.
    const balances = ok(
      computeBalances(people, [
        {
          id: 'e1',
          description: 'Rs 100 three ways',
          amount: toCents(10_000),
          paidBy: 'a',
          split: { kind: 'equal', participantIds: ['a', 'b', 'c'] },
        },
      ]),
    )
    expect(sumBalances(balances)).toBe(0)
    // The payer absorbs their own share; 10000 - 3334 = 6666 owed to them.
    expect(centsValue(balances.a)).toBe(6666)
  })

  it('handles percentage splits', () => {
    const balances = ok(
      computeBalances(people, [
        {
          id: 'e1',
          description: 'Hotel',
          amount: toCents(1_000_000),
          paidBy: 'a',
          split: { kind: 'percentage', percentages: { a: 40, b: 30, c: 30 } },
        },
      ]),
    )
    expect(centsValue(balances.a)).toBe(600_000)
    expect(centsValue(balances.b)).toBe(-300_000)
    expect(sumBalances(balances)).toBe(0)
  })

  it('rejects an expense paid by an unknown person', () => {
    const result = computeBalances(people, [
      {
        id: 'e1',
        description: 'Ghost',
        amount: toCents(1000),
        paidBy: 'zzz',
        split: { kind: 'equal', participantIds: ['a'] },
      },
    ])
    expect(result.ok).toBe(false)
  })

  it('rejects an expense split to an unknown person', () => {
    const result = computeBalances(people, [
      {
        id: 'e1',
        description: 'Ghost',
        amount: toCents(1000),
        paidBy: 'a',
        split: { kind: 'equal', participantIds: ['a', 'zzz'] },
      },
    ])
    expect(result.ok).toBe(false)
  })

  it('surfaces an invalid split rather than silently skipping the expense', () => {
    const result = computeBalances(people, [
      {
        id: 'e1',
        description: 'Bad exact',
        amount: toCents(10_000),
        paidBy: 'a',
        split: { kind: 'exact', shares: { a: toCents(4000), b: toCents(5000) } },
      },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Bad exact/)
  })

  it('is derived from scratch, so deleting an expense restores prior balances', () => {
    const first: Expense = {
      id: 'e1',
      description: 'One',
      amount: toCents(9999),
      paidBy: 'a',
      split: { kind: 'equal', participantIds: ['a', 'b', 'c'] },
    }
    const second: Expense = {
      id: 'e2',
      description: 'Two',
      amount: toCents(5555),
      paidBy: 'b',
      split: { kind: 'equal', participantIds: ['b', 'c'] },
    }

    const before = ok(computeBalances(people, [first]))
    const after = ok(computeBalances(people, [first, second]))
    const deleted = ok(computeBalances(people, [first]))

    expect(deleted).toEqual(before)
    expect(after).not.toEqual(before)
  })

  it('sums to zero across many mixed expenses', () => {
    const rng = makeRng(4242)
    const expenses: Expense[] = []
    for (let i = 0; i < 200; i++) {
      const ids = ['a', 'b', 'c'].filter(() => rng() > 0.3)
      if (ids.length === 0) ids.push('a')
      expenses.push({
        id: `e${i}`,
        description: `Expense ${i}`,
        amount: toCents(1 + Math.floor(rng() * 1_000_000)),
        paidBy: ['a', 'b', 'c'][Math.floor(rng() * 3)],
        split: { kind: 'equal', participantIds: ids },
      })
    }
    expect(sumBalances(ok(computeBalances(people, expenses)))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// settleUp
// ---------------------------------------------------------------------------

describe('settleUp', () => {
  const balancesOf = (o: Record<string, number>): Balances => {
    const out: Balances = {}
    for (const [k, v] of Object.entries(o)) out[k] = toCents(v)
    return out
  }

  it('returns nothing when everyone is already settled', () => {
    expect(settleUp(balancesOf({ a: 0, b: 0, c: 0 }))).toEqual([])
  })

  it('returns nothing for an empty balance sheet', () => {
    expect(settleUp({})).toEqual([])
  })

  it('settles a simple two-person debt in one transaction', () => {
    expect(plain(settleUp(balancesOf({ a: -5000, b: 5000 })))).toEqual([
      { from: 'a', to: 'b', amount: 5000 },
    ])
  })

  it('matches the largest debtor to the largest creditor first', () => {
    const transactions = plain(
      settleUp(balancesOf({ big: -10_000, small: -1000, rich: 9000, poor: 2000 })),
    )
    expect(transactions[0].from).toBe('big')
    expect(transactions[0].to).toBe('rich')
  })

  it('emits at most n-1 transactions for n non-zero balances', () => {
    for (const n of [2, 3, 4, 5, 8, 12, 25]) {
      // One creditor owed everything, n-1 debtors each owing an equal share.
      const balances: Record<string, number> = {}
      const each = 1000
      for (let i = 0; i < n - 1; i++) balances[`d${i}`] = -each
      balances.creditor = each * (n - 1)

      const transactions = settleUp(balancesOf(balances))
      expect(transactions.length).toBeLessThanOrEqual(n - 1)
    }
  })

  it('ignores people with a zero balance', () => {
    const transactions = settleUp(balancesOf({ a: -5000, b: 5000, idle: 0 }))
    const involved = transactions.flatMap((t) => [t.from, t.to])
    expect(involved).not.toContain('idle')
  })

  it('never emits a zero-amount transaction', () => {
    const transactions = settleUp(
      balancesOf({ a: -3000, b: -2000, c: 4000, d: 1000, e: 0 }),
    )
    for (const t of transactions) {
      expect(centsValue(t.amount)).toBeGreaterThan(0)
    }
  })

  it('never emits a transaction from a person to themselves', () => {
    const transactions = settleUp(
      balancesOf({ a: -3000, b: -2000, c: 4000, d: 1000 }),
    )
    for (const t of transactions) {
      expect(t.from).not.toBe(t.to)
    }
  })

  it('is deterministic, including when amounts tie', () => {
    // Two debtors and two creditors, all the same size — ties must break by id.
    const balances = balancesOf({ zed: -1000, adam: -1000, yara: 1000, beth: 1000 })
    const first = plain(settleUp(balances))
    for (let i = 0; i < 25; i++) {
      expect(plain(settleUp(balances))).toEqual(first)
    }
    // Tie-break is alphabetical, so the alphabetically-first debtor goes first.
    expect(first[0].from).toBe('adam')
  })

  it('handles one debtor owing many creditors', () => {
    const transactions = settleUp(balancesOf({ a: -6000, b: 1000, c: 2000, d: 3000 }))
    expect(transactions).toHaveLength(3)
    expect(transactions.every((t) => t.from === 'a')).toBe(true)
  })

  it('handles many debtors owing one creditor', () => {
    const transactions = settleUp(balancesOf({ a: -1000, b: -2000, c: -3000, d: 6000 }))
    expect(transactions).toHaveLength(3)
    expect(transactions.every((t) => t.to === 'd')).toBe(true)
  })

  it('settles a one-cent imbalance', () => {
    expect(plain(settleUp(balancesOf({ a: -1, b: 1 })))).toEqual([
      { from: 'a', to: 'b', amount: 1 },
    ])
  })

  it('finds the optimal 2 transactions when subsets cancel exactly', () => {
    // a/b cancel, c/d cancel — greedy happens to find the optimum here.
    const transactions = settleUp(balancesOf({ a: -5000, b: 5000, c: -3000, d: 3000 }))
    expect(transactions).toHaveLength(2)
  })
})

describe('settleUp — property: settlement always zeroes everyone out', () => {
  it('holds over 1000 random balance sheets', () => {
    const rng = makeRng(20_260_814)
    const failures: string[] = []

    for (let iteration = 0; iteration < 1000; iteration++) {
      const n = 2 + Math.floor(rng() * 14) // 2–15 people
      const ids = Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}`)

      // Build a sheet that already sums to zero: random amounts, with the last
      // person absorbing the negation of the rest.
      const raw: Record<string, number> = {}
      let running = 0
      for (let i = 0; i < n - 1; i++) {
        const value = Math.floor(rng() * 2_000_000) - 1_000_000
        raw[ids[i]] = value
        running += value
      }
      raw[ids[n - 1]] = -running

      const balances: Balances = {}
      for (const [id, v] of Object.entries(raw)) balances[id] = toCents(v)

      const transactions = settleUp(balances)
      const settled = applyTransactions(balances, transactions)

      for (const id of ids) {
        if (centsValue(settled[id]) !== 0) {
          failures.push(
            `iteration ${iteration}: ${id} left at ${centsValue(settled[id])}`,
          )
        }
      }

      const nonZero = Object.values(balances).filter((b) => centsValue(b) !== 0).length
      if (nonZero > 0 && transactions.length > nonZero - 1) {
        failures.push(
          `iteration ${iteration}: ${transactions.length} transactions for ${nonZero} non-zero balances`,
        )
      }

      for (const t of transactions) {
        if (t.from === t.to) failures.push(`iteration ${iteration}: self-transaction`)
        if (centsValue(t.amount) <= 0) {
          failures.push(`iteration ${iteration}: non-positive amount`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('holds end-to-end: random expenses → balances → settlement → all zero', () => {
    const rng = makeRng(31_337)
    const people: Person[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: `Person ${i}`,
    }))

    for (let iteration = 0; iteration < 200; iteration++) {
      const expenses: Expense[] = []
      const count = 1 + Math.floor(rng() * 10)

      for (let i = 0; i < count; i++) {
        const participants = people.map((p) => p.id).filter(() => rng() > 0.35)
        if (participants.length === 0) participants.push(people[0].id)
        expenses.push({
          id: `e${i}`,
          description: `Expense ${i}`,
          amount: toCents(1 + Math.floor(rng() * 5_000_000)),
          paidBy: people[Math.floor(rng() * people.length)].id,
          split: { kind: 'equal', participantIds: participants },
        })
      }

      const balances = ok(computeBalances(people, expenses))
      expect(sumBalances(balances)).toBe(0)

      const settled = applyTransactions(balances, settleUp(balances))
      for (const person of people) {
        expect(centsValue(settled[person.id])).toBe(0)
      }
    }
  })
})
