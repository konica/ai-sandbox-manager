import { describe, it, expect, vi } from 'vitest'
import { createCaptureSession, sshArgs, type CaptureDeps } from '../../../src/main/capture/session'
import { CAPTURE_DEFAULTS } from '../../../src/shared/capture'
import { SOCAT_OK_MARK, CA_OK_MARK, PROFILE_OK_MARK, FREE_PORT_MARK } from '../../../src/main/capture/scripts'

const CA = { pem: '-----BEGIN CERTIFICATE-----\nAA\n-----END CERTIFICATE-----', subject: 'CN=Burp', commonName: 'Burp', expires: '2036' }

/** Default happy-path capture output, keyed by a distinguishing fragment of the script. */
function happyCapture(script: string): string {
  if (script.includes('command -v socat')) return `${SOCAT_OK_MARK}\n`
  // The relay and app probes are the same script shape over different candidate lists, so
  // answer with the first candidate the script itself names rather than a fixed port.
  if (script.includes(FREE_PORT_MARK)) {
    const port = script.includes(`${FREE_PORT_MARK} ${CAPTURE_DEFAULTS.appPort}`)
      ? CAPTURE_DEFAULTS.appPort
      : CAPTURE_DEFAULTS.relayPort
    return `${FREE_PORT_MARK} ${port}\n`
  }
  if (script.includes('update-ca-certificates')) return `${CA_OK_MARK}\n`
  if (script.includes('profile.d')) return `${PROFILE_OK_MARK}\n`
  if (script.includes('CONC=')) return 'CONC=12/12\nCRED=200\nCREDHOST=anthropic\n'
  return ''
}

function deps(over: Partial<CaptureDeps> = {}): CaptureDeps & { killed: () => number; scripts: string[] } {
  const scripts: string[] = []
  let killed = 0
  return {
    exec: vi.fn(async (_n: string, s: string) => { scripts.push(s) }),
    execCapture: vi.fn(async (_n: string, s: string) => { scripts.push(s); return happyCapture(s) }),
    settings: () => ({ caPath: 'C:/burp.cer', proxyPort: 8080, upstreamPort: 3128 }),
    readCa: () => CA,
    spawnSsh: vi.fn(() => ({ kill: () => { killed += 1 }, onExit: () => {} })),
    probe: vi.fn(async () => true),
    ...over,
    killed: () => killed,
    scripts
  } as CaptureDeps & { killed: () => number; scripts: string[] }
}

describe('sshArgs', () => {
  it('forwards the upstream port to the in-sandbox relay and carries the relay command', () => {
    const args = sshArgs({ sandbox: 'demo', upstreamPort: 3128, relayPort: 3129, appPort: 18080, proxyPort: 8080 })
    expect(args).toContain('-L')
    expect(args).toContain('3128:127.0.0.1:3129')
    expect(args).toContain('demo.sbx')
    expect(args.join(' ')).toContain('TCP4-LISTEN:18080')
    expect(args).toContain('ExitOnForwardFailure=yes')
  })
})

describe('capture session', () => {
  it('starts idle', () => {
    expect(createCaptureSession(deps()).status()).toEqual({ sandbox: null, state: 'off', checks: [] })
  })

  it('runs the full happy path and ends on', async () => {
    const d = deps()
    const s = createCaptureSession(d)
    const st = await s.enable('demo')
    expect(st.state).toBe('on')
    expect(st.sandbox).toBe('demo')
    expect(st.ports).toEqual({ proxy: 8080, upstream: 3128, relay: 3129, app: CAPTURE_DEFAULTS.appPort })
    expect(d.spawnSsh).toHaveBeenCalledOnce()
    expect(st.checks.find((c) => c.id === 'credential')?.ok).toBe(true)
  })

  it('installs the CA and the profile drop-in before starting the tunnel', async () => {
    const d = deps()
    await createCaptureSession(d).enable('demo')
    const caAt = d.scripts.findIndex((s) => s.includes('update-ca-certificates'))
    const profileAt = d.scripts.findIndex((s) => s.includes('profile.d'))
    expect(caAt).toBeGreaterThanOrEqual(0)
    expect(profileAt).toBeGreaterThan(caAt)
  })

  it('publishes the chosen app port for the profile script', async () => {
    const d = deps()
    await createCaptureSession(d).enable('demo')
    expect(d.scripts.some((s) => s.includes('/tmp/burp-proxy-port'))).toBe(true)
  })

  it('fails preflight when no CA is configured, without spawning ssh', async () => {
    const d = deps({ settings: () => ({ caPath: '', proxyPort: 8080, upstreamPort: 3128 }) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.phase).toBe('preflight')
    expect(st.message).toMatch(/certificate/i)
    expect(d.spawnSsh).not.toHaveBeenCalled()
  })

  it('fails preflight when Burp is not listening', async () => {
    const d = deps({ probe: vi.fn(async () => false) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.phase).toBe('preflight')
    expect(st.message).toMatch(/8080/)
    expect(d.spawnSsh).not.toHaveBeenCalled()
  })

  it('fails preflight when socat is missing from the sandbox', async () => {
    const d = deps({ execCapture: vi.fn(async (_n: string, s: string) => (s.includes('command -v socat') ? '' : happyCapture(s))) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.message).toMatch(/socat/i)
  })

  it('fails when no candidate port is free, naming the port', async () => {
    const d = deps({ execCapture: vi.fn(async (_n: string, s: string) => (s.includes(FREE_PORT_MARK) ? '' : happyCapture(s))) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.message).toMatch(/port/i)
  })

  it('tears down and reports when the credential chain is broken (fail closed)', async () => {
    const d = deps({
      execCapture: vi.fn(async (_n: string, s: string) =>
        (s.includes('CONC=') ? 'CONC=12/12\nCRED=401\nCREDHOST=anthropic\n' : happyCapture(s)))
    })
    const s = createCaptureSession(d)
    const st = await s.enable('demo')
    expect(st.state).toBe('error')
    expect(st.phase).toBe('verify')
    expect(d.killed()).toBe(1)
    expect(s.status().state).toBe('error')
  })

  it('enables anyway when forced, despite a broken credential chain', async () => {
    const d = deps({
      execCapture: vi.fn(async (_n: string, s: string) =>
        (s.includes('CONC=') ? 'CONC=12/12\nCRED=401\nCREDHOST=anthropic\n' : happyCapture(s)))
    })
    const st = await createCaptureSession(d).enable('demo', { force: true })
    expect(st.state).toBe('on')
    expect(d.killed()).toBe(0)
  })

  it('does not treat an unverifiable credential chain as a failure', async () => {
    const d = deps({
      execCapture: vi.fn(async (_n: string, s: string) =>
        (s.includes('CONC=') ? 'CONC=12/12\nCRED=\nCREDHOST=none\n' : happyCapture(s)))
    })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('on')
    expect(st.checks.find((c) => c.id === 'credential')?.ok).toBe(false)
  })

  it('refuses a second sandbox while one is capturing, and names the occupant', async () => {
    const s = createCaptureSession(deps())
    await s.enable('first')
    const st = await s.enable('second')
    expect(st.state).toBe('on')
    expect(st.sandbox).toBe('first')
    expect(st.message).toMatch(/first/)
  })

  it('disables: kills the child, runs teardown, returns to idle', async () => {
    const d = deps()
    const s = createCaptureSession(d)
    await s.enable('demo')
    const st = await s.disable()
    expect(st).toEqual({ sandbox: null, state: 'off', checks: [] })
    expect(d.killed()).toBe(1)
    expect(d.scripts.some((x) => x.includes('rm -f /tmp/burp-proxy-port'))).toBe(true)
  })

  it('disable is idempotent and safe when nothing is running', async () => {
    const s = createCaptureSession(deps())
    expect((await s.disable()).state).toBe('off')
    expect((await s.disable()).state).toBe('off')
  })

  it('still returns to idle when the teardown exec throws', async () => {
    const d = deps({ exec: vi.fn(async () => { throw new Error('sandbox gone') }) })
    const s = createCaptureSession(d)
    await s.enable('demo')
    expect((await s.disable()).state).toBe('off')
  })

  it('tears down when its sandbox stops appearing as running', async () => {
    const d = deps()
    const s = createCaptureSession(d)
    await s.enable('demo')
    s.onRunningInstances(['other'])
    await vi.waitFor(() => expect(s.status().state).toBe('off'))
    expect(d.killed()).toBe(1)
  })

  it('keeps capturing while its sandbox is still running', async () => {
    const s = createCaptureSession(deps())
    await s.enable('demo')
    s.onRunningInstances(['demo', 'other'])
    expect(s.status().state).toBe('on')
  })
})
