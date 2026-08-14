import { useState } from 'react'
import type { Store } from '../state/store'

export function PeopleSection({ store }: { store: Store }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const people = store.getPeople()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const result = store.addPerson(name)
    if (result.ok) {
      setName('')
      setError(null)
    } else {
      setError(result.error)
    }
  }

  function remove(id: string) {
    const result = store.deletePerson(id)
    setError(result.ok ? null : result.error)
  }

  return (
    <section>
      <h2>1. Add People</h2>

      <form onSubmit={submit}>
        <input
          aria-label="Person name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Add person</button>
      </form>

      {error && <p role="alert" className="error">{error}</p>}

      {people.length === 0 ? (
        <p className="muted">No one yet. Add at least two people to log an expense.</p>
      ) : (
        <ul className="people">
          {people.map((person) => (
            <li key={person.id}>
              <span>{person.name}</span>
              <button type="button" onClick={() => remove(person.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
