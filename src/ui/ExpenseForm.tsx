import { useState } from 'react'
import { formatCents, parseRupees, toCents, type Cents } from '../domain/money'
import type { Expense, SplitMode } from '../domain/balances'
import type { Shares } from '../domain/split'
import type { Store } from '../state/store'

type Mode = 'equal' | 'exact' | 'percentage'

interface Props {
  store: Store
  /** When present the form edits this expense instead of adding a new one. */
  editing?: Expense
  onDone: () => void
}

/** Per-person text inputs for exact / percentage modes, keyed by person id. */
type FieldMap = Record<string, string>

function initialFields(editing: Expense | undefined): {
  mode: Mode
  checked: Set<string>
  exact: FieldMap
  percentage: FieldMap
} {
  if (!editing) {
    return { mode: 'equal', checked: new Set(), exact: {}, percentage: {} }
  }

  switch (editing.split.kind) {
    case 'equal':
      return {
        mode: 'equal',
        checked: new Set(editing.split.participantIds),
        exact: {},
        percentage: {},
      }
    case 'exact': {
      const exact: FieldMap = {}
      for (const [id, cents] of Object.entries(editing.split.shares)) {
        // Strip the "Rs. " prefix and separators so the value is editable.
        exact[id] = (cents / 100).toFixed(2)
      }
      return {
        mode: 'exact',
        checked: new Set(Object.keys(editing.split.shares)),
        exact,
        percentage: {},
      }
    }
    case 'percentage': {
      const percentage: FieldMap = {}
      for (const [id, pct] of Object.entries(editing.split.percentages)) {
        percentage[id] = String(pct)
      }
      return {
        mode: 'percentage',
        checked: new Set(Object.keys(editing.split.percentages)),
        exact: {},
        percentage,
      }
    }
  }
}

export function ExpenseForm({ store, editing, onDone }: Props) {
  const people = store.getPeople()
  const initial = initialFields(editing)

  const [description, setDescription] = useState(editing?.description ?? '')
  const [amount, setAmount] = useState(
    editing ? (editing.amount / 100).toFixed(2) : '',
  )
  const [paidBy, setPaidBy] = useState(editing?.paidBy ?? '')
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [checked, setChecked] = useState<Set<string>>(initial.checked)
  const [exact, setExact] = useState<FieldMap>(initial.exact)
  const [percentage, setPercentage] = useState<FieldMap>(initial.percentage)
  const [error, setError] = useState<string | null>(null)

  const participants = people.filter((p) => checked.has(p.id))

  function toggle(id: string) {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
  }

  // -- live running totals, so a mismatch is visible before submitting -----

  const parsedAmount = parseRupees(amount)
  const totalCents = parsedAmount.ok ? parsedAmount.value : null

  let exactSum = 0
  let exactValid = true
  for (const person of participants) {
    const parsed = parseRupees(exact[person.id] ?? '')
    if (parsed.ok) exactSum += parsed.value
    else exactValid = false
  }

  let pctSum = 0
  let pctValid = true
  for (const person of participants) {
    const raw = (percentage[person.id] ?? '').trim()
    const value = Number(raw)
    if (raw !== '' && Number.isFinite(value)) pctSum += Math.round(value * 100)
    else pctValid = false
  }

  function buildSplit(): SplitMode | string {
    if (participants.length === 0) {
      return 'Select at least one person to split between.'
    }

    if (mode === 'equal') {
      return { kind: 'equal', participantIds: participants.map((p) => p.id) }
    }

    if (mode === 'exact') {
      const shares: Shares = {}
      for (const person of participants) {
        const parsed = parseRupees(exact[person.id] ?? '')
        if (!parsed.ok) return `${person.name}: ${parsed.error}`
        shares[person.id] = parsed.value
      }
      return { kind: 'exact', shares }
    }

    const percentages: Record<string, number> = {}
    for (const person of participants) {
      const raw = (percentage[person.id] ?? '').trim()
      const value = Number(raw)
      if (raw === '' || !Number.isFinite(value)) {
        return `${person.name}: enter a percentage.`
      }
      percentages[person.id] = value
    }
    return { kind: 'percentage', percentages }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()

    if (!parsedAmount.ok) {
      setError(parsedAmount.error)
      return
    }
    if (paidBy === '') {
      setError('Select who paid.')
      return
    }

    const split = buildSplit()
    if (typeof split === 'string') {
      setError(split)
      return
    }

    const payload = {
      description: description.trim() === '' ? 'Expense' : description.trim(),
      amount: parsedAmount.value,
      paidBy,
      split,
    }

    // Amount and split are always submitted together, so an exact-split edit
    // can never leave shares inconsistent with the total.
    const result = editing
      ? store.updateExpense(editing.id, payload)
      : store.addExpense(payload)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setError(null)
    if (!editing) {
      setDescription('')
      setAmount('')
      setPaidBy('')
      setChecked(new Set())
      setExact({})
      setPercentage({})
    }
    onDone()
  }

  if (people.length === 0) {
    return <p className="muted">Add people first.</p>
  }

  return (
    <form onSubmit={submit} className="expense-form">
      <div className="row">
        <label>
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner"
          />
        </label>

        <label>
          Amount (Rs.)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="12000.00"
            inputMode="decimal"
          />
        </label>

        <label>
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">Select…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend>Split between</legend>
        {people.map((person) => (
          <label key={person.id} className="check">
            <input
              type="checkbox"
              checked={checked.has(person.id)}
              onChange={() => toggle(person.id)}
            />
            {person.name}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>How to split</legend>
        {(['equal', 'exact', 'percentage'] as const).map((m) => (
          <label key={m} className="check">
            <input
              type="radio"
              name="mode"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            {m === 'equal' ? 'Equally' : m === 'exact' ? 'Exact amounts' : 'Percentages'}
          </label>
        ))}
      </fieldset>

      {mode === 'exact' && participants.length > 0 && (
        <fieldset>
          <legend>Exact amount each (Rs.)</legend>
          {participants.map((person) => (
            <label key={person.id} className="row-field">
              <span>{person.name}</span>
              <input
                value={exact[person.id] ?? ''}
                onChange={(e) => setExact({ ...exact, [person.id]: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
              />
            </label>
          ))}
          <p className={totalCents !== null && exactValid && exactSum === totalCents ? 'ok' : 'warn'}>
            Shares total {formatCents(toCents(exactSum))}
            {totalCents !== null && ` of ${formatCents(totalCents)}`}
            {totalCents !== null && exactValid && exactSum !== totalCents && (
              <> — {exactSum > totalCents ? 'over' : 'short'} by{' '}
                {formatCents(toCents(Math.abs(totalCents - exactSum)))}</>
            )}
          </p>
        </fieldset>
      )}

      {mode === 'percentage' && participants.length > 0 && (
        <fieldset>
          <legend>Percentage each (%)</legend>
          {participants.map((person) => (
            <label key={person.id} className="row-field">
              <span>{person.name}</span>
              <input
                value={percentage[person.id] ?? ''}
                onChange={(e) =>
                  setPercentage({ ...percentage, [person.id]: e.target.value })
                }
                inputMode="decimal"
                placeholder="0"
              />
            </label>
          ))}
          <p className={pctValid && pctSum === 10_000 ? 'ok' : 'warn'}>
            Percentages total {(pctSum / 100).toFixed(2)}% of 100%
            {pctValid && pctSum !== 10_000 && (
              <> — {pctSum > 10_000 ? 'over' : 'short'} by{' '}
                {(Math.abs(10_000 - pctSum) / 100).toFixed(2)}%</>
            )}
          </p>
        </fieldset>
      )}

      {error && <p role="alert" className="error">{error}</p>}

      <div className="actions">
        <button type="submit">{editing ? 'Save changes' : 'Add expense'}</button>
        {editing && (
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

/** Shown in the expense list; summarises how an expense was split. */
export function describeSplit(expense: Expense, nameOf: (id: string) => string): string {
  switch (expense.split.kind) {
    case 'equal':
      return `equally between ${expense.split.participantIds.map(nameOf).join(', ')}`
    case 'exact':
      return `exact: ${Object.entries(expense.split.shares)
        .map(([id, cents]) => `${nameOf(id)} ${formatCents(cents as Cents)}`)
        .join(', ')}`
    case 'percentage':
      return `percentage: ${Object.entries(expense.split.percentages)
        .map(([id, pct]) => `${nameOf(id)} ${pct}%`)
        .join(', ')}`
  }
}
