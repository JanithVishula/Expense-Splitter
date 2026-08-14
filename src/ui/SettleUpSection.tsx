import { formatCents } from '../domain/money'
import type { Store } from '../state/store'

export function SettleUpSection({ store }: { store: Store }) {
  const result = store.getSettlement()

  if (!result.ok) {
    return (
      <section>
        <h2>4. Settle Up</h2>
        <p role="alert" className="error">{result.error}</p>
      </section>
    )
  }

  const nameOf = (id: string) => store.getPerson(id)?.name ?? 'unknown'
  const { transactions } = result

  return (
    <section>
      <h2>4. Settle Up</h2>

      {transactions.length === 0 ? (
        <p className="muted">Everyone is settled up — no payments needed.</p>
      ) : (
        <>
          <p>
            <strong>
              {transactions.length} transaction{transactions.length === 1 ? '' : 's'}
            </strong>{' '}
            needed to settle everyone.
          </p>
          <ol className="settlement">
            {transactions.map((t, i) => (
              <li key={`${t.from}-${t.to}-${i}`}>
                {nameOf(t.from)} pays {nameOf(t.to)} <strong>{formatCents(t.amount)}</strong>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
