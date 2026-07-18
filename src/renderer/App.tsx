import { useEffect, useState } from 'react'
import type { PrereqResult, InstanceView } from '@shared/types'
import { api } from './ipc/client'
import { Prereq } from './screens/Prereq'
import { Instances } from './screens/Instances'

type View =
  | { kind: 'loading' }
  | { kind: 'prereq'; result: PrereqResult }
  | { kind: 'instances'; rows: InstanceView[] }
  | { kind: 'error'; message: string }

export default function App(): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' })

  async function load(): Promise<void> {
    setView({ kind: 'loading' })
    const pre = await api.prereqCheck()
    if (!pre.ok) return setView({ kind: 'error', message: pre.error.message })
    if (!pre.data.ok) return setView({ kind: 'prereq', result: pre.data })
    const list = await api.instancesList()
    if (!list.ok) return setView({ kind: 'error', message: list.error.message })
    setView({ kind: 'instances', rows: list.data })
  }

  useEffect(() => { void load() }, [])

  if (view.kind === 'loading') return <p style={{ padding: 16 }}>Loading…</p>
  if (view.kind === 'error') return <p style={{ padding: 16, color: 'var(--danger)' }}>Error: {view.message}</p>
  if (view.kind === 'prereq') return <Prereq result={view.result} onRecheck={() => void load()} />
  return <Instances instances={view.rows} />
}
