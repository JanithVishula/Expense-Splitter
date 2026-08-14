/**
 * Application state — Phase 4 of PLAN.md.
 *
 * Holds people and expenses. Balances are NEVER stored here: they are derived
 * fresh from the full expense list on every read via `computeBalances`. That is
 * the single design rule that makes edit and delete correct automatically —
 * there is no running total to keep in sync, so a mis-applied reversal is not
 * a bug that can exist.
 */

import { toCents, type Cents } from '../domain/money'
import {
  computeBalances,
  type Expense,
  type Person,
  type SplitMode,
} from '../domain/balances'
import { settleUp, type Transaction } from '../domain/settle'
import type { PersonId, Shares } from '../domain/split'
import { browserStorage, type Storage } from './storage'

export const STORAGE_KEY = 'expense-splitter/v1'

export interface StoreState {
  people: Person[]
  expenses: Expense[]
}

/** Mutations that can fail report why, rather than throwing at the UI. */
export type MutationResult = { ok: true } | { ok: false; error: string }

export interface StoreOptions {
  storage?: Storage
  /** Injectable for deterministic ids in tests. */
  generateId?: () => string
}

let idCounter = 0
function defaultGenerateId(): string {
  // Ids must be stable and unique, and must NOT be derived from the name:
  // remainder allocation is ordered by id, so renaming someone would otherwise
  // silently shift a cent between people.
  idCounter += 1
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export class Store {
  private state: StoreState
  private readonly storage: Storage
  private readonly generateId: () => string
  private listeners = new Set<() => void>()
  /** Bumped on every mutation; used as the React snapshot value. */
  private version = 0
  private lastPersistError: string | null = null

  constructor(options: StoreOptions = {}) {
    this.storage = options.storage ?? browserStorage
    this.generateId = options.generateId ?? defaultGenerateId
    this.state = loadState(this.storage)
  }

  // -- reads ---------------------------------------------------------------

  getPeople(): readonly Person[] {
    return this.state.people
  }

  getExpenses(): readonly Expense[] {
    return this.state.expenses
  }

  getPerson(id: PersonId): Person | undefined {
    return this.state.people.find((p) => p.id === id)
  }

  /**
   * Balances, derived fresh on every call. Never cached, never patched.
   *
   * Returns the error form if any expense has become invalid (e.g. it
   * references a person who no longer exists), so the UI can surface it
   * instead of showing wrong numbers.
   */
  getBalances(): ReturnType<typeof computeBalances> {
    return computeBalances(this.state.people, this.state.expenses)
  }

  /** Settlement plan, derived from freshly computed balances. */
  getSettlement(): { ok: true; transactions: Transaction[] } | { ok: false; error: string } {
    const balances = this.getBalances()
    if (!balances.ok) return balances
    return { ok: true, transactions: settleUp(balances.balances) }
  }

  // -- people --------------------------------------------------------------

  addPerson(name: string): MutationResult {
    const trimmed = name.trim()
    if (trimmed === '') {
      return { ok: false, error: 'Enter a name.' }
    }
    if (this.state.people.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: `"${trimmed}" is already in the group.` }
    }

    this.commit({
      ...this.state,
      people: [...this.state.people, { id: this.generateId(), name: trimmed }],
    })
    return { ok: true }
  }

  renamePerson(id: PersonId, name: string): MutationResult {
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'Enter a name.' }
    if (!this.getPerson(id)) return { ok: false, error: 'That person no longer exists.' }
    if (
      this.state.people.some(
        (p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return { ok: false, error: `"${trimmed}" is already in the group.` }
    }

    this.commit({
      ...this.state,
      people: this.state.people.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    })
    return { ok: true }
  }

  /**
   * Remove a person, but only if no expense references them.
   *
   * Blocking rather than cascading is deliberate: silently dropping someone
   * from a split would change what everyone else owes without the user asking.
   * The error names the offending expenses so the user knows what to fix.
   */
  deletePerson(id: PersonId): MutationResult {
    if (!this.getPerson(id)) {
      return { ok: false, error: 'That person no longer exists.' }
    }

    const referencing = this.state.expenses.filter((e) => expenseReferences(e, id))
    if (referencing.length > 0) {
      const names = referencing.map((e) => `"${e.description}"`).join(', ')
      const person = this.getPerson(id)!.name
      return {
        ok: false,
        error:
          `Cannot remove ${person}: they appear in ${referencing.length} ` +
          `expense${referencing.length === 1 ? '' : 's'} (${names}). ` +
          `Delete or edit ${referencing.length === 1 ? 'it' : 'those'} first.`,
      }
    }

    this.commit({
      ...this.state,
      people: this.state.people.filter((p) => p.id !== id),
    })
    return { ok: true }
  }

  // -- expenses ------------------------------------------------------------

  addExpense(input: Omit<Expense, 'id'>): MutationResult {
    const invalid = this.validateExpense(input)
    if (invalid) return { ok: false, error: invalid }

    this.commit({
      ...this.state,
      expenses: [...this.state.expenses, { ...input, id: this.generateId() }],
    })
    return { ok: true }
  }

  /** Partial update; balances recompute from the new list on the next read. */
  updateExpense(id: string, patch: Partial<Omit<Expense, 'id'>>): MutationResult {
    const existing = this.state.expenses.find((e) => e.id === id)
    if (!existing) return { ok: false, error: 'That expense no longer exists.' }

    const updated: Expense = { ...existing, ...patch, id }
    const invalid = this.validateExpense(updated)
    if (invalid) return { ok: false, error: invalid }

    this.commit({
      ...this.state,
      expenses: this.state.expenses.map((e) => (e.id === id ? updated : e)),
    })
    return { ok: true }
  }

  deleteExpense(id: string): MutationResult {
    if (!this.state.expenses.some((e) => e.id === id)) {
      return { ok: false, error: 'That expense no longer exists.' }
    }
    this.commit({
      ...this.state,
      expenses: this.state.expenses.filter((e) => e.id !== id),
    })
    return { ok: true }
  }

  /**
   * Reject an expense before it enters the ledger.
   *
   * Validation happens up front so `getBalances` can stay a pure derivation:
   * if invalid data could be stored, every read would have to cope with it.
   */
  private validateExpense(expense: Omit<Expense, 'id'>): string | null {
    if (expense.amount <= 0) {
      return 'Amount must be greater than zero.'
    }
    if (!this.getPerson(expense.paidBy)) {
      return 'Select who paid.'
    }

    const participants = participantsOf(expense.split)
    if (participants.length === 0) {
      return 'Select at least one person to split between.'
    }
    for (const personId of participants) {
      if (!this.getPerson(personId)) {
        return 'This expense includes someone who is no longer in the group.'
      }
    }

    // Run the real split so mode-specific rules (exact sums to total,
    // percentages sum to 100) are enforced by the same code the ledger uses.
    const probe = computeBalances(this.state.people, [{ ...expense, id: '__probe__' }])
    if (!probe.ok) {
      // Strip the description prefix computeBalances adds for context.
      return probe.error.replace(/^Expense "[^"]*": /, '')
    }
    return null
  }

  // -- subscription & persistence -----------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Changes on every mutation; the React snapshot value. */
  getVersion(): number {
    return this.version
  }

  /**
   * Single write path: every mutation persists and notifies through here.
   *
   * A persistence failure must not take down the session. The in-memory state
   * is already correct and the UI still needs to re-render; only durability
   * across a reload is lost, so the write is isolated from the notify.
   */
  private commit(next: StoreState): void {
    this.state = next
    this.version += 1

    try {
      this.storage.write(STORAGE_KEY, JSON.stringify(next))
      this.lastPersistError = null
    } catch (cause) {
      this.lastPersistError =
        cause instanceof Error ? cause.message : 'Could not save to this browser.'
    }

    for (const listener of this.listeners) listener()
  }

  /**
   * The reason the last save failed, or null. Lets the UI warn that changes
   * will not survive a reload, rather than failing silently.
   */
  getPersistError(): string | null {
    return this.lastPersistError
  }

  /** Test/debug helper: discard everything. */
  reset(): void {
    this.commit({ people: [], expenses: [] })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Everyone a split charges, regardless of mode. */
export function participantsOf(split: SplitMode): PersonId[] {
  switch (split.kind) {
    case 'equal':
      return [...split.participantIds]
    case 'exact':
      return Object.keys(split.shares)
    case 'percentage':
      return Object.keys(split.percentages)
  }
}

/** True if the expense names this person as payer or participant. */
export function expenseReferences(expense: Expense, personId: PersonId): boolean {
  return expense.paidBy === personId || participantsOf(expense.split).includes(personId)
}

const EMPTY: StoreState = { people: [], expenses: [] }

/**
 * Rehydrate from storage.
 *
 * Falls back to empty state on anything unusable — absent key, malformed JSON,
 * or a structurally wrong payload. A partially-valid payload is rejected whole
 * rather than half-loaded: a half-loaded ledger would show plausible but wrong
 * balances, which is worse than starting clean.
 */
export function loadState(storage: Storage): StoreState {
  const raw = storage.read(STORAGE_KEY)
  if (raw === null) return { ...EMPTY }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...EMPTY }
  }

  try {
    return validateState(parsed)
  } catch {
    return { ...EMPTY }
  }
}

function validateState(value: unknown): StoreState {
  if (typeof value !== 'object' || value === null) throw new Error('not an object')

  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.people) || !Array.isArray(candidate.expenses)) {
    throw new Error('missing people or expenses')
  }

  const people: Person[] = candidate.people.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('bad person')
    const p = raw as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.name !== 'string') {
      throw new Error('bad person fields')
    }
    return { id: p.id, name: p.name }
  })

  const knownIds = new Set(people.map((p) => p.id))

  const expenses: Expense[] = candidate.expenses.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('bad expense')
    const e = raw as Record<string, unknown>

    if (
      typeof e.id !== 'string' ||
      typeof e.description !== 'string' ||
      typeof e.paidBy !== 'string'
    ) {
      throw new Error('bad expense fields')
    }
    if (!knownIds.has(e.paidBy)) throw new Error('expense references unknown payer')

    const amount = validateCents(e.amount)
    const split = validateSplit(e.split, knownIds)

    return { id: e.id, description: e.description, amount, paidBy: e.paidBy, split }
  })

  return { people, expenses }
}

function validateCents(value: unknown): Cents {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('amount is not an integer number of cents')
  }
  return toCents(value)
}

function validateSplit(value: unknown, knownIds: Set<string>): SplitMode {
  if (typeof value !== 'object' || value === null) throw new Error('bad split')
  const split = value as Record<string, unknown>

  const requireKnown = (id: string) => {
    if (!knownIds.has(id)) throw new Error('split references unknown person')
  }

  switch (split.kind) {
    case 'equal': {
      if (!Array.isArray(split.participantIds)) throw new Error('bad participants')
      const ids = split.participantIds.map((id) => {
        if (typeof id !== 'string') throw new Error('bad participant id')
        requireKnown(id)
        return id
      })
      return { kind: 'equal', participantIds: ids }
    }
    case 'exact': {
      if (typeof split.shares !== 'object' || split.shares === null) {
        throw new Error('bad shares')
      }
      const shares: Shares = {}
      for (const [id, amount] of Object.entries(split.shares)) {
        requireKnown(id)
        shares[id] = validateCents(amount)
      }
      return { kind: 'exact', shares }
    }
    case 'percentage': {
      if (typeof split.percentages !== 'object' || split.percentages === null) {
        throw new Error('bad percentages')
      }
      const percentages: Record<PersonId, number> = {}
      for (const [id, pct] of Object.entries(split.percentages)) {
        requireKnown(id)
        if (typeof pct !== 'number' || !Number.isFinite(pct)) {
          throw new Error('bad percentage')
        }
        percentages[id] = pct
      }
      return { kind: 'percentage', percentages }
    }
    default:
      throw new Error('unknown split kind')
  }
}
