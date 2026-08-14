import { centsValue, formatCents, toCents } from '../domain/money'
import type { Store } from '../state/store'

export function BalancesSection({ store }: { store: Store }) {
  const result = store.getBalances()

  if (!result.ok) {
    return (
      <section>
        <h2>3. Balances</h2>
        <p role="alert" className="error">{result.error}</p>
      </section>
    )
  }

  const people = store.getPeople()
  const total = Object.values(result.balances).reduce((a, b) => a + centsValue(b), 0)

  return (
    <section>
      <h2>3. Balances</h2>

      {people.length === 0 ? (
        <p className="muted">No one yet.</p>
      ) : (
        <table>
          <tbody>
            {people.map((person) => {
              const balance = centsValue(result.balances[person.id] ?? toCents(0))
              const state = balance > 0 ? 'owed' : balance < 0 ? 'owes' : 'settled'
              return (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  <td className={state}>
                    {balance > 0 && '+'}
                    {formatCents(toCents(balance))}
                  </td>
                  <td className="muted">
                    {state === 'owed'
                      ? 'is owed'
                      : state === 'owes'
                        ? 'owes'
                        : 'settled up'}
                  </td>
                </tr>
              )
            })}
            <tr className="total">
              <td>Total</td>
              <td className={total === 0 ? 'ok' : 'warn'}>
                {formatCents(toCents(total))}
              </td>
              <td className="muted">
                {total === 0 ? 'reconciles to zero' : 'DOES NOT RECONCILE'}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  )
}
