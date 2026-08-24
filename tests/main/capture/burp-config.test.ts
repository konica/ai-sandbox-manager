import { describe, it, expect } from 'vitest'
import { buildBurpUserConfig, BURP_CONFIG_FILENAME } from '../../../src/main/capture/burp-config'

describe('buildBurpUserConfig', () => {
  it('produces the exact user_options.connections.upstream_proxy shape Burp imports', () => {
    const parsed = JSON.parse(buildBurpUserConfig(3128))
    expect(parsed).toEqual({
      user_options: {
        connections: {
          upstream_proxy: {
            servers: [
              { destination_host: '*', enabled: true, proxy_host: '127.0.0.1', proxy_port: 3128 }
            ]
          }
        }
      }
    })
  })

  it('uses the configured upstream port', () => {
    const parsed = JSON.parse(buildBurpUserConfig(3200))
    expect(parsed.user_options.connections.upstream_proxy.servers[0].proxy_port).toBe(3200)
  })

  it('is pretty-printed with a trailing newline so it reads well in an editor', () => {
    const out = buildBurpUserConfig(3128)
    expect(out).toContain('\n  "user_options"')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('exports a sensible default filename', () => {
    expect(BURP_CONFIG_FILENAME).toBe('burp-upstream-proxy.json')
  })
})
