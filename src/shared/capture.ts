/** Default ports for the Burp capture path. See the design doc for why each hop exists. */
export const CAPTURE_DEFAULTS = {
  /** Burp's proxy listener on host loopback. */
  proxyPort: 8080,
  /** Host port Burp uses as its upstream proxy; held open by `ssh -L`. */
  upstreamPort: 3128,
  /** In-sandbox loopback relay -> gateway.docker.internal:3128. */
  relayPort: 3129,
  /** In-sandbox port applications actually talk to (http_proxy points here). */
  appPort: 18080
} as const

/**
 * Candidate ports tried in order when the preferred one is occupied. Nothing outside the
 * sandbox references these two, so they are chosen dynamically rather than configured:
 * the profile script reads the chosen app port from /tmp/burp-proxy-port.
 */
export const RELAY_PORT_CANDIDATES: readonly number[] = [3129, 3130, 3131, 3132, 3133, 3134, 3135, 3136]
export const APP_PORT_CANDIDATES: readonly number[] = [18080, 18081, 18082, 18083, 18084, 18085, 18086, 18087]

/** Where the chosen app port is published inside the sandbox for /etc/profile.d to read. */
export const PORT_FILE = '/tmp/burp-proxy-port'

/** Host-configurable Burp settings. The two in-sandbox ports are deliberately not here. */
export interface BurpSettings {
  /** Absolute path to the Burp CA file (DER or PEM). Empty means unconfigured. */
  caPath: string
  proxyPort: number
  upstreamPort: number
}

export type CapturePhase = 'preflight' | 'ca' | 'profile' | 'tunnel' | 'verify'
export type CaptureState = 'off' | 'starting' | 'on' | 'error'

/** One named verification result, rendered as a tick or cross in the capture card. */
export interface CaptureCheck {
  id: string
  ok: boolean
  detail: string
}

export interface CapturePorts {
  proxy: number
  upstream: number
  relay: number
  app: number
}

/**
 * Global capture status — global rather than per-instance because only one session can
 * exist. A capture card decides what to render by comparing `sandbox` to its own instance.
 */
export interface CaptureStatus {
  sandbox: string | null
  state: CaptureState
  phase?: CapturePhase
  checks: CaptureCheck[]
  message?: string
  ports?: CapturePorts
}

export const IDLE_STATUS: CaptureStatus = { sandbox: null, state: 'off', checks: [] }
