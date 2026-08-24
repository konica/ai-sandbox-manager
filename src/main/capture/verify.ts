import { connect } from 'node:net'
import type { CaptureCheck } from '@shared/capture'

/** Number of parallel requests in the concurrency check. */
const CONCURRENCY = 12

/**
 * Is something listening on a host loopback port? Used twice: Burp during preflight, and
 * the `ssh -L` listener after the tunnel phase. Never rejects — a probe failure is a
 * `false`, not an exception.
 */
export function tcpProbe(port: number, opts: { host?: string; timeoutMs?: number } = {}): Promise<boolean> {
  const { host = '127.0.0.1', timeoutMs = 2000 } = opts
  return new Promise((resolve) => {
    let settled = false
    const done = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    const socket = connect({ port, host })
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

/**
 * In-sandbox verification. This single script exercises the entire chain — app port, Burp,
 * `ssh -L`, relay, sbx proxy — so no separate host-side chain check is needed.
 *
 * The credential probe uses Anthropic's `GET /v1/models` first: it is the agent's own API,
 * configured in every sandbox this app targets, needs no request body, and spends no tokens.
 * GitHub is the fallback for sandboxes without an Anthropic credential.
 */
export function verifyScript(appPort: number): string {
  const proxy = `http://127.0.0.1:${appPort}`
  return `
P=${proxy}
OK=$(for i in $(seq 1 ${CONCURRENCY}); do (timeout 25 curl -s -o /dev/null -w '%{http_code}\\n' -x "$P" https://example.com 2>/dev/null) & done; wait)
echo "CONC=$(echo "$OK" | grep -c '^200$')/${CONCURRENCY}"
if [ -n "\${ANTHROPIC_API_KEY:-}" ] || [ "\${SBX_CRED_ANTHROPIC_MODE:-none}" != "unavailable" ]; then
  C=$(timeout 25 curl -s -o /dev/null -w '%{http_code}' -x "$P" -H 'anthropic-version: 2023-06-01' https://api.anthropic.com/v1/models 2>/dev/null)
  if [ -n "$C" ] && [ "$C" != "000" ]; then echo "CRED=$C"; echo "CREDHOST=anthropic"; exit 0; fi
fi
if [ -n "\${GH_TOKEN:-}" ]; then
  C=$(timeout 25 curl -s -o /dev/null -w '%{http_code}' -x "$P" -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user 2>/dev/null)
  if [ -n "$C" ] && [ "$C" != "000" ]; then echo "CRED=$C"; echo "CREDHOST=github"; exit 0; fi
fi
echo "CRED="
echo "CREDHOST=none"
`.trim()
}

export interface VerifyResult {
  concurrency: { ok: number; total: number }
  credential: { host: 'anthropic' | 'github' | 'none'; code: number | null }
}

function matchLine(stdout: string, key: string): string | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (t.startsWith(`${key}=`)) return t.slice(key.length + 1)
  }
  return null
}

/** Parse the verify script's marker lines. Tolerates empty and malformed output. */
export function parseVerify(stdout: string): VerifyResult {
  const conc = matchLine(stdout, 'CONC')
  const m = conc?.match(/^(\d+)\/(\d+)$/)
  const hostRaw = matchLine(stdout, 'CREDHOST')
  const host = hostRaw === 'anthropic' || hostRaw === 'github' ? hostRaw : 'none'
  const codeRaw = matchLine(stdout, 'CRED')
  const code = codeRaw && /^\d+$/.test(codeRaw) ? Number(codeRaw) : null
  return {
    concurrency: { ok: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : CONCURRENCY },
    credential: { host, code }
  }
}

/**
 * Whether the Burp-chains-back-into-the-sbx-proxy requirement holds.
 *
 * Only `401` indicates a broken chain: authentication happens at the sbx proxy before the
 * upstream service validates the request, so any other 4xx still proves injection worked.
 * When nothing could be probed this is not treated as a failure — the card warns instead.
 */
export function credentialChainOk(v: VerifyResult): boolean {
  if (v.credential.host === 'none' || v.credential.code === null) return true
  return v.credential.code !== 401
}

export function verifyChecks(v: VerifyResult): CaptureCheck[] {
  const concOk = v.concurrency.total > 0 && v.concurrency.ok === v.concurrency.total
  const credChecked = v.credential.host !== 'none' && v.credential.code !== null
  return [
    { id: 'concurrency', ok: concOk, detail: `${v.concurrency.ok}/${v.concurrency.total}` },
    {
      id: 'credential',
      ok: credChecked && credentialChainOk(v),
      detail: credChecked
        ? `${v.credential.host} ${v.credential.code}`
        : 'not verified — no credential to probe with'
    }
  ]
}
