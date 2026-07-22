import { describe, it, expect } from 'vitest'
import { runSmoke } from '../../src/main/smoke'

describe('runSmoke', () => {
  it('loads better-sqlite3 and round-trips a query', () => {
    expect(runSmoke()).toBe(true)
  })
})
