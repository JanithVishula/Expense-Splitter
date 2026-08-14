/**
 * React binding for the store — Phase 4 of PLAN.md.
 *
 * The store itself is plain TypeScript with no React dependency, so the domain
 * and state layers stay testable without a DOM. This file is the only React
 * surface.
 */

import { useSyncExternalStore } from 'react'
import { Store } from './store'

/** One store per browser session, backed by localStorage. */
export const store = new Store()

/**
 * Subscribe to store changes.
 *
 * Returns the store itself plus a version counter that changes on every
 * mutation. Balances are deliberately NOT returned here — call
 * `store.getBalances()` at the point of use so they are always derived fresh.
 */
export function useStore(): Store {
  useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getVersion(),
    () => store.getVersion(),
  )
  return store
}
