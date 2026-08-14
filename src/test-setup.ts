import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount components between tests so each starts from a clean DOM.
afterEach(cleanup)
