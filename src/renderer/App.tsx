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
    const r = await api.instanceLaunch(definitionId)
    if (r.ok) { setScreen('instances'); await loadInstances() }
  }
  async function refreshAfter(p: Promise<unknown>): Promise<void> { await p; await loadInstances() }
  function onAttach(name: string): void { void api.instanceAttach(name) }
  function onShell(name: string): void { void api.instanceShell(name) }
  function onStop(name: string): void { void refreshAfter(api.instanceStop(name)) }
  function onRemoveConfirmed(): void {
    const name = pendingRemove
    setPendingRemove(null)
    if (name) void refreshAfter(api.instanceRemove(name))
  }

  if (phase.kind === 'loading') return <p style={{ padding: 'var(--space-6)' }}>Loading…</p>
  if (phase.kind === 'error') return <p style={{ padding: 'var(--space-6)', color: 'var(--danger)' }}>Error: {phase.message}</p>

  return (
    <AppShell active={screen} onNavigate={navigate} defCount={defs.length} instanceCount={instances.length}>
      {screen === 'prereq' && (
        <Prereq result={phase.prereq} onRecheck={() => void runGate()} onContinue={() => setScreen('definitions')} />
      )}
      {screen === 'definitions' && (
        wizard
          ? <CreateDefinition onDone={() => { setWizard(false); void loadDefs() }} onCancel={() => setWizard(false)} />
          : <Definitions definitions={defs} onCreate={() => setWizard(true)} onLaunch={(id) => void onLaunch(id)} />
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
