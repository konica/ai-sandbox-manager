import { useEffect, useState, useCallback } from 'react'
import type { PrereqResult, InstanceView, Definition } from '@shared/types'
import { api } from './ipc/client'
import { Prereq } from './screens/Prereq'
import { Instances } from './screens/Instances'
import { Definitions } from './screens/Definitions'
import { Settings } from './screens/Settings'
import { CreateDefinition } from './wizard/CreateDefinition'
import { AppShell, type NavScreen } from './components/AppShell'
import { ConfirmModal } from './components/ConfirmModal'
import { useT } from './i18n'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; prereq: PrereqResult }

export default function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [screen, setScreen] = useState<NavScreen>('prereq')
  const [wizard, setWizard] = useState(false)
  const [defs, setDefs] = useState<Definition[]>([])
  const [instances, setInstances] = useState<InstanceView[]>([])
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
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

  function navigate(s: NavScreen): void {
    setWizard(false)
    setScreen(s)
    if (s === 'definitions') void loadDefs()
    else if (s === 'instances') void loadInstances()
  }

  async function onLaunch(definitionId: string): Promise<void> {
    setNotice(null)
    setBusyId(definitionId)
    try {
      const r = await api.instanceLaunch(definitionId)
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
  function onStop(name: string): void { void runAction(api.instanceStop(name)) }
  function onRemoveConfirmed(): void {
    const name = pendingRemove
    setPendingRemove(null)
    if (name) void runAction(api.instanceRemove(name))
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
          ? <CreateDefinition onDone={() => { setWizard(false); void loadDefs() }} onCancel={() => setWizard(false)} />
          : <Definitions definitions={defs} onCreate={() => setWizard(true)} onLaunch={(id) => void onLaunch(id)} launchingId={busyId} />
      )}
      {screen === 'instances' && (
        <Instances instances={instances} onAttach={onAttach} onShell={onShell} onStop={onStop} onRemove={(name) => setPendingRemove(name)} />
      )}
      {screen === 'settings' && <Settings />}
      <ConfirmModal
        open={pendingRemove !== null}
        title={t('instances.removeTitle')}
        body={t('instances.removeBody', { name: pendingRemove ?? '' })}
        confirmLabel={t('instances.confirmRemove')}
        cancelLabel={t('instances.cancel')}
        onConfirm={onRemoveConfirmed}
        onCancel={() => setPendingRemove(null)}
      />
    </AppShell>
  )
}
