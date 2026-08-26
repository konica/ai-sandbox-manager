/** The slice of Electron's `before-quit` event this handler needs. */
export interface QuitEvent {
  preventDefault(): void
}

export interface BeforeQuitDeps {
  /** Tears the capture session down; resolves when the sandbox side is actually clean. */
  disable: () => Promise<unknown>
  /** Re-issues the quit once teardown has finished (Electron's `app.quit`). */
  quit: () => void
  /** Upper bound on how long a quit may be held open. Default 5s. */
  timeoutMs?: number
}

/**
 * Build the `before-quit` listener that lets capture tear down cleanly before the app exits.
 *
 * Electron does NOT await a listener's returned promise. A fire-and-forget
 * `void capture.disable()` therefore only completes its synchronous part — killing the ssh
 * child — while the `sbx exec` that stops the in-sandbox relays and removes the port file is
 * abandoned when the process exits. The observable result is one orphaned relay per session,
 * accumulating until the sandbox is rebuilt.
 *
 * So the first quit is cancelled, teardown runs to completion, and then the quit is re-issued.
 * The second pass falls straight through — cancelling that one too would make the app
 * unquittable.
 *
 * The wait is bounded: a teardown that hangs (an unreachable sandbox, a wedged `sbx`) must
 * never trap the user in an app that will not close. By the time the bound expires the ssh
 * child is already dead, so the worst case is a stale relay — the same state as before this
 * fix, and never a stuck process.
 */
export function createBeforeQuitHandler(deps: BeforeQuitDeps): (event: QuitEvent) => void {
  const timeoutMs = deps.timeoutMs ?? 5000
  let started = false

  return (event: QuitEvent): void => {
    if (started) return // the re-quit: let it through
    started = true
    event.preventDefault()
    const bounded = Promise.race([
      deps.disable().catch(() => undefined), // a failed teardown must not block the quit
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ])
    void bounded.then(() => deps.quit())
  }
}
