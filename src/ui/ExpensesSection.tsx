import { useState } from 'react'
import { formatCents } from '../domain/money'
import type { Store } from '../state/store'
import { ExpenseForm, describeSplit } from './ExpenseForm'

export function ExpensesSection({ store }: { store: Store }) {
  const [editingId, setEditingId] = useState<string | null>(null)

  const expenses = store.getExpenses()
  const nameOf = (id: string) => store.getPerson(id)?.name ?? 'unknown'

  return (
    <section>
      <h2>2. Add Expense</h2>

      {editingId === null && <ExpenseForm store={store} onDone={() => {}} />}

      <h3>Expenses ({expenses.length})</h3>
      {expenses.length === 0 ? (
        <p className="muted">No expenses yet.</p>
      ) : (
        <ul className="expenses">
          {expenses.map((expense) => (
            <li key={expense.id}>
              {editingId === expense.id ? (
                <ExpenseForm
                  store={store}
                  editing={expense}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div>
                    <strong>{expense.description}</strong>{' '}
                    <span>{formatCents(expense.amount)}</span>
                    <div className="muted">
                      paid by {nameOf(expense.paidBy)}, {describeSplit(expense, nameOf)}
                    </div>
                  </div>
                  <div className="actions">
                    <button type="button" onClick={() => setEditingId(expense.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => store.deleteExpense(expense.id)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
