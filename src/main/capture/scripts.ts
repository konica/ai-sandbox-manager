import { PORT_FILE } from '@shared/capture'

/**
 * Scripts run inside a running sandbox via `sbx exec <name> bash -lc <script>`.
 * `sudo -n` and `/usr/bin/socat` are both present in the sbx base image.
 */

export const SOCAT_OK_MARK = '__SBX_SOCAT_OK__'
export const CA_OK_MARK = '__SBX_CA_OK__'
export const PROFILE_OK_MARK = '__SBX_PROFILE_OK__'
export const FREE_PORT_MARK = '__SBX_FREE_PORT__'

const CA_PATH = '/usr/local/share/ca-certificates/burp.crt'
const PROFILE_PATH = '/etc/profile.d/burp-proxy.sh'
const HEREDOC = 'BURP_CA_EOF'

/** Print the ok marker when socat is installed. */
export function socatProbeScript(): string {
  return `command -v socat >/dev/null 2>&1 && echo ${SOCAT_OK_MARK} || true`
}

/** /proc/net/tcp renders ports as uppercase 4-digit hex. */
function hexPort(port: number): string {
  return port.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Print `FREE_PORT_MARK <port>` for the first candidate with no LISTEN socket.
 *
 * State `0A` is LISTEN. Matching any looser also matches `TIME_WAIT` (state `06`) sockets,
 * of which there are many on a recently-used capture port, and would report a free port as
 * busy — the mirror image of the bug the profile script guards against.
 */
export function freePortScript(candidates: readonly number[]): string {
  const checks = candidates.map((p) => {
    const h = hexPort(p)
    return `if ! awk '$4=="0A" && $2 ~ /:${h}$/ {found=1} END{exit !found}' /proc/net/tcp 2>/dev/null; then echo "${FREE_PORT_MARK} ${p}"; exit 0; fi`
  })
  return checks.join('\n')
}

export function parseFreePort(stdout: string): number | null {
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(new RegExp(`^${FREE_PORT_MARK}\\s+(\\d+)$`))
    if (m) return Number(m[1])
  }
  return null
}

/**
 * Install the Burp CA into the sandbox trust store. `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`
 * and `NODE_EXTRA_CA_CERTS` all point at /etc/ssl/certs/ca-certificates.crt, so this single
 * install covers curl, openssl, python-requests, node and Claude Code together.
 *
 * The PEM is embedded in a quoted heredoc (never expanded) because `execScript` has no
 * stdin channel. Idempotent — re-run on every enable, since a sandbox rebuild wipes it.
 */
export function caInstallScript(pem: string): string {
  if (pem.includes(HEREDOC)) throw new Error('Certificate content contains the heredoc delimiter; refusing to build an ambiguous script.')
  return [
    `sudo tee ${CA_PATH} >/dev/null <<'${HEREDOC}'`,
    pem.trimEnd(),
    HEREDOC,
    `sudo update-ca-certificates >/dev/null 2>&1 && echo ${CA_OK_MARK}`
  ].join('\n')
}

/**
 * Body of /etc/profile.d/burp-proxy.sh.
 *
 * Must stay POSIX sh: /bin/sh here is dash, which has no `/dev/tcp`. Liveness is therefore
 * read from /proc/net/tcp, and the state comparison is exact: `0A` is LISTEN, and matching
 * anything looser also matches TIME_WAIT sockets — measured at 20 of them on the capture
 * port immediately after a teardown. A false pass there would keep exporting http_proxy to
 * a dead relay and break egress, instead of falling back to the sbx proxy.
 */
export function profileScriptBody(): string {
  return `# ${PROFILE_PATH}
# Point login shells at Burp, but only while the tunnel is genuinely up, so closing Burp
# degrades to the stock sbx proxy instead of killing egress.
# Must stay POSIX sh: /bin/sh here is dash, which has no bash-style TCP device redirection.

_bp_file=${PORT_FILE}
if [ -r "$_bp_file" ]; then
    _bp_port=$(cat "$_bp_file" 2>/dev/null)
    case "$_bp_port" in
        ''|*[!0-9]*) _bp_port="" ;;
    esac
fi

if [ -n "\${_bp_port:-}" ]; then
    # Read-only liveness check. State 0A is LISTEN; matching anything looser also matches
    # TIME_WAIT sockets on the same port and gives a false pass.
    _bp_hex=$(printf '%04X' "$_bp_port")
    if awk -v h=":$_bp_hex" '$4=="0A" && index($2,h) {found=1} END{exit !found}' \\
         /proc/net/tcp 2>/dev/null; then

        http_proxy="http://127.0.0.1:$_bp_port";  export http_proxy
        https_proxy="$http_proxy";                export https_proxy
        HTTP_PROXY="$http_proxy";                 export HTTP_PROXY
        HTTPS_PROXY="$http_proxy";                export HTTPS_PROXY

        JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=$_bp_port -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=$_bp_port -Dhttp.nonProxyHosts=localhost|127.*|[::1]|gateway.docker.internal"
        export JAVA_TOOL_OPTIONS

        # no_proxy is matched against the DESTINATION, never the proxy address, so keeping
        # loopback here leaves sandbox-local services direct without bypassing the tunnel.
        no_proxy="localhost,127.0.0.1,::1,gateway.docker.internal"; export no_proxy
        NO_PROXY="$no_proxy"; export NO_PROXY
    fi
fi
unset _bp_file _bp_port _bp_hex
`
}

/** Write the profile drop-in via sudo. Quoted heredoc: the body must reach disk verbatim. */
export function profileInstallScript(): string {
  return [
    `sudo tee ${PROFILE_PATH} >/dev/null <<'BURP_PROFILE_EOF'`,
    profileScriptBody().trimEnd(),
    'BURP_PROFILE_EOF',
    `sudo chmod 0644 ${PROFILE_PATH} && echo ${PROFILE_OK_MARK}`
  ].join('\n')
}

/**
 * The remote command carried by the ssh session. Both relays run under it and the trailing
 * `wait` keeps the session alive, so killing the ssh child tears the whole apparatus down.
 *
 * - `:relayPort` is the loopback hop `ssh -L` needs, because sbx's SSH server permits
 *   loopback forwarding only and cannot target gateway.docker.internal directly.
 * - `:appPort` is what http_proxy points at. It reaches Burp by asking the sbx proxy to
 *   CONNECT to 127.0.0.1:<proxyPort> — sandboxd is a host process, so that loopback is the
 *   host's. This is the only route: no host alias is reachable from inside the sandbox.
 */
export function relayCommand(p: { relayPort: number; appPort: number; proxyPort: number }): string {
  const relay = `socat TCP4-LISTEN:${p.relayPort},bind=127.0.0.1,fork,reuseaddr TCP6:gateway.docker.internal:3128`
  const app = `socat TCP4-LISTEN:${p.appPort},bind=127.0.0.1,fork,reuseaddr PROXY:gateway.docker.internal:127.0.0.1:${p.proxyPort},proxyport=3128,pf=ip6`
  return `${relay} & ${app} & wait`
}

/** Publish the chosen app port where /etc/profile.d reads it. */
export function publishPortScript(appPort: number): string {
  return `echo ${appPort} > ${PORT_FILE}`
}

/**
 * Belt-and-braces teardown. Killing the ssh child normally takes the relays with it, but
 * sbx's SSH server is a custom Go implementation whose signal propagation is not guaranteed.
 * Removing the port file is what makes new shells fall back to the stock sbx proxy.
 * Always exits 0 — a teardown that throws would strand the session in a wedged state.
 *
 * The `[ ]` in the pattern is a self-match guard: the `bash -lc` parent carries this whole
 * script in its own cmdline, and a plain `-f` pattern would match it and kill the exec that
 * is doing the teardown. `socat[ ]TCP4-LISTEN:<port>` matches the real relay (`socat` then a
 * space) but not the literal text in the parent's cmdline (`socat` then `[`).
 */
export function teardownScript(p: { relayPort: number; appPort: number }): string {
  return [
    `pkill -f 'socat[ ]TCP4-LISTEN:${p.relayPort}' >/dev/null 2>&1`,
    `pkill -f 'socat[ ]TCP4-LISTEN:${p.appPort}' >/dev/null 2>&1`,
    `rm -f ${PORT_FILE}`,
    'exit 0'
  ].join('; ')
}
