/**
 * Persistence boundary — Phase 4 of PLAN.md.
 *
 * A tiny interface over localStorage so the store can be tested without a DOM,
 * and so a future swap to another backing store touches one file.
 */

export interface Storage {
  read(key: string): string | null
  write(key: string, value: string): void
}

/** localStorage, guarded so a disabled/full store degrades instead of throwing. */
export const browserStorage: Storage = {
  read(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      // Private-browsing modes can throw on access rather than returning null.
      return null
    }
  },
  write(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      // Quota exceeded or storage disabled. The in-memory state is still
      // correct for this session; only persistence across reloads is lost.
    }
  },
}

/** In-memory storage, for tests and for environments without localStorage. */
export function memoryStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => void map.set(key, value),
  }
}
