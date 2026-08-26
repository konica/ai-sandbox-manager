import { useState } from 'react'
import type { InstanceView, DefinitionSpec, CredentialRef } from '@shared/types'
import { serviceById } from '@shared/services'
import { TierBadge } from '../../components/badges'
import { useT } from '../../i18n'

const MASK = '••••••••'

function credName(c: CredentialRef): string {
  if (c.kind === 'service') return serviceById(c.serviceId)?.label ?? c.serviceId
  if (c.kind === 'registry') return c.host
  return c.domains[0] ?? c.label
}

/**
 * Terminals tab: native Terminal.app launch buttons (Agent/Shell) + a read-only info
 * sidebar (Network Policy, Credentials, Mounts) sourced from the definition spec.
 * No in-app terminals — matches the app's native-terminal architecture.
 */
export function TerminalsTab({ instance, spec, hasVSCode, agentCommand, shellCommand, onAttach, onShell, onAllowDomain, onDenyDomain }: {
  instance: InstanceView
  spec: DefinitionSpec | null
  hasVSCode: boolean
  agentCommand?: string
  shellCommand?: string
  onAttach: (name: string, opener: 'terminal' | 'vscode') => void
  onShell: (name: string) => void
  onAllowDomain?: (domain: string) => void
  onDenyDomain?: (domain: string) => void
}): JSX.Element {
  const t = useT()
  const running = instance.status === 'running'
  const [domainInput, setDomainInput] = useState('')
  const [copied, setCopied] = useState<'agent' | 'shell' | null>(null)

  function copy(which: 'agent' | 'shell', cmd: string): void {
    void navigator.clipboard?.writeText(cmd)
    setCopied(which)
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500)
  }
  const editable = onAllowDomain !== undefined && onDenyDomain !== undefined
  // VS Code is opened on a host folder resolved from the definition's primary mount (see the
  // vscode opener in ipc.ts). An instance with no linked definition — or one whose definition
  // has no mount — has no folder to open, so the VS Code button must not be offered.
  const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
  const vscodeDisabledReason = !hasVSCode ? t('launch.openVSCodeUnavailable')
    : !workspaceDir ? t('detail.openVSCodeNoWorkspace')
    : undefined
  const services = spec?.credentials.filter((c) => c.kind === 'service') ?? []
  const customs = spec?.credentials.filter((c) => c.kind === 'custom') ?? []
  const registries = spec?.credentials.filter((c) => c.kind === 'registry') ?? []

  function addDomain(): void {
    const d = domainInput.trim()
    if (d) { onAllowDomain?.(d); setDomainInput('') }
  }

  return (
    <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--space-5)', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div className="card">
          <div className="card-header"><div className="card-title">{t('detail.terminals')}</div></div>
          <p className="section-desc" style={{ marginTop: 0 }}>{t('detail.nativeNote')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            {/* Agent uses `sbx run --name … -- <agent resumeArgs>`, which starts a stopped sandbox → always enabled.
                Two openers: native Terminal.app, or VS Code (folder + integrated terminal). */}
            <button className="btn btn-primary btn-sm" onClick={() => onAttach(instance.name, 'terminal')}>{running ? t('detail.openAgentTerminal') : t('detail.startAgentTerminal')}</button>
            <button className="btn btn-primary btn-sm" disabled={vscodeDisabledReason !== undefined} title={vscodeDisabledReason} onClick={() => onAttach(instance.name, 'vscode')}>{running ? t('detail.openAgentVSCode') : t('detail.startAgentVSCode')}</button>
            {/* Shell uses `sbx exec`, which needs a running VM → disabled until running. */}
            <button className="btn btn-secondary btn-sm" disabled={!running} onClick={() => onShell(instance.name)}>{t('detail.openShell')}</button>
          </div>
          {!running && <p className="section-desc" style={{ fontSize: 11, margin: 'var(--space-2) 0 0' }}>{t('detail.stoppedHint')}</p>}
          {/* Copy the exact sbx command to run the agent / shell manually in your own terminal. */}
          {(agentCommand || shellCommand) && (
            <>
              <p className="section-desc" style={{ fontSize: 11, margin: 'var(--space-3) 0 var(--space-2)' }}>{t('detail.copyManualHint')}</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {agentCommand && <button className="btn btn-ghost btn-sm" title={agentCommand} onClick={() => copy('agent', agentCommand)}>{copied === 'agent' ? t('detail.copied') : t('detail.copyAgentCmd')}</button>}
                {shellCommand && <button className="btn btn-ghost btn-sm" title={shellCommand} onClick={() => copy('shell', shellCommand)}>{copied === 'shell' ? t('detail.copied') : t('detail.copyShellCmd')}</button>}
              </div>
            </>
          )}
        </div>

        {spec && (
          <div className="card">
            <div className="card-header"><div className="card-title">{t('detail.mounts')}</div></div>
            {spec.mounts.map((m, i) => (
              <div key={i} className="mount-row">
                <span className="mount-path">{m.hostPath}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.mode === 'clone' ? `${m.mode} (${t('detail.readonly')})` : m.mode}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {!spec ? (
          <div className="card"><p className="section-desc" style={{ margin: 0 }}>{t('detail.noDefinition')}</p></div>
        ) : (
          <>
            <div className="card">
              <div className="card-header"><div className="card-title">{t('detail.networkPolicy')}</div></div>
              <div style={{ marginBottom: 'var(--space-3)' }}><TierBadge tier={spec.definition.tier} /></div>
              {spec.domains.length === 0
                ? <p className="section-desc" style={{ margin: 0, fontSize: 12 }}>—</p>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>{spec.domains.map((d) => (
                  <span key={d} className="tag">{d}{editable && <button className="tag-remove" aria-label={`Deny ${d}`} onClick={() => onDenyDomain?.(d)}>✕</button>}</span>
                ))}</div>}
              {editable && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  <input aria-label="Add domain" className="input input-mono" style={{ flex: 1, fontSize: 12 }} placeholder={t('detail.domainPlaceholder')} value={domainInput} onChange={(e) => setDomainInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addDomain() }} />
                  <button className="btn btn-secondary btn-sm" onClick={addDomain}>{t('detail.allow')}</button>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">{t('detail.credentials')}</div></div>
              {spec.credentials.length === 0 && <p className="section-desc" style={{ margin: 0, fontSize: 12 }}>—</p>}
              {services.length > 0 && (
                <div className="cred-type-group">
                  <div className="cred-type-label">{t('credentials.tabService')}</div>
                  {services.map((c, i) => (<div key={i} className="secret-row" style={{ background: 'transparent', border: 'none', padding: '2px 0' }}><div className="secret-info"><span className="secret-name">{credName(c)}</span><span className="secret-value">{(c as { envVar: string }).envVar} = {MASK}</span></div></div>))}
                </div>
              )}
              {customs.length > 0 && (
                <div className="cred-type-group">
                  <div className="cred-type-label">{t('credentials.tabCustom')}</div>
                  {customs.map((c, i) => (<div key={i} className="secret-row" style={{ background: 'transparent', border: 'none', padding: '2px 0' }}><div className="secret-info"><span className="secret-name">{credName(c)}</span><span className="secret-value">{(c as { envVar: string }).envVar} = {MASK}</span></div></div>))}
                </div>
              )}
              {registries.length > 0 && (
                <div className="cred-type-group">
                  <div className="cred-type-label">{t('credentials.tabRegistry')}</div>
                  {registries.map((c, i) => c.kind === 'registry' && (<div key={i} className="secret-row" style={{ background: 'transparent', border: 'none', padding: '2px 0' }}><div className="secret-info"><span className="secret-name">{credName(c)}</span><span className="secret-value">{t(`credentials.scope.${c.scope}`)} · token = {MASK}</span></div></div>))}
                </div>
              )}
              <div className="cred-type-group">
                <div className="cred-type-label">{t('detail.sshAgent')}</div>
                <div className="secret-row" style={{ background: 'transparent', border: 'none', padding: '2px 0' }}>
                  <div className="secret-info"><span className="secret-value">
                    {(spec.ssh?.forwardAgent ?? true) ? t('wizard.sshForwarded') : t('wizard.sshOff')}{spec.ssh?.commitSigning ? ` · ${t('credentials.sshCommitSigning')}` : ''}
                  </span></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
