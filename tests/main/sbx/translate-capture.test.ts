import { describe, it, expect } from 'vitest'
import { hostShellCommand } from '../../../src/main/sbx/translate'

describe('hostShellCommand without capture', () => {
  it('is byte-identical to the pre-capture command', () => {
    expect(hostShellCommand('my-project')).toBe("sbx exec -it 'my-project' bash")
  })

  it('is unchanged when the capture port is undefined', () => {
    expect(hostShellCommand('my-project', undefined)).toBe("sbx exec -it 'my-project' bash")
  })
})

describe('hostShellCommand while capturing', () => {
  // `sbx exec` runs a NON-login bash, which never sources /etc/profile.d — so the capture
  // profile script cannot reach it and the shell would keep the sandbox's stock proxy.
  // Injecting the env directly is what actually routes a new shell through Burp.
  it('injects the proxy env pointing at the in-sandbox capture port', () => {
    const cmd = hostShellCommand('my-project', 18080)
    expect(cmd).toContain('-e http_proxy=http://127.0.0.1:18080')
    expect(cmd).toContain('-e https_proxy=http://127.0.0.1:18080')
    expect(cmd).toContain('-e HTTP_PROXY=http://127.0.0.1:18080')
    expect(cmd).toContain('-e HTTPS_PROXY=http://127.0.0.1:18080')
  })

  it('keeps sandbox-local destinations direct, matching the profile script', () => {
    const cmd = hostShellCommand('my-project', 18080)
    expect(cmd).toContain('-e no_proxy=localhost,127.0.0.1,::1,gateway.docker.internal')
    expect(cmd).toContain('-e NO_PROXY=localhost,127.0.0.1,::1,gateway.docker.internal')
  })

  it('honours a dynamically chosen capture port', () => {
    expect(hostShellCommand('x', 18083)).toContain('-e http_proxy=http://127.0.0.1:18083')
  })

  it('still quotes the sandbox name and ends with bash', () => {
    const cmd = hostShellCommand("it's", 18080)
    expect(cmd).toContain(`'it'\\''s'`)
    expect(cmd.endsWith(' bash')).toBe(true)
  })

  it('puts every -e flag before the sandbox name, as docker exec requires', () => {
    const cmd = hostShellCommand('my-project', 18080)
    expect(cmd.lastIndexOf('-e ')).toBeLessThan(cmd.indexOf("'my-project'"))
  })
})
