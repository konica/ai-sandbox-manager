import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec } from '../../../src/renderer/wizard/draft'

const base = { ...initialDraft, workspace: '/p', name: 'p' }

describe('draft ssh', () => {
  it('defaults to forward on, signing off', () => {
    expect(base.sshForwardAgent).toBe(true)
    expect(base.sshCommitSigning).toBe(false)
    const spec = toSpec(base, 'id1', 't')
    expect(spec.ssh).toEqual({ forwardAgent: true, commitSigning: false })
  })
  it('sets forward and signing flags', () => {
    let d = draftReducer(base, { type: 'setSshCommitSigning', value: true })
    expect(d.sshCommitSigning).toBe(true)
    d = draftReducer(d, { type: 'setSshForward', value: false })
    expect(d.sshForwardAgent).toBe(false)
  })
  it('turning forward off forces signing off in the reducer', () => {
    let d = draftReducer(base, { type: 'setSshCommitSigning', value: true })
    d = draftReducer(d, { type: 'setSshForward', value: false })
    expect(d.sshCommitSigning).toBe(false)
  })
  it('toSpec never emits signing:true when forward is off (defensive)', () => {
    const d = { ...base, sshForwardAgent: false, sshCommitSigning: true }
    expect(toSpec(d, 'id1', 't').ssh).toEqual({ forwardAgent: false, commitSigning: false })
  })
  it('round-trips through draftFromSpec', () => {
    const spec = toSpec({ ...base, sshCommitSigning: true }, 'id1', 't')
    const d2 = draftFromSpec(spec)
    expect(d2.sshForwardAgent).toBe(true)
    expect(d2.sshCommitSigning).toBe(true)
  })
})
