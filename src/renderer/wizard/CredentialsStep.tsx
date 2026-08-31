import { useState } from 'react'
import { KNOWN_SERVICES, serviceById } from '@shared/services'
import { toSbxName } from '@shared/names'
import { normalizeCredHost } from '@shared/host'
import type { RegistryScope } from '@shared/types'
import { useT } from '../i18n'
import type { DraftCred, DraftCustomCred, DraftRegistryCred, DraftServiceCred } from './draft'

const rowStyle = { display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' as const, marginBottom: 'var(--space-2)' }
const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.04em' }
const hint = { fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }
const sectionLbl = { fontSize: 13, fontWeight: 600, margin: 'var(--space-4) 0 var(--space-2)' }
const sshCode = { margin: 0, padding: '6px 8px', background: 'var(--bg, rgba(0,0,0,.25))', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' as const, overflowX: 'auto' as const, userSelect: 'text' as const }
const credRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 6 } as const

// Text-style credential-type tab, matching the v7 mockup (.cred-type-tab).
function credTabStyle(active: boolean, disabled = false) {
  return {
    padding: 'var(--space-1) var(--space-3)', fontSize: 12, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', fontFamily: 'inherit',
    background: active ? 'var(--bg-hover)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1
  } as const
}

function mask(value: string): string {
  return value.trim().length >= 4 ? '••••••••••••••••' + value.trim().slice(-4) : '••••••••••••••••'
}

type HostOs = 'mac' | 'linux' | 'win'

/**
 * Which OS's setup steps to show by default. Anything we don't recognise (including the
 * empty string the renderer holds until `ssh:detect` resolves) falls back to macOS.
 */
function osFromPlatform(platform: string): HostOs {
  return platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : 'mac'
}

/**
 * Copy-pasteable host-setup commands per OS. Forwarding is driven entirely by
 * SSH_AUTH_SOCK (launch strips it to opt out), so each recipe's job is to get a
 * *session-wide* agent socket that this app — a GUI process, not a terminal child —
 * can actually see.
 */
const SSH_SETUP = {
  mac: {
    load: 'ssh-add --apple-use-keychain ~/.ssh/id_ed25519',
    config: 'Host *\n  AddKeysToAgent yes\n  UseKeychain yes\n  IdentityFile ~/.ssh/id_ed25519',
    verify: 'ssh-add -l'
  },
  linux: {
    check: 'echo "$SSH_AUTH_SOCK"\nssh-add -l',
    // A systemd user unit + environment.d entry, rather than `eval $(ssh-agent -s)`:
    // the latter only ever exports the socket into the one shell that ran it.
    service: [
      'mkdir -p ~/.config/systemd/user ~/.config/environment.d',
      "cat > ~/.config/systemd/user/ssh-agent.service <<'EOF'",
      '[Unit]',
      'Description=SSH agent',
      '',
      '[Service]',
      'ExecStart=/usr/bin/ssh-agent -D -a %t/ssh-agent.socket',
      '',
      '[Install]',
      'WantedBy=default.target',
      'EOF',
      "echo 'SSH_AUTH_SOCK=${XDG_RUNTIME_DIR}/ssh-agent.socket' > ~/.config/environment.d/ssh-agent.conf",
      'systemctl --user enable --now ssh-agent'
    ].join('\n'),
    config: 'Host *\n  AddKeysToAgent yes\n  IdentityFile ~/.ssh/id_ed25519',
    verify: 'ssh-add ~/.ssh/id_ed25519\nssh-add -l'
  },
  win: {
    // `ssh-add -l` exits 2 only when no agent is reachable (1 just means "no identities
    // loaded yet"), so keying off 2 reuses a live agent instead of clobbering its socket.
    agent: 'export SSH_AUTH_SOCK="$HOME/.ssh/agent.sock"\nssh-add -l >/dev/null 2>&1\nif [ $? -eq 2 ]; then\n  rm -f "$SSH_AUTH_SOCK"\n  ssh-agent -a "$SSH_AUTH_SOCK" >/dev/null\nfi',
    key: 'mkdir -p ~/.ssh && chmod 700 ~/.ssh\ncp /mnt/c/Users/<you>/.ssh/id_ed25519* ~/.ssh/\nchmod 600 ~/.ssh/id_ed25519\nssh-add ~/.ssh/id_ed25519',
    verify: 'ssh-add -l'
  }
} as const

/**
 * Credentials wizard step, mirroring the v5 mockup: Service / Custom / (Registry —
 * deferred) tabs, an Import-from-environment panel, and a security note. Service
 * values go to `sbx secret set`; custom secrets become a generated mixin-kit
 * serviceAuth four-block. Values are staged host-side on submit.
 */
export function CredentialsStep({ credentials, onAddService, onAddCustom, onAddRegistry, onRemove, envHits, onImport, ssh, onSshChange, sshDetected, hostPlatform = '' }: {
  credentials: DraftCred[]
  onAddService: (serviceId: string, envVar: string, value: string) => void
  onAddCustom: (cred: DraftCustomCred) => void
  onAddRegistry: (cred: DraftRegistryCred) => void
  onRemove: (index: number) => void
  envHits: { serviceId: string; label: string; envVar: string; masked: string }[]
  onImport: (serviceId: string, scope: 'sandbox' | 'global') => void
  ssh: { forwardAgent: boolean; commitSigning: boolean }
  onSshChange: (next: { forwardAgent: boolean; commitSigning: boolean }) => void
  sshDetected: boolean
  /** Host `process.platform`, from `ssh:detect`. Picks the guide's default OS tab. */
  hostPlatform?: string
}): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<'service' | 'custom' | 'registry' | 'ssh'>('service')
  const [serviceId, setServiceId] = useState(KNOWN_SERVICES[0].id)
  const [svcValue, setSvcValue] = useState('')
  const [host, setHost] = useState('')
  const [hostError, setHostError] = useState(false)
  const [envVar, setEnvVar] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [regHost, setRegHost] = useState('')
  const [regUser, setRegUser] = useState('')
  const [regToken, setRegToken] = useState('')
  const [regScope, setRegScope] = useState<RegistryScope>('host')
  const [sshHelpOpen, setSshHelpOpen] = useState(false)
  // null = "follow the detected host". Detection resolves after first paint, so deriving
  // the default on render (rather than seeding useState) lets it arrive without an effect.
  const [osPick, setOsPick] = useState<HostOs | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importScope, setImportScope] = useState<'sandbox' | 'global'>('sandbox')

  const hostOs = osPick ?? osFromPlatform(hostPlatform)
  const selectedSvc = serviceById(serviceId)
  const services = credentials.map((c, i) => ({ c, i })).filter((x): x is { c: DraftServiceCred; i: number } => x.c.kind === 'service')
  const customs = credentials.map((c, i) => ({ c, i })).filter((x): x is { c: DraftCustomCred; i: number } => x.c.kind === 'custom')
  const registries = credentials.map((c, i) => ({ c, i })).filter((x): x is { c: DraftRegistryCred; i: number } => x.c.kind === 'registry')

  function addService(): void {
    if (!selectedSvc || !svcValue.trim()) return
    onAddService(selectedSvc.id, selectedSvc.envVars[0], svcValue.trim())
    setSvcValue('')
  }
  function editService(c: DraftServiceCred, i: number): void {
    setTab('service'); setServiceId(c.serviceId); setSvcValue(c.value); onRemove(i)
  }
  function addCustom(): void {
    if (!host.trim() || !envVar.trim()) return
    // sbx takes a bare host for --host and rejects anything else ("expected host or IP without
    // scheme/port"). An API base URL is what people paste out of provider docs, so reduce that
    // shape here rather than storing a target that fails silently at launch.
    const target = normalizeCredHost(host)
    if (!target) { setHostError(true); return }
    setHostError(false)
    onAddCustom({ kind: 'custom', id: toSbxName(target), label: target, envVar: envVar.trim(), domains: [target], value: customValue })
    setHost(''); setEnvVar(''); setCustomValue('')
  }
  function editCustom(c: DraftCustomCred, i: number): void {
    setTab('custom'); setHost(c.domains[0] ?? ''); setEnvVar(c.envVar); setCustomValue(c.value); onRemove(i)
  }
  function addRegistry(): void {
    const h = regHost.trim()
    if (!h || !regToken.trim()) return
    onAddRegistry({ kind: 'registry', id: toSbxName(h), host: h, username: regUser.trim(), scope: regScope, value: regToken })
    setRegHost(''); setRegUser(''); setRegToken(''); setRegScope('host')
  }
  function editRegistry(c: DraftRegistryCred, i: number): void {
    setTab('registry'); setRegHost(c.host); setRegUser(c.username); setRegToken(c.value); setRegScope(c.scope); onRemove(i)
  }
  function toggleSel(id: string): void {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function importSelected(): void {
    for (const id of selected) onImport(id, importScope)
    setSelected(new Set()); setImportOpen(false)
  }

  return (
    <>
      <label>{t('wizard.steps.credentials')}</label>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('credentials.subtitle')}</p>

      <div role="tablist" style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)', borderBottom: '1px solid var(--border)', paddingBottom: 'var(--space-2)' }}>
        <button role="tab" aria-selected={tab === 'service'} style={credTabStyle(tab === 'service')} onClick={() => setTab('service')}>{t('credentials.tabService')}</button>
        <button role="tab" aria-selected={tab === 'custom'} style={credTabStyle(tab === 'custom')} onClick={() => setTab('custom')}>{t('credentials.tabCustom')}</button>
        <button role="tab" aria-selected={tab === 'registry'} style={credTabStyle(tab === 'registry')} onClick={() => setTab('registry')}>{t('credentials.tabRegistry')}</button>
        <button role="tab" aria-selected={tab === 'ssh'} style={credTabStyle(tab === 'ssh')} onClick={() => setTab('ssh')}>{t('credentials.tabSsh')}</button>
      </div>
      <p style={{ ...hint, marginBottom: 'var(--space-4)' }}>
        {tab === 'service' && t('credentials.tabServiceDesc')}
        {tab === 'custom' && t('credentials.tabCustomDesc')}
        {tab === 'registry' && t('credentials.tabRegistryDesc')}
        {tab === 'ssh' && t('credentials.tabSshDesc')}
      </p>

      {tab === 'service' && (
        <>
          {/* Import from environment variables (collapsible) */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', margin: 'var(--space-3) 0', overflow: 'hidden' }}>
            <button
              aria-expanded={importOpen}
              onClick={() => setImportOpen((v) => !v)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: 'none', cursor: 'pointer' }}
            >
              <span aria-hidden style={{ color: 'var(--accent)' }}>→</span>
              <span style={{ flex: '1 1 auto' }}>
                <strong style={{ fontSize: 13 }}>{t('credentials.importTitle')}</strong>
                <span style={hint}> · {t('credentials.importSubtitle')}</span>
              </span>
              <span aria-hidden style={{ transform: importOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
            </button>
            {importOpen && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                {envHits.length === 0
                  ? <p style={{ ...hint, margin: 0 }}>{t('credentials.importNone')}</p>
                  : (
                    <>
                      {envHits.map((h) => (
                        <label key={h.serviceId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={selected.has(h.serviceId)} onChange={() => toggleSel(h.serviceId)} />
                          <span>{h.label} <span className="code-inline">{h.envVar}</span> <span style={hint}>{h.masked}</span></span>
                        </label>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <span style={lbl}>{t('credentials.importScope')}</span>
                        <select aria-label="Import scope" className="input" style={{ maxWidth: 200 }} value={importScope} onChange={(e) => setImportScope(e.target.value as 'sandbox' | 'global')}>
                          <option value="sandbox">{t('credentials.scopeSandbox')}</option>
                          <option value="global">{t('credentials.scopeGlobal')}</option>
                        </select>
                        <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={importSelected}>{t('credentials.importSelected')}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(new Set()); setImportOpen(false) }}>{t('credentials.importCancel')}</button>
                        <span style={hint}>{selected.size} {t('credentials.selected')}</span>
                      </div>
                    </>
                  )}
              </div>
            )}
          </div>

          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 320px' }}>
              <span style={lbl}>{t('credentials.service')}</span>
              <select aria-label="Service" className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {KNOWN_SERVICES.map((s) => (<option key={s.id} value={s.id}>{s.label} — {s.envVars.join(' / ')}</option>))}
              </select>
            </div>
            <div style={{ ...field, flex: '1 1 200px' }}>
              <span style={lbl}>{t('credentials.value')}</span>
              <input aria-label="Value" type="password" className="input" placeholder="sk-ant-········" value={svcValue} onChange={(e) => setSvcValue(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addService}>{t('credentials.add')}</button>
          </div>
          {selectedSvc && <p style={{ ...hint, marginTop: 0, marginBottom: 'var(--space-2)' }}>{selectedSvc.domains.join(', ')}</p>}
          <p style={sectionLbl}>{t('credentials.addedService')}</p>
          {services.length === 0
            ? <p style={hint}>{t('credentials.none')}</p>
            : services.map(({ c, i }) => (
              <div key={i} style={credRow}>
                <span>
                  <strong style={{ fontSize: 13 }}>{serviceById(c.serviceId)?.label ?? c.serviceId}</strong>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{c.envVar} = {!c.value.trim() && c.fromEnv ? t('credentials.fromEnv') : mask(c.value)}</span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-3)', flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => editService(c, i)}>{t('credentials.edit')}</button>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove" style={{ color: 'var(--danger)' }} onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
                </span>
              </div>
            ))}
        </>
      )}

      {tab === 'custom' && (
        <>
          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 180px' }}>
              <span style={lbl}>{t('credentials.host')}</span>
              <input aria-label="Host / Domain" className="input" placeholder="api.example.com" value={host} onChange={(e) => { setHost(e.target.value); setHostError(false) }} />
              {hostError && <span style={{ ...hint, color: 'var(--danger)' }}>{t('credentials.hostInvalid')}</span>}
            </div>
            <div style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>{t('credentials.envVar')}</span>
              <input aria-label="Environment Variable" className="input" placeholder="API_KEY" value={envVar} onChange={(e) => setEnvVar(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 140px' }}>
              <span style={lbl}>{t('credentials.value')}</span>
              <input aria-label="Value" type="password" className="input" placeholder="secret" value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addCustom}>{t('credentials.add')}</button>
          </div>
          <p style={hint}>{t('credentials.wildcardHint')}</p>
          <p style={sectionLbl}>{t('credentials.addedCustom')}</p>
          {customs.length === 0
            ? <p style={hint}>{t('credentials.none')}</p>
            : customs.map(({ c, i }) => (
              <div key={i} style={credRow}>
                <span>
                  <strong style={{ fontSize: 13 }}>{c.domains.join(', ')}</strong>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{c.envVar} = {mask(c.value)}</span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-3)', flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => editCustom(c, i)}>{t('credentials.edit')}</button>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove" style={{ color: 'var(--danger)' }} onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
                </span>
              </div>
            ))}
        </>
      )}

      {tab === 'registry' && (
        <>
          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 180px' }}>
              <span style={lbl}>{t('credentials.registryHost')}</span>
              <input aria-label="Registry Host" className="input" placeholder="ghcr.io" value={regHost} onChange={(e) => setRegHost(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 140px' }}>
              <span style={lbl}>{t('credentials.registryUser')}</span>
              <input aria-label="Username (optional)" className="input" placeholder="myuser" value={regUser} onChange={(e) => setRegUser(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>{t('credentials.registryToken')}</span>
              <input aria-label="Token / Password" type="password" className="input" placeholder="ghp_········" value={regToken} onChange={(e) => setRegToken(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>{t('credentials.registryScope')}</span>
              <select aria-label="Scope" className="input" value={regScope} onChange={(e) => setRegScope(e.target.value as RegistryScope)}>
                <option value="host">{t('credentials.scope.host')}</option>
                <option value="global">{t('credentials.scope.global')}</option>
                <option value="sandbox">{t('credentials.scope.sandbox')}</option>
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={addRegistry}>{t('credentials.add')}</button>
          </div>
          <p style={hint}>{t('credentials.registryScopeHint')}</p>
          <p style={sectionLbl}>{t('credentials.addedRegistry')}</p>
          {registries.length === 0
            ? <p style={hint}>{t('credentials.none')}</p>
            : registries.map(({ c, i }) => (
              <div key={i} style={credRow}>
                <span>
                  <strong style={{ fontSize: 13 }}>{c.host}</strong>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{t(`credentials.scope.${c.scope}`)} · {c.username.trim() ? c.username : t('credentials.registryTokenOnly')} · {mask(c.value)}</span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-3)', flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => editRegistry(c, i)}>{t('credentials.edit')}</button>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove" style={{ color: 'var(--danger)' }} onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
                </span>
              </div>
            ))}
        </>
      )}

      {tab === 'ssh' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-3) 0 4px' }}>
            <input type="checkbox" aria-label="Forward SSH Agent" checked={ssh.forwardAgent}
              onChange={(e) => onSshChange({ forwardAgent: e.target.checked, commitSigning: e.target.checked ? ssh.commitSigning : false })} />
            <strong style={{ fontSize: 13 }}>{t('credentials.sshForward')}</strong>
          </label>
          <p style={{ ...hint, margin: '0 0 2px 22px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: sshDetected ? 'var(--success, #3fb950)' : 'var(--text-muted)', display: 'inline-block' }} />
            {sshDetected ? t('credentials.sshDetected') : t('credentials.sshNotDetected')}
          </p>
          {/* Collapsible host-setup guide — copy-pasteable commands, per OS. Opens on the
              detected host but stays switchable, so a user can read another platform's steps. */}
          <div style={{ margin: '0 0 var(--space-3) 22px' }}>
            <button aria-expanded={sshHelpOpen} onClick={() => setSshHelpOpen((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span aria-hidden style={{ transform: sshHelpOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
              {t('credentials.sshHelpToggle')}
            </button>
            {sshHelpOpen && (
              <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
                <div role="tablist" aria-label="Host operating system" style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
                  <button role="tab" aria-selected={hostOs === 'mac'} style={credTabStyle(hostOs === 'mac')} onClick={() => setOsPick('mac')}>{t('credentials.sshHelpOsMac')}</button>
                  <button role="tab" aria-selected={hostOs === 'linux'} style={credTabStyle(hostOs === 'linux')} onClick={() => setOsPick('linux')}>{t('credentials.sshHelpOsLinux')}</button>
                  <button role="tab" aria-selected={hostOs === 'win'} style={credTabStyle(hostOs === 'win')} onClick={() => setOsPick('win')}>{t('credentials.sshHelpOsWin')}</button>
                </div>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('credentials.sshHelpHostLabel')}</p>

                {hostOs === 'mac' && (
                  <>
                    <p style={{ margin: '0 0 4px' }}>{t('credentials.sshHelpMacStep1')}</p>
                    <pre style={sshCode}>{SSH_SETUP.mac.load}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpMacStep2')}</p>
                    <pre style={sshCode}>{SSH_SETUP.mac.config}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpMacStep3')}</p>
                    <pre style={sshCode}>{SSH_SETUP.mac.verify}</pre>
                  </>
                )}

                {hostOs === 'linux' && (
                  <>
                    <p style={{ margin: '0 0 4px' }}>{t('credentials.sshHelpLinuxStep1')}</p>
                    <pre style={sshCode}>{SSH_SETUP.linux.check}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpLinuxStep2')}</p>
                    <pre style={sshCode}>{SSH_SETUP.linux.service}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpLinuxStep3')}</p>
                    <pre style={sshCode}>{SSH_SETUP.linux.config}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpLinuxStep4')}</p>
                    <pre style={sshCode}>{SSH_SETUP.linux.verify}</pre>
                    <p style={{ margin: '8px 0 0', fontStyle: 'italic' }}>{t('credentials.sshHelpLinuxNote')}</p>
                  </>
                )}

                {hostOs === 'win' && (
                  <>
                    <p style={{ margin: '0 0 8px' }}>{t('credentials.sshHelpWinIntro')}</p>
                    <p style={{ margin: '0 0 4px' }}>{t('credentials.sshHelpWinStep1')}</p>
                    <pre style={sshCode}>{SSH_SETUP.win.agent}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpWinStep2')}</p>
                    <pre style={sshCode}>{SSH_SETUP.win.key}</pre>
                    <p style={{ margin: '8px 0 4px' }}>{t('credentials.sshHelpWinStep3')}</p>
                    <pre style={sshCode}>{SSH_SETUP.win.verify}</pre>
                    <p style={{ margin: '8px 0 0', fontStyle: 'italic' }}>{t('credentials.sshHelpWinNote')}</p>
                  </>
                )}

                {hostOs !== 'win' && <p style={{ margin: '8px 0 0' }}>{t('credentials.sshHelpAfter')}</p>}
              </div>
            )}
          </div>
          <p style={{ ...hint, margin: '0 0 var(--space-3) 22px' }}>{t('credentials.sshForwardKeysHint')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-2) 0 4px' }}>
            <input type="checkbox" aria-label="Automatic Commit Signing" disabled={!ssh.forwardAgent} checked={ssh.commitSigning}
              onChange={(e) => onSshChange({ forwardAgent: ssh.forwardAgent, commitSigning: e.target.checked })} />
            <strong style={{ fontSize: 13, opacity: ssh.forwardAgent ? 1 : 0.5 }}>{t('credentials.sshCommitSigning')}</strong>
          </label>
          <p style={{ ...hint, margin: '0 0 var(--space-3) 22px' }}>{t('credentials.sshCommitSigningHint')}</p>
          <p style={{ ...hint, padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>{t('credentials.sshHowItWorks')}</p>
        </>
      )}

      {tab !== 'ssh' && (
        <div style={{ marginTop: 'var(--space-4)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>{t('credentials.securityLabel')}</strong> {t('credentials.securityNote')}
        </div>
      )}
    </>
  )
}
