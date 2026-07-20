import { useEffect, useState, useCallback } from 'react'
import type { PrereqResult, InstanceView, Definition, DefinitionSpec } from '@shared/types'
import { api } from './ipc/client'
import { Prereq } from './screens/Prereq'
import { Instances } from './screens/Instances'
import { InstanceDetail } from './screens/InstanceDetail'
import { Definitions } from './screens/Definitions'
import { Settings } from './screens/Settings'
import { CreateDefinition } from './wizard/CreateDefinition'
import { AppShell, type NavScreen } from './components/AppShell'
import { ConfirmModal } from './components/ConfirmModal'
import { LaunchDialog } from './components/LaunchDialog'
import { AuthNudge } from './components/AuthNudge'
import { useT } from './i18n'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; prereq: PrereqResult }

export default function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [screen, setScreen] = useState<NavScreen>('prereq')
  const [wizard, setWizard] = useState<{ spec?: DefinitionSpec } | null>(null)
  const [defs, setDefs] = useState<Definition[]>([])
  const [instances, setInstances] = useState<InstanceView[]>([])
  const [pending, setPending] = useState<{ kind: 'stop' | 'remove'; name: string } | null>(null)
  const [launchFor, setLaunchFor] = useState<Definition | null>(null)
  const [nudgeFor, setNudgeFor] = useState<Definition | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const t = useT()

  const loadDefs = useCallback(async () => {
    const r = await api.defList()
    if (r.ok) setDefs(r.data)
  }, [])
  const loadInstances = useCallback(async () => {
    const r = await api.instancesList()
    if (r.ok) setInstances(r.data)
  }, [])

  const runGate = useCallback(async () => {
    setPhase({ kind: 'loading' })
    const pre = await api.prereqCheck()
    if (!pre.ok) return setPhase({ kind: 'error', message: pre.error.message })
    setPhase({ kind: 'ready', prereq: pre.data })
    setScreen(pre.data.ok ? 'definitions' : 'prereq')
    await Promise.all([loadDefs(), loadInstances()])
  }, [loadDefs, loadInstances])

  useEffect(() => { void runGate() }, [runGate])

  // Poll instances while viewing them so status changes (e.g. a sandbox finishing
  // provisioning → running) surface in the list and the detail view without a manual refresh.
  useEffect(() => {
    if (screen !== 'instances') return
    const id = setInterval(() => void loadInstances(), 4000)
    return () => clearInterval(id)
  }, [screen, loadInstances])

  function navigate(s: NavScreen): void {
    setWizard(null)
    setDetailName(null)
    setScreen(s)
    if (s === 'definitions') void loadDefs()
    else if (s === 'instances') void loadInstances()
  }

  async function openEditor(definitionId: string): Promise<void> {
    setNotice(null)
    const r = await api.defGetSpec(definitionId)
    if (r.ok && r.data) setWizard({ spec: r.data })
    else if (r.ok) setNotice({ kind: 'error', text: t('instances.actionFailed', { message: 'Definition not found' }) })
    else setNotice({ kind: 'error', text: t('instances.actionFailed', { message: r.error.message }) })
  }

  async function openLaunchDialog(definitionId: string): Promise<void> {
    const def = defs.find((d) => d.id === definitionId)
    if (!def) return
    setNotice(null)
    // Nudge a host-side OAuth sign-in when Claude has no credential (non-blocking).
    const pre = await api.authLaunchPrecheck(def.id)
    if (pre.ok && pre.data.needsNudge) { setNudgeFor(def); return }
    setLaunchFor(def)
    void loadInstances() // refresh existing sandbox names for the dialog
  }

  async function submitLaunch(definition: Definition, sessionName: string): Promise<void> {
    setLaunchFor(null)
    setNotice(null)
    setBusyId(definition.id)
    try {
      const r = await api.instanceLaunch(definition.id, undefined, sessionName)
      if (r.ok) {
        setNotice({ kind: 'info', text: t('instances.launched', { name: r.data.name }) })
        setScreen('instances')
        await loadInstances()
      } else {
        setNotice({ kind: 'error', text: t('instances.actionFailed', { message: r.error.message }) })
      }
    } finally {
      setBusyId(null)
    }
  }
  async function runAction(p: Promise<{ ok: boolean; error?: { message: string } }>): Promise<void> {
    const r = await p
    if (!r.ok && r.error) setNotice({ kind: 'error', text: t('instances.actionFailed', { message: r.error.message }) })
    await loadInstances()
  }
  function onAttach(name: string): void { void runAction(api.instanceAttach(name)) }
  function onShell(name: string): void { void runAction(api.instanceShell(name)) }
  function onConfirmPending(): void {
    const p = pending
    setPending(null)
    if (!p) return
    void runAction(p.kind === 'stop' ? api.instanceStop(p.name) : api.instanceRemove(p.name))
  }

  if (phase.kind === 'loading') return <p style={{ padding: 'var(--space-6)' }}>Loading…</p>
  if (phase.kind === 'error') return <p style={{ padding: 'var(--space-6)', color: 'var(--danger)' }}>Error: {phase.message}</p>

  return (
    <AppShell active={screen} onNavigate={navigate} defCount={defs.length} instanceCount={instances.length}>
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)',
            borderColor: notice.kind === 'error' ? 'var(--danger)' : 'var(--border-hover)',
            color: notice.kind === 'error' ? 'var(--danger)' : 'var(--text-secondary)'
          }}
        >
          <span style={{ fontSize: 13 }}>{notice.text}</span>
          <button className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
      {screen === 'prereq' && (
        <Prereq result={phase.prereq} onRecheck={() => void runGate()} onContinue={() => setScreen('definitions')} />
      )}
      {screen === 'definitions' && (
        wizard
          ? <CreateDefinition initial={wizard.spec} onDone={() => { setWizard(null); void loadDefs() }} onCancel={() => setWizard(null)} />
          : <Definitions definitions={defs} onCreate={() => setWizard({})} onLaunch={(id) => void openLaunchDialog(id)} onEdit={(id) => void openEditor(id)} launchingId={busyId} />
      )}
      {screen === 'instances' && (() => {
        const detail = detailName ? instances.find((i) => i.name === detailName) : null
        return detail ? (
          <InstanceDetail
            instance={detail}
            onBack={() => setDetailName(null)}
            onAttach={onAttach}
            onShell={onShell}
            onStop={(name) => setPending({ kind: 'stop', name })}
            onRemove={(name) => setPending({ kind: 'remove', name })}
          />
        ) : (
          <Instances
            instances={instances}
            onOpen={setDetailName}
            onAttach={onAttach}
            onShell={onShell}
            onStop={(name) => setPending({ kind: 'stop', name })}
            onRemove={(name) => setPending({ kind: 'remove', name })}
          />
        )
      })()}
      {screen === 'settings' && <Settings />}
      <ConfirmModal
        open={pending !== null}
        title={pending?.kind === 'stop' ? t('instances.stopTitle') : t('instances.removeTitle')}
        body={
          pending?.kind === 'stop'
            ? t('instances.stopBody', { name: pending.name })
            : t('instances.removeBody', { name: pending?.name ?? '' })
        }
        confirmLabel={pending?.kind === 'stop' ? t('instances.confirmStop') : t('instances.confirmRemove')}
        cancelLabel={t('instances.cancel')}
        destructive={pending?.kind !== 'stop'}
        onConfirm={onConfirmPending}
        onCancel={() => setPending(null)}
      />
      {launchFor && (
        <LaunchDialog
          definition={launchFor}
          onLaunch={(session) => void submitLaunch(launchFor, session)}
          onCancel={() => setLaunchFor(null)}
        />
      )}
      {nudgeFor && (
        <AuthNudge
          definition={nudgeFor}
          onProceed={() => { const d = nudgeFor; setNudgeFor(null); setLaunchFor(d); void loadInstances() }}
          onSignIn={() => { setNudgeFor(null); void api.authStartLogin() }}
          onUseKey={() => { const d = nudgeFor; setNudgeFor(null); void openEditor(d.id) }}
          onCancel={() => setNudgeFor(null)}
        />
      )}
    </AppShell>
  )
}
