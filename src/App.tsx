import { useStore } from './state/useStore'
import { PeopleSection } from './ui/PeopleSection'
import { ExpensesSection } from './ui/ExpensesSection'
import { BalancesSection } from './ui/BalancesSection'
import { SettleUpSection } from './ui/SettleUpSection'
import './App.css'

export default function App() {
  const store = useStore()
  const persistError = store.getPersistError()

  return (
    <main>
      <h1>Expense Splitter</h1>
      <p className="muted">
        All amounts in Sri Lankan Rupees (LKR). Saved in this browser only.
      </p>

      {persistError && (
        <p role="alert" className="warn">
          Changes are not being saved ({persistError}). They will be lost on reload.
        </p>
      )}

      <PeopleSection store={store} />
      <ExpensesSection store={store} />
      <BalancesSection store={store} />
      <SettleUpSection store={store} />
    </main>
  )
}
