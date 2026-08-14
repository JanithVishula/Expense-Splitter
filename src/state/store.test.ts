import { beforeEach, describe, expect, it } from 'vitest'
import { centsValue, toCents } from './../domain/money'
import type { Balances } from '../domain/balances'
import { Store, STORAGE_KEY } from './store'
import { memoryStorage, type Storage } from './storage'

/** Sequential ids so tests can reference them predictably. */
function sequentialIds() {
  let n = 0
  return () => `id${++n}`
}

function makeStore(storage: Storage = memoryStorage()) {
  return new Store({ storage, generateId: sequentialIds() })
}

function balancesOf(store: Store): Balances {
  const result = store.getBalances()
  if (!result.ok) throw new Error(`Expected balances: ${result.error}`)
  return result.balances
}

function sumBalances(balances: Balances): number {
  return Object.values(balances).reduce((a, b) => a + centsValue(b), 0)
}

function expect_ok(result: { ok: boolean; error?: string }) {
  if (!result.ok) throw new Error(`Expected success, got: ${result.error}`)
}

/**
 * The Phase 3 four-person scenario, built through the store's public API.
 * Returns the generated ids so tests can address people and expenses.
 */
function buildScenario(storage: Storage = memoryStorage()) {
  const store = makeStore(storage)

  expect_ok(store.addPerson('Alice'))
  expect_ok(store.addPerson('Bob'))
  expect_ok(store.addPerson('Carol'))
  expect_ok(store.addPerson('Dave'))

  const [alice, bob, carol, dave] = store.getPeople().map((p) => p.id)

  expect_ok(
    store.addExpense({
      description: 'Dinner',
      amount: toCents(1_200_000),
      paidBy: alice,
      split: { kind: 'equal', participantIds: [alice, bob, carol, dave] },
    }),
  )
  expect_ok(
    store.addExpense({
      description: 'Hotel',
      amount: toCents(1_000_000),
      paidBy: carol,
      split: {
        kind: 'exact',
        shares: {
          [alice]: toCents(333_333),
          [bob]: toCents(333_333),
          [dave]: toCents(333_334),
        },
      },
    }),
  )
  expect_ok(
    store.addExpense({
      description: 'Gas',
      amount: toCents(600_000),
      paidBy: dave,
      split: { kind: 'equal', participantIds: [bob, dave] },
    }),
  )

  const expenseIds = store.getExpenses().map((e) => e.id)

  return { store, alice, bob, carol, dave, expenseIds }
}

describe('Store — the four-person scenario', () => {
  it('reproduces the Phase 3 balances through the store API', () => {
    const { store, alice, bob, carol, dave } = buildScenario()
    const balances = balancesOf(store)

    expect(centsValue(balances[alice])).toBe(566_667)
    expect(centsValue(balances[bob])).toBe(-933_333)
    expect(centsValue(balances[carol])).toBe(700_000)
    expect(centsValue(balances[dave])).toBe(-333_334)
    expect(sumBalances(balances)).toBe(0)
  })

  it('produces the expected settlement', () => {
    const { store, alice, bob, carol, dave } = buildScenario()
    const settlement = store.getSettlement()
    expect(settlement.ok).toBe(true)
    if (!settlement.ok) return

    expect(
      settlement.transactions.map((t) => ({
        from: t.from,
        to: t.to,
        amount: centsValue(t.amount),
      })),
    ).toEqual([
      { from: bob, to: carol, amount: 700_000 },
      { from: bob, to: alice, amount: 233_333 },
      { from: dave, to: alice, amount: 333_334 },
    ])
  })
})

describe('Store — editing an expense recomputes balances', () => {
  it('recomputes correctly when expense 2 changes amount, and still sums to zero', () => {
    const { store, alice, bob, carol, dave, expenseIds } = buildScenario()

    // The hotel was an exact split summing to 1,000,000. Changing only the
    // amount would leave the shares inconsistent, so update both together —
    // this is what the UI will do when the user edits an exact-split expense.
    expect_ok(
      store.updateExpense(expenseIds[1], {
        amount: toCents(1_500_000),
        split: {
          kind: 'exact',
          shares: {
            [alice]: toCents(500_000),
            [bob]: toCents(500_000),
            [dave]: toCents(500_000),
          },
        },
      }),
    )

    const balances = balancesOf(store)

    // Alice: +1,200,000 paid, -300,000 dinner, -500,000 hotel
    expect(centsValue(balances[alice])).toBe(400_000)
    // Bob: -300,000 dinner, -500,000 hotel, -300,000 gas
    expect(centsValue(balances[bob])).toBe(-1_100_000)
    // Carol: +1,500,000 paid, -300,000 dinner
    expect(centsValue(balances[carol])).toBe(1_200_000)
    // Dave: +600,000 paid, -300,000 dinner, -500,000 hotel, -300,000 gas
    expect(centsValue(balances[dave])).toBe(-500_000)

    expect(sumBalances(balances)).toBe(0)
  })

  it('rejects an amount edit that leaves exact shares inconsistent', () => {
    const { store, expenseIds } = buildScenario()
    // Changing the amount alone would make the shares no longer sum to it.
    const result = store.updateExpense(expenseIds[1], { amount: toCents(1_500_000) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/add up to the total/)
  })

  it('leaves balances untouched when an edit is rejected', () => {
    const { store, expenseIds } = buildScenario()
    const before = balancesOf(store)
    store.updateExpense(expenseIds[1], { amount: toCents(1_500_000) })
    expect(balancesOf(store)).toEqual(before)
  })

  it('recomputes when an equal-split expense changes amount', () => {
    const { store, alice, expenseIds } = buildScenario()
    expect_ok(store.updateExpense(expenseIds[0], { amount: toCents(1_600_000) }))

    const balances = balancesOf(store)
    // Alice: +1,600,000 paid, -400,000 dinner, -333,333 hotel
    expect(centsValue(balances[alice])).toBe(866_667)
    expect(sumBalances(balances)).toBe(0)
  })

  it('recomputes when the payer changes', () => {
    const { store, alice, bob, expenseIds } = buildScenario()
    expect_ok(store.updateExpense(expenseIds[0], { paidBy: bob }))

    const balances = balancesOf(store)
    // Alice no longer paid the dinner: -300,000 dinner, -333,333 hotel.
    expect(centsValue(balances[alice])).toBe(-633_333)
    expect(sumBalances(balances)).toBe(0)
  })

  it('recomputes when the participant list changes', () => {
    const { store, alice, carol, expenseIds } = buildScenario()
    // Drop Carol from the dinner: now split three ways.
    expect_ok(
      store.updateExpense(expenseIds[0], {
        split: {
          kind: 'equal',
          participantIds: store
            .getPeople()
            .map((p) => p.id)
            .filter((id) => id !== carol),
        },
      }),
    )

    const balances = balancesOf(store)
    // Carol now owes nothing on dinner; she is owed the full hotel amount.
    expect(centsValue(balances[carol])).toBe(1_000_000)
    // Alice: +1,200,000 paid, -400,000 dinner, -333,333 hotel
    expect(centsValue(balances[alice])).toBe(466_667)
    expect(sumBalances(balances)).toBe(0)
  })
})

describe('Store — deleting an expense', () => {
  it('returns balances to exactly their pre-expense-3 values', () => {
    const { store, expenseIds } = buildScenario()

    // Capture balances as they were before Gas existed, by deleting and
    // comparing against a store built with only the first two expenses.
    const withoutGas = buildScenario()
    expect_ok(withoutGas.store.deleteExpense(withoutGas.expenseIds[2]))
    const expected = balancesOf(withoutGas.store)

    expect_ok(store.deleteExpense(expenseIds[2]))
    expect(balancesOf(store)).toEqual(expected)
  })

  it('restores the exact balances captured before the expense was added', () => {
    const storage = memoryStorage()
    const store = makeStore(storage)

    expect_ok(store.addPerson('Alice'))
    expect_ok(store.addPerson('Bob'))
    const [alice, bob] = store.getPeople().map((p) => p.id)

    expect_ok(
      store.addExpense({
        description: 'First',
        amount: toCents(9999),
        paidBy: alice,
        split: { kind: 'equal', participantIds: [alice, bob] },
      }),
    )
    const before = balancesOf(store)

    expect_ok(
      store.addExpense({
        description: 'Second',
        amount: toCents(5555),
        paidBy: bob,
        split: { kind: 'equal', participantIds: [alice, bob] },
      }),
    )
    const after = balancesOf(store)
    expect(after).not.toEqual(before)

    const secondId = store.getExpenses()[1].id
    expect_ok(store.deleteExpense(secondId))

    expect(balancesOf(store)).toEqual(before)
  })

  it('leaves an empty ledger summing to zero when every expense is deleted', () => {
    const { store, expenseIds } = buildScenario()
    for (const id of expenseIds) expect_ok(store.deleteExpense(id))

    const balances = balancesOf(store)
    expect(sumBalances(balances)).toBe(0)
    expect(Object.values(balances).every((b) => centsValue(b) === 0)).toBe(true)
  })

  it('rejects deleting an expense that does not exist', () => {
    const { store } = buildScenario()
    expect(store.deleteExpense('nope').ok).toBe(false)
  })
})

describe('Store — deleting a person', () => {
  it('is blocked when the person participates in an expense', () => {
    const { store, bob } = buildScenario()
    const result = store.deletePerson(bob)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Bob/)
    // Bob is in all three expenses.
    expect(result.error).toMatch(/"Dinner"/)
    expect(result.error).toMatch(/"Hotel"/)
    expect(result.error).toMatch(/"Gas"/)
  })

  it('is blocked when the person is only the payer', () => {
    const storage = memoryStorage()
    const store = makeStore(storage)
    expect_ok(store.addPerson('Alice'))
    expect_ok(store.addPerson('Bob'))
    const [alice, bob] = store.getPeople().map((p) => p.id)

    // Alice pays, but only Bob is in the split.
    expect_ok(
      store.addExpense({
        description: 'Gift for Bob',
        amount: toCents(5000),
        paidBy: alice,
        split: { kind: 'equal', participantIds: [bob] },
      }),
    )

    const result = store.deletePerson(alice)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/"Gift for Bob"/)
  })

  it('names how many expenses reference the person', () => {
    const { store, carol } = buildScenario()
    const result = store.deletePerson(carol)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Carol is in Dinner (participant) and Hotel (payer), but not Gas.
    expect(result.error).toMatch(/2 expenses/)
    expect(result.error).not.toMatch(/"Gas"/)
  })

  it('does not remove the person when blocked', () => {
    const { store, bob } = buildScenario()
    store.deletePerson(bob)
    expect(store.getPerson(bob)).toBeDefined()
    expect(store.getPeople()).toHaveLength(4)
  })

  it('succeeds for a person in no expenses', () => {
    const { store } = buildScenario()
    expect_ok(store.addPerson('Erin'))
    const erin = store.getPeople().find((p) => p.name === 'Erin')!

    expect_ok(store.deletePerson(erin.id))
    expect(store.getPeople()).toHaveLength(4)
    expect(store.getPerson(erin.id)).toBeUndefined()
  })

  it('succeeds once the referencing expenses are deleted', () => {
    const { store, bob, expenseIds } = buildScenario()
    for (const id of expenseIds) expect_ok(store.deleteExpense(id))
    expect_ok(store.deletePerson(bob))
    expect(store.getPeople()).toHaveLength(3)
  })
})

describe('Store — people', () => {
  it('rejects a blank name', () => {
    const store = makeStore()
    expect(store.addPerson('   ').ok).toBe(false)
  })

  it('rejects a duplicate name, case-insensitively', () => {
    const store = makeStore()
    expect_ok(store.addPerson('Alice'))
    expect(store.addPerson('alice').ok).toBe(false)
  })

  it('trims surrounding whitespace from names', () => {
    const store = makeStore()
    expect_ok(store.addPerson('  Alice  '))
    expect(store.getPeople()[0].name).toBe('Alice')
  })

  it('gives each person a distinct id not derived from their name', () => {
    const store = new Store({ storage: memoryStorage() })
    expect_ok(store.addPerson('Alice'))
    expect_ok(store.addPerson('Bob'))
    const [a, b] = store.getPeople()
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toContain('Alice')
  })

  it('renaming does not change balances, since ids are stable', () => {
    const { store, alice } = buildScenario()
    const before = balancesOf(store)
    expect_ok(store.renamePerson(alice, 'Alicia'))
    expect(balancesOf(store)).toEqual(before)
  })
})

describe('Store — expense validation', () => {
  it('rejects a zero or negative amount', () => {
    const { store, alice } = buildScenario()
    expect(
      store.addExpense({
        description: 'Free',
        amount: toCents(0),
        paidBy: alice,
        split: { kind: 'equal', participantIds: [alice] },
      }).ok,
    ).toBe(false)
  })

  it('rejects an empty participant list', () => {
    const { store, alice } = buildScenario()
    expect(
      store.addExpense({
        description: 'Nobody',
        amount: toCents(1000),
        paidBy: alice,
        split: { kind: 'equal', participantIds: [] },
      }).ok,
    ).toBe(false)
  })

  it('rejects exact shares that do not sum to the total', () => {
    const { store, alice, bob } = buildScenario()
    const result = store.addExpense({
      description: 'Mismatched',
      amount: toCents(10_000),
      paidBy: alice,
      split: { kind: 'exact', shares: { [alice]: toCents(4000), [bob]: toCents(5000) } },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/add up to the total/)
  })

  it('rejects percentages that do not sum to 100', () => {
    const { store, alice, bob } = buildScenario()
    const result = store.addExpense({
      description: 'Bad percentages',
      amount: toCents(10_000),
      paidBy: alice,
      split: { kind: 'percentage', percentages: { [alice]: 50, [bob]: 40 } },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/add up to 100/)
  })

  it('rejects an unknown payer', () => {
    const { store, alice } = buildScenario()
    expect(
      store.addExpense({
        description: 'Ghost',
        amount: toCents(1000),
        paidBy: 'nobody',
        split: { kind: 'equal', participantIds: [alice] },
      }).ok,
    ).toBe(false)
  })

  it('does not add the expense when validation fails', () => {
    const { store, alice, bob } = buildScenario()
    const countBefore = store.getExpenses().length
    store.addExpense({
      description: 'Mismatched',
      amount: toCents(10_000),
      paidBy: alice,
      split: { kind: 'exact', shares: { [alice]: toCents(4000), [bob]: toCents(5000) } },
    })
    expect(store.getExpenses()).toHaveLength(countBefore)
  })
})

describe('Store — persistence and reload', () => {
  let storage: Storage

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('rehydrates identical people, expenses and balances in a fresh store', () => {
    const { store, alice } = buildScenario(storage)
    const originalPeople = [...store.getPeople()]
    const originalExpenses = [...store.getExpenses()]
    const originalBalances = balancesOf(store)

    // Simulate a page reload: a brand-new Store reading the same key.
    const reloaded = new Store({ storage })

    expect(reloaded.getPeople()).toEqual(originalPeople)
    expect(reloaded.getExpenses()).toEqual(originalExpenses)
    expect(balancesOf(reloaded)).toEqual(originalBalances)
    expect(centsValue(balancesOf(reloaded)[alice])).toBe(566_667)
  })

  it('rehydrates an identical settlement', () => {
    const { store } = buildScenario(storage)
    const before = store.getSettlement()
    const reloaded = new Store({ storage })
    expect(reloaded.getSettlement()).toEqual(before)
  })

  it('persists on every mutation, not just at the end', () => {
    const store = makeStore(storage)
    expect_ok(store.addPerson('Alice'))
    expect(new Store({ storage }).getPeople()).toHaveLength(1)

    expect_ok(store.addPerson('Bob'))
    expect(new Store({ storage }).getPeople()).toHaveLength(2)
  })

  it('persists deletions', () => {
    const { store, expenseIds } = buildScenario(storage)
    expect_ok(store.deleteExpense(expenseIds[2]))
    expect(new Store({ storage }).getExpenses()).toHaveLength(2)
  })

  it('round-trips exact and percentage splits without losing precision', () => {
    const store = makeStore(storage)
    expect_ok(store.addPerson('Alice'))
    expect_ok(store.addPerson('Bob'))
    expect_ok(store.addPerson('Carol'))
    const [alice, bob, carol] = store.getPeople().map((p) => p.id)

    expect_ok(
      store.addExpense({
        description: 'Percentage',
        amount: toCents(10_000),
        paidBy: alice,
        split: {
          kind: 'percentage',
          percentages: { [alice]: 33.33, [bob]: 33.33, [carol]: 33.34 },
        },
      }),
    )

    const reloaded = new Store({ storage })
    expect(reloaded.getExpenses()[0].split).toEqual({
      kind: 'percentage',
      percentages: { [alice]: 33.33, [bob]: 33.33, [carol]: 33.34 },
    })
    expect(sumBalances(balancesOf(reloaded))).toBe(0)
  })

  it('starts empty when the key is absent', () => {
    const store = new Store({ storage: memoryStorage() })
    expect(store.getPeople()).toEqual([])
    expect(store.getExpenses()).toEqual([])
  })

  it('falls back to empty state on malformed JSON instead of throwing', () => {
    const corrupt = memoryStorage({ [STORAGE_KEY]: '{not valid json' })
    const store = new Store({ storage: corrupt })
    expect(store.getPeople()).toEqual([])
    expect(store.getExpenses()).toEqual([])
  })

  it.each([
    ['null', 'null'],
    ['a bare string', '"hello"'],
    ['an array', '[1,2,3]'],
    ['missing keys', '{}'],
    ['people not an array', '{"people":"nope","expenses":[]}'],
    ['a person missing an id', '{"people":[{"name":"Alice"}],"expenses":[]}'],
    [
      'an expense with a non-integer amount',
      '{"people":[{"id":"a","name":"A"}],"expenses":[{"id":"e","description":"d","amount":10.5,"paidBy":"a","split":{"kind":"equal","participantIds":["a"]}}]}',
    ],
    [
      'an expense referencing an unknown person',
      '{"people":[{"id":"a","name":"A"}],"expenses":[{"id":"e","description":"d","amount":100,"paidBy":"ghost","split":{"kind":"equal","participantIds":["a"]}}]}',
    ],
    [
      'an unknown split kind',
      '{"people":[{"id":"a","name":"A"}],"expenses":[{"id":"e","description":"d","amount":100,"paidBy":"a","split":{"kind":"weird"}}]}',
    ],
  ])('falls back to empty state on %s', (_label, payload) => {
    const store = new Store({ storage: memoryStorage({ [STORAGE_KEY]: payload }) })
    expect(store.getPeople()).toEqual([])
    expect(store.getExpenses()).toEqual([])
  })

  it('rejects a partially-valid payload whole rather than half-loading it', () => {
    // One good person, one malformed — loading only the good half would show
    // plausible but wrong balances.
    const payload = JSON.stringify({
      people: [{ id: 'a', name: 'Alice' }, { id: 'b' }],
      expenses: [],
    })
    const store = new Store({ storage: memoryStorage({ [STORAGE_KEY]: payload }) })
    expect(store.getPeople()).toEqual([])
  })

  it('survives a storage backend that throws on write', () => {
    const hostile: Storage = {
      read: () => null,
      write: () => {
        throw new Error('quota exceeded')
      },
    }
    const store = new Store({ storage: hostile })

    // A full or disabled localStorage must not break the session: the mutation
    // still applies in memory, only durability across a reload is lost.
    expect(store.addPerson('Alice').ok).toBe(true)
    expect(store.getPeople()).toHaveLength(1)
    expect(store.getPersistError()).toMatch(/quota exceeded/)
  })

  it('still notifies subscribers when persistence fails', () => {
    const hostile: Storage = {
      read: () => null,
      write: () => {
        throw new Error('quota exceeded')
      },
    }
    const store = new Store({ storage: hostile })
    let calls = 0
    store.subscribe(() => calls++)

    store.addPerson('Alice')
    // The UI must still re-render, otherwise the screen silently desyncs.
    expect(calls).toBe(1)
  })

  it('clears the persist error once a save succeeds again', () => {
    let failing = true
    const flaky: Storage = {
      read: () => null,
      write: () => {
        if (failing) throw new Error('quota exceeded')
      },
    }
    const store = new Store({ storage: flaky })

    store.addPerson('Alice')
    expect(store.getPersistError()).not.toBeNull()

    failing = false
    store.addPerson('Bob')
    expect(store.getPersistError()).toBeNull()
  })
})

describe('Store — subscriptions', () => {
  it('notifies subscribers on mutation', () => {
    const store = makeStore()
    let calls = 0
    store.subscribe(() => calls++)

    store.addPerson('Alice')
    expect(calls).toBe(1)

    store.addPerson('Bob')
    expect(calls).toBe(2)
  })

  it('does not notify when a mutation is rejected', () => {
    const store = makeStore()
    expect_ok(store.addPerson('Alice'))

    let calls = 0
    store.subscribe(() => calls++)
    store.addPerson('Alice') // duplicate, rejected
    expect(calls).toBe(0)
  })

  it('bumps the version on every applied mutation', () => {
    const store = makeStore()
    const start = store.getVersion()
    expect_ok(store.addPerson('Alice'))
    expect(store.getVersion()).toBe(start + 1)
  })

  it('stops notifying after unsubscribe', () => {
    const store = makeStore()
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)
    store.addPerson('Alice')
    unsubscribe()
    store.addPerson('Bob')
    expect(calls).toBe(1)
  })
})
