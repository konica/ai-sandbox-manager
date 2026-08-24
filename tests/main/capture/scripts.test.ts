import { describe, it, expect } from 'vitest'
import {
  socatProbeScript, freePortScript, parseFreePort, caInstallScript, profileScriptBody,
  profileInstallScript, relayCommand, publishPortScript, teardownScript,
  CA_OK_MARK, PROFILE_OK_MARK, SOCAT_OK_MARK, FREE_PORT_MARK
} from '../../../src/main/capture/scripts'
import { PORT_FILE } from '../../../src/shared/capture'

describe('socatProbeScript', () => {
  it('emits the ok marker only when socat resolves', () => {
    const s = socatProbeScript()
    expect(s).toContain('command -v socat')
    expect(s).toContain(SOCAT_OK_MARK)
  })
})

describe('freePortScript / parseFreePort', () => {
  it('checks each candidate for a LISTEN socket and prints the first free one', () => {
    const s = freePortScript([3129, 3130])
    // 3129 = 0x0C39, 3130 = 0x0C3A — /proc/net/tcp renders ports in uppercase hex.
    expect(s).toContain('0C39')
    expect(s).toContain('0C3A')
    expect(s).toContain(FREE_PORT_MARK)
    // Only state 0A (LISTEN) counts; TIME_WAIT sockets must not mark a port as busy.
    expect(s).toContain('0A')
  })

  it('parses the marked port and returns null when none was free', () => {
    expect(parseFreePort(`${FREE_PORT_MARK} 3131\n`)).toBe(3131)
    expect(parseFreePort('noise\n')).toBe(null)
    expect(parseFreePort('')).toBe(null)
  })
})

describe('caInstallScript', () => {
  it('writes the PEM to the trust store and refreshes it', () => {
    const s = caInstallScript('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n')
    expect(s).toContain('/usr/local/share/ca-certificates/burp.crt')
    expect(s).toContain('update-ca-certificates')
    expect(s).toContain('-----BEGIN CERTIFICATE-----')
    expect(s).toContain(CA_OK_MARK)
  })

  it('uses a quoted heredoc so the PEM is never shell-expanded', () => {
    expect(caInstallScript('x')).toContain("<<'BURP_CA_EOF'")
  })

  it('refuses a PEM containing the heredoc delimiter', () => {
    expect(() => caInstallScript('BURP_CA_EOF')).toThrow(/delimiter/i)
  })
})

describe('profileScriptBody', () => {
  it('activates only on a LISTEN socket, never on TIME_WAIT', () => {
    const body = profileScriptBody()
    expect(body).toContain(PORT_FILE)
    expect(body).toContain('$4=="0A"')
    expect(body).toContain('/proc/net/tcp')
  })

  it('exports the proxy variables and keeps loopback direct', () => {
    const body = profileScriptBody()
    for (const v of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY', 'JAVA_TOOL_OPTIONS']) {
      expect(body).toContain(v)
    }
    expect(body).toContain('gateway.docker.internal')
  })

  it('stays POSIX sh — no bashisms, because /bin/sh here is dash', () => {
    const body = profileScriptBody()
    expect(body).not.toContain('/dev/tcp')
    expect(body).not.toContain('[[')
  })
})

describe('profileInstallScript', () => {
  it('writes the profile drop-in via sudo and marks success', () => {
    const s = profileInstallScript()
    expect(s).toContain('/etc/profile.d/burp-proxy.sh')
    expect(s).toContain('sudo tee')
    expect(s).toContain(PROFILE_OK_MARK)
  })
})

describe('relayCommand', () => {
  it('starts both relays and waits, so killing ssh kills them', () => {
    const cmd = relayCommand({ relayPort: 3129, appPort: 18080, proxyPort: 8080 })
    expect(cmd).toContain('TCP4-LISTEN:3129')
    expect(cmd).toContain('TCP6:gateway.docker.internal:3128')
    expect(cmd).toContain('TCP4-LISTEN:18080')
    expect(cmd).toContain('PROXY:gateway.docker.internal:127.0.0.1:8080')
    expect(cmd).toContain('proxyport=3128')
    expect(cmd).toContain('wait')
  })

  it('binds relays to loopback only', () => {
    const cmd = relayCommand({ relayPort: 3129, appPort: 18080, proxyPort: 8080 })
    expect(cmd.match(/bind=127\.0\.0\.1/g)?.length).toBe(2)
  })
})

describe('publishPortScript', () => {
  it('writes the chosen app port where the profile script reads it', () => {
    expect(publishPortScript(18081)).toContain(`echo 18081 > ${PORT_FILE}`)
  })
})

describe('teardownScript', () => {
  it('kills both relays and removes the port file so shells fall back to the sbx proxy', () => {
    const s = teardownScript({ relayPort: 3129, appPort: 18080 })
    expect(s).toContain('TCP4-LISTEN:3129')
    expect(s).toContain('TCP4-LISTEN:18080')
    expect(s).toContain(`rm -f ${PORT_FILE}`)
    expect(s).toContain('exit 0') // teardown must never fail the exec
  })
})
