/**
 * Live split validation — Phase 6 of PLAN.md.
 *
 * These tests assert the *form* blocks submission, which is a different seam
 * from the store-level validation covered in store.test.ts: it is possible for
 * the store to reject correctly while the form still reports success to the
 * user, or silently swallows the error.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Store } from '../state/store'
import { memoryStorage } from '../state/storage'
import { ExpenseForm } from './ExpenseForm'

function makeStore() {
  let n = 0
  const store = new Store({
    storage: memoryStorage(),
    generateId: () => `id${++n}`,
  })
  store.addPerson('Alice')
  store.addPerson('Bob')
  return store
}

let store: Store

beforeEach(() => {
  store = makeStore()
})

/** Fill the shared fields every expense needs. */
async function fillBasics(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(screen.getByLabelText('Description'), 'Test expense')
  await user.type(screen.getByLabelText('Amount (Rs.)'), amount)
  await user.selectOptions(screen.getByLabelText('Paid by'), 'id1') // Alice
}

/** Tick both people in the "Split between" fieldset. */
async function checkBoth(user: ReturnType<typeof userEvent.setup>) {
  const fieldset = screen.getByRole('group', { name: /split between/i })
  for (const box of within(fieldset).getAllByRole('checkbox')) {
    await user.click(box)
  }
}

async function chooseMode(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  const fieldset = screen.getByRole('group', { name: /how to split/i })
  await user.click(within(fieldset).getByRole('radio', { name }))
}

/** Type a value into a per-person share field. */
async function setShare(
  user: ReturnType<typeof userEvent.setup>,
  legend: RegExp,
  person: string,
  value: string,
) {
  const fieldset = screen.getByRole('group', { name: legend })
  const input = within(fieldset)
    .getByText(person)
    .closest('label')!
    .querySelector('input')!
  await user.clear(input)
  await user.type(input, value)
}

// ---------------------------------------------------------------------------
// Exact-amount mode
// ---------------------------------------------------------------------------

describe('exact-amount split validation', () => {
  it('blocks submission when shares are short of the total', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /exact amounts/i)
    await setShare(user, /exact amount each/i, 'Alice', '40.00')
    await setShare(user, /exact amount each/i, 'Bob', '47.50')

    // Live running total shows the exact shortfall before submitting.
    expect(screen.getByText(/short by Rs\. 12\.50/i)).toBeDefined()

    await user.click(screen.getByRole('button', { name: /add expense/i }))

    // The expense must not reach the ledger.
    expect(store.getExpenses()).toHaveLength(0)
    expect(screen.getByRole('alert').textContent).toMatch(/add up to the total/i)
  })

  it('blocks submission when shares exceed the total', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /exact amounts/i)
    await setShare(user, /exact amount each/i, 'Alice', '60.00')
    await setShare(user, /exact amount each/i, 'Bob', '50.00')

    expect(screen.getByText(/over by Rs\. 10\.00/i)).toBeDefined()

    await user.click(screen.getByRole('button', { name: /add expense/i }))
    expect(store.getExpenses()).toHaveLength(0)
  })

  it('allows submission when shares sum exactly to the total', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /exact amounts/i)
    await setShare(user, /exact amount each/i, 'Alice', '40.00')
    await setShare(user, /exact amount each/i, 'Bob', '60.00')

    await user.click(screen.getByRole('button', { name: /add expense/i }))

    expect(store.getExpenses()).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('blocks a one-cent mismatch — the case that would break sum-to-zero', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /exact amounts/i)
    await setShare(user, /exact amount each/i, 'Alice', '50.00')
    await setShare(user, /exact amount each/i, 'Bob', '50.01')

    expect(screen.getByText(/over by Rs\. 0\.01/i)).toBeDefined()
    await user.click(screen.getByRole('button', { name: /add expense/i }))
    expect(store.getExpenses()).toHaveLength(0)
  })

  it('updates the running total live as the user types', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /exact amounts/i)

    await setShare(user, /exact amount each/i, 'Alice', '40.00')
    expect(screen.getByText(/short by Rs\. 60\.00/i)).toBeDefined()

    await setShare(user, /exact amount each/i, 'Bob', '60.00')
    expect(screen.queryByText(/short by/i)).toBeNull()
    expect(screen.getByText(/Shares total Rs\. 100\.00 of Rs\. 100\.00/i)).toBeDefined()
  })

  it('does not silently auto-correct the values the user typed', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /exact amounts/i)
    await setShare(user, /exact amount each/i, 'Alice', '40.00')
    await setShare(user, /exact amount each/i, 'Bob', '47.50')
    await user.click(screen.getByRole('button', { name: /add expense/i }))

    // The rejected values stay exactly as entered, for the user to fix.
    const fieldset = screen.getByRole('group', { name: /exact amount each/i })
    const inputs = within(fieldset).getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs.map((i) => i.value)).toEqual(['40.00', '47.50'])
  })
})

// ---------------------------------------------------------------------------
// Percentage mode
// ---------------------------------------------------------------------------

describe('percentage split validation', () => {
  it('blocks submission when percentages are under 100', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /percentages/i)
    await setShare(user, /percentage each/i, 'Alice', '50')
    await setShare(user, /percentage each/i, 'Bob', '40')

    expect(screen.getByText(/total 90\.00% of 100%/i)).toBeDefined()
    expect(screen.getByText(/short by 10\.00%/i)).toBeDefined()

    await user.click(screen.getByRole('button', { name: /add expense/i }))
    expect(store.getExpenses()).toHaveLength(0)
    expect(screen.getByRole('alert').textContent).toMatch(/add up to 100/i)
  })

  it('blocks submission when percentages exceed 100', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /percentages/i)
    await setShare(user, /percentage each/i, 'Alice', '53')
    await setShare(user, /percentage each/i, 'Bob', '50')

    expect(screen.getByText(/total 103\.00% of 100%/i)).toBeDefined()
    expect(screen.getByText(/over by 3\.00%/i)).toBeDefined()

    await user.click(screen.getByRole('button', { name: /add expense/i }))
    expect(store.getExpenses()).toHaveLength(0)
  })

  it('allows submission when percentages sum to exactly 100', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /percentages/i)
    await setShare(user, /percentage each/i, 'Alice', '60')
    await setShare(user, /percentage each/i, 'Bob', '40')

    await user.click(screen.getByRole('button', { name: /add expense/i }))

    expect(store.getExpenses()).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('accepts fractional percentages that sum to 100', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    await chooseMode(user, /percentages/i)
    await setShare(user, /percentage each/i, 'Alice', '33.33')
    await setShare(user, /percentage each/i, 'Bob', '66.67')

    await user.click(screen.getByRole('button', { name: /add expense/i }))
    expect(store.getExpenses()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Equal mode is unaffected
// ---------------------------------------------------------------------------

describe('equal split', () => {
  it('submits without any per-person validation', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)
    // Equal is the default mode.
    await user.click(screen.getByRole('button', { name: /add expense/i }))

    expect(store.getExpenses()).toHaveLength(1)
  })

  it('shows no running-total line in equal mode', async () => {
    const user = userEvent.setup()
    render(<ExpenseForm store={store} onDone={() => {}} />)

    await fillBasics(user, '100.00')
    await checkBoth(user)

    expect(screen.queryByText(/shares total/i)).toBeNull()
    expect(screen.queryByText(/percentages total/i)).toBeNull()
  })
})
