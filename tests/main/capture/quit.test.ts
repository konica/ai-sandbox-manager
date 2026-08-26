import { describe, it, expect, vi } from 'vitest'
import { createBeforeQuitHandler } from '../../../src/main/capture/quit'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const evt = () => ({ preventDefault: vi.fn() })

describe('before-quit handler', () => {
  it('defers the quit until teardown finishes', async () => {
    const d = deferred()
    const quit = vi.fn()
    const handler = createBeforeQuitHandler({ disable: () => d.promise, quit })

    const e = evt()
    handler(e)
    // Electron does not await listener promises, so the quit MUST be cancelled here —
    // otherwise the process exits mid-teardown and the in-sandbox relays are orphaned.
    expect(e.preventDefault).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    d.resolve()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
  })

  it('lets the second quit through instead of cancelling forever', async () => {
    const quit = vi.fn()
    const handler = createBeforeQuitHandler({ disable: async () => {}, quit })

    handler(evt())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())

    // app.quit() re-fires before-quit; this pass must not preventDefault or the app hangs.
    const second = evt()
    handler(second)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('runs teardown only once, however many times before-quit fires', async () => {
    const disable = vi.fn(async () => {})
    const handler = createBeforeQuitHandler({ disable, quit: vi.fn() })
    handler(evt())
    await vi.waitFor(() => expect(disable).toHaveBeenCalledOnce())
    handler(evt())
    handler(evt())
    expect(disable).toHaveBeenCalledOnce()
  })

  it('still quits when teardown rejects', async () => {
    const quit = vi.fn()
    const handler = createBeforeQuitHandler({ disable: async () => { throw new Error('sandbox gone') }, quit })
    handler(evt())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
  })

  it('still quits when teardown hangs, so the app can never become unquittable', async () => {
    vi.useFakeTimers()
    try {
      const quit = vi.fn()
      const handler = createBeforeQuitHandler({ disable: () => new Promise(() => {}), quit, timeoutMs: 5000 })
      handler(evt())
      expect(quit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5000)
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
