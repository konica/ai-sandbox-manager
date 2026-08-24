import {
  APP_PORT_CANDIDATES, RELAY_PORT_CANDIDATES, IDLE_STATUS,
  type CaptureCheck, type CapturePhase, type CapturePorts, type CaptureStatus
} from '@shared/capture'
import type { BurpSettings } from '@shared/capture'
import type { CaInfo } from './ca'
import {
  socatProbeScript, freePortScript, parseFreePort, caInstallScript, profileInstallScript,
  relayCommand, publishPortScript, teardownScript,
  SOCAT_OK_MARK, CA_OK_MARK, PROFILE_OK_MARK
} from './scripts'
import { verifyScript, parseVerify, verifyChecks, credentialChainOk } from './verify'
import type { Logger } from '../log'

/** The ssh child, narrowed to what the session needs — keeps tests free of real processes. */
export interface CaptureChild {
  kill(): void
  onExit(cb: () => void): void
}

export interface CaptureDeps {
  /** `sbx exec <name> bash -lc <script>`, throwing on non-zero. */
  exec: (sandbox: string, script: string) => Promise<void>
  /** Same, returning stdout. */
  execCapture: (sandbox: string, script: string) => Promise<string>
  settings: () => BurpSettings
  readCa: (path: string) => CaInfo
  spawnSsh: (args: string[]) => CaptureChild
  /** Host loopback TCP probe. */
  probe: (port: number) => Promise<boolean>
  log?: Logger
}

export interface CaptureSession {
  status(): CaptureStatus
  enable(sandbox: string, opts?: { force?: boolean }): Promise<CaptureStatus>
  disable(): Promise<CaptureStatus>
  /** Fed by the reconciler so a stopped sandbox tears its capture down. */
  onRunningInstances(names: string[]): void
}

/**
 * ssh arguments for the one supervised child.
 *
 * `-L <upstream>:127.0.0.1:<relay>` is the only thing `sbx exec` cannot do. The relay
 * command rides along so that killing this child tears the whole apparatus down.
 * `ExitOnForwardFailure` turns a refused forward into an exit rather than a silent no-op.
 */
export function sshArgs(p: {
  sandbox: string; upstreamPort: number; relayPort: number; appPort: number; proxyPort: number
}): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${p.upstreamPort}:127.0.0.1:${p.relayPort}`,
    `${p.sandbox}.sbx`,
    relayCommand({ relayPort: p.relayPort, appPort: p.appPort, proxyPort: p.proxyPort })
  ]
}

/** Wait for a condition to hold, polling. Used to confirm the -L listener actually bound. */
async function waitFor(check: () => Promise<boolean>, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return false
}

class CaptureError extends Error {
  constructor(readonly phase: CapturePhase, message: string) {
    super(message)
  }
}

export function createCaptureSession(deps: CaptureDeps): CaptureSession {
  let state: CaptureStatus = { ...IDLE_STATUS }
  let child: CaptureChild | null = null
  let active: { sandbox: string; ports: CapturePorts } | null = null

  function set(next: CaptureStatus): CaptureStatus {
    state = next
    return state
  }

  /** Kill the child and clear the relays. Never throws — teardown must always complete. */
  async function teardown(): Promise<void> {
    const target = active
    child?.kill()
    child = null
    active = null
    if (!target) return
    try {
      await deps.exec(target.sandbox, teardownScript({ relayPort: target.ports.relay, appPort: target.ports.app }))
    } catch (e) {
      // The sandbox may already be gone; the child is dead either way, which is what matters.
      deps.log?.error(`capture teardown exec failed: ${(e as Error).message}`)
    }
  }

  /** Pick the first candidate port with no LISTEN socket inside the sandbox. */
  async function pickPort(sandbox: string, candidates: readonly number[], label: string): Promise<number> {
    const out = await deps.execCapture(sandbox, freePortScript(candidates))
    const port = parseFreePort(out)
    if (port === null) throw new CaptureError('preflight', `No free ${label} port in the sandbox (tried ${candidates.join(', ')}).`)
    return port
  }

  async function runEnable(sandbox: string, force: boolean): Promise<CaptureStatus> {
    const cfg = deps.settings()

    // ---- preflight -------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'preflight', checks: [] })
    if (!cfg.caPath.trim()) {
      throw new CaptureError('preflight', 'No Burp CA certificate configured. Set one in Settings > Traffic capture.')
    }
    const ca = deps.readCa(cfg.caPath)
    if (!(await deps.probe(cfg.proxyPort))) {
      throw new CaptureError('preflight', `Burp is not listening on 127.0.0.1:${cfg.proxyPort}. Start Burp, or correct the port in Settings.`)
    }
    const socatOut = await deps.execCapture(sandbox, socatProbeScript())
    if (!socatOut.includes(SOCAT_OK_MARK)) {
      throw new CaptureError('preflight', 'socat is not installed in this sandbox, so the capture relays cannot run.')
    }
    const relayPort = await pickPort(sandbox, RELAY_PORT_CANDIDATES, 'relay')
    const appPort = await pickPort(sandbox, APP_PORT_CANDIDATES, 'capture')
    const ports: CapturePorts = { proxy: cfg.proxyPort, upstream: cfg.upstreamPort, relay: relayPort, app: appPort }
    const checks: CaptureCheck[] = [{ id: 'burp', ok: true, detail: `127.0.0.1:${cfg.proxyPort}` }]

    // ---- ca --------------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'ca', checks, ports })
    const caOut = await deps.execCapture(sandbox, caInstallScript(ca.pem))
    if (!caOut.includes(CA_OK_MARK)) throw new CaptureError('ca', 'Could not install the Burp CA into the sandbox trust store.')
    checks.push({ id: 'ca', ok: true, detail: ca.commonName })

    // ---- profile ---------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'profile', checks, ports })
    const profOut = await deps.execCapture(sandbox, profileInstallScript())
    if (!profOut.includes(PROFILE_OK_MARK)) throw new CaptureError('profile', 'Could not write /etc/profile.d/burp-proxy.sh in the sandbox.')

    // ---- tunnel ----------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'tunnel', checks, ports })
    child = deps.spawnSsh(sshArgs({ sandbox, upstreamPort: cfg.upstreamPort, relayPort, appPort, proxyPort: cfg.proxyPort }))
    active = { sandbox, ports }
    child.onExit(() => {
      // The tunnel died on its own (Burp closed, sandbox stopped, network blip). Reflect it
      // rather than showing a live session against a dead child.
      if (active?.sandbox === sandbox && state.state === 'on') {
        child = null
        void teardown().then(() => set({ ...IDLE_STATUS }))
      }
    })
    const bound = await waitFor(() => deps.probe(cfg.upstreamPort), 10, 500)
    if (!bound) throw new CaptureError('tunnel', `The SSH tunnel did not bind 127.0.0.1:${cfg.upstreamPort}. Another process may be using that port.`)
    checks.push({ id: 'tunnel', ok: true, detail: `127.0.0.1:${cfg.upstreamPort}` })

    // Publish the chosen port so /etc/profile.d activates for new shells.
    await deps.exec(sandbox, publishPortScript(appPort))

    // ---- verify ----------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'verify', checks, ports })
    const verdict = parseVerify(await deps.execCapture(sandbox, verifyScript(appPort)))
    const vChecks = [...checks, ...verifyChecks(verdict)]
    if (!force && !credentialChainOk(verdict)) {
      // Fail closed: a capture that silently 401s the agent is worse than no capture.
      await teardown()
      return set({
        sandbox, state: 'error', phase: 'verify', checks: vChecks, ports,
        message: 'Burp is not chaining back into the sbx proxy, so authenticated requests return 401. Import the Burp upstream-proxy config from Settings, then try again.'
      })
    }
    return set({ sandbox, state: 'on', checks: vChecks, ports })
  }

  return {
    status: () => state,

    async enable(sandbox, opts = {}) {
      // One at a time: Burp's single upstream rule points at one port.
      if (active && active.sandbox !== sandbox) {
        return set({ ...state, message: `${active.sandbox} is already being captured. Disable it first.` })
      }
      if (active && active.sandbox === sandbox && state.state === 'on') return state
      try {
        return await runEnable(sandbox, opts.force === true)
      } catch (e) {
        await teardown()
        const err = e as CaptureError
        return set({
          sandbox, state: 'error',
          phase: err.phase ?? 'preflight',
          checks: state.checks,
          message: err.message ?? String(e)
        })
      }
    },

    async disable() {
      await teardown()
      return set({ ...IDLE_STATUS })
    },

    onRunningInstances(names) {
      if (active && !names.includes(active.sandbox)) {
        void teardown().then(() => set({ ...IDLE_STATUS }))
      }
    }
  }
}
