import { useEffect, useState, useCallback } from 'react'
import type { PrereqResult, InstanceView, Definition } from '@shared/types'
import { api } from './ipc/client'
import { Prereq } from './screens/Prereq'
import { Instances } from './screens/Instances'
import { Definitions } from './screens/Definitions'
import { CreateDefinition } from './wizard/CreateDefinition'
import { NavShell } from './components/NavShell'

type Gate = { kind: 'loading' } | { kind: 'prereq'; result: PrereqResult } | { kind: 'ready' } | { kind: 'error'; message: string }
type Screen = 'definitions' | 'instances'

export default function App(): JSX.Element {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })
  const [screen, setScreen] = useState<Screen>('definitions')
  const [wizard, setWizard] = useState(false)
  const [defs, setDefs] = useState<Definition[]>([])
  const [instances, setInstances] = useState<InstanceView[]>([])

  const loadDefs = useCallback(async () => {
    const r = await api.defList()
    if (r.ok) setDefs(r.data)
  }, [])
  const loadInstances = useCallback(async () => {
    const r = await api.instancesList()
    if (r.ok) setInstances(r.data)
  }, [])

  const runGate = useCallback(async () => {
    setGate({ kind: 'loading' })
    const pre = await api.prereqCheck()
    if (!pre.ok) return setGate({ kind: 'error', message: pre.error.message })
    if (!pre.data.ok) return setGate({ kind: 'prereq', result: pre.data })
    setGate({ kind: 'ready' })
    await loadDefs()
  }, [loadDefs])

  useEffect(() => { void runGate() }, [runGate])

  function navigate(s: Screen): void {
    setWizard(false)
    setScreen(s)
    if (s === 'definitions') void loadDefs()
    else void loadInstances()
  }

  if (gate.kind === 'loading') return <p style={{ padding: 16 }}>Loading…</p>
  if (gate.kind === 'error') return <p style={{ padding: 16, color: 'var(--danger)' }}>Error: {gate.message}</p>
  if (gate.kind === 'prereq') return <Prereq result={gate.result} onRecheck={() => void runGate()} />

  return (
    <NavShell active={screen} onNavigate={navigate}>
      {wizard ? (
        <CreateDefinition
          onDone={() => { setWizard(false); void loadDefs() }}
          onCancel={() => setWizard(false)}
        />
      ) : screen === 'definitions' ? (
        <Definitions definitions={defs} onCreate={() => setWizard(true)} />
      ) : (
        <Instances instances={instances} />
      )}
    </NavShell>
  )
}
