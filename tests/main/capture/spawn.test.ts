import { describe, it, expect } from 'vitest'
import { spawnSshChild } from '../../../src/main/capture/spawn'

describe('spawnSshChild', () => {
  it('spawns a killable child and reports its exit', async () => {
    // `node -e ""` stands in for ssh: it exits immediately and needs no network.
    const child = spawnSshChild(['-e', ''], 'node')
    const exited = new Promise<void>((resolve) => child.onExit(() => resolve()))
    await exited
    expect(() => child.kill()).not.toThrow()
  })

  it('kill() is safe to call twice', () => {
    const child = spawnSshChild(['-e', 'setTimeout(()=>{},10000)'], 'node')
    child.kill()
    expect(() => child.kill()).not.toThrow()
  })
})
