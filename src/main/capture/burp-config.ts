/** Default filename offered by the Save dialog for the exported Burp config. */
export const BURP_CONFIG_FILENAME = 'burp-upstream-proxy.json'

/**
 * Build the Burp user-config JSON that points Burp's upstream proxy at our `ssh -L` listener.
 *
 * Without this rule Burp goes straight to the internet, bypassing the sbx proxy, and every
 * authenticated request from the sandbox returns 401 — a failure that looks like broken
 * credentials rather than broken proxy config. Exporting it removes the transcription risk
 * of a five-field manual form.
 *
 * The key path (`user_options.connections.upstream_proxy`) was read from a working Burp
 * installation. Being *user* options rather than project options, it is imported once
 * (Settings -> User settings -> Import) and applies to every Burp project.
 */
export function buildBurpUserConfig(upstreamPort: number): string {
  const config = {
    user_options: {
      connections: {
        upstream_proxy: {
          servers: [
            { destination_host: '*', enabled: true, proxy_host: '127.0.0.1', proxy_port: upstreamPort }
          ]
        }
      }
    }
  }
  return `${JSON.stringify(config, null, 2)}\n`
}
