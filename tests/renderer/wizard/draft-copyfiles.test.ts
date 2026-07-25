import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec } from '../../../src/renderer/wizard/draft'

describe('draft copyFiles', () => {
  it('adds a filled row and removes it', () => {
    let d = draftReducer(initialDraft, { type: 'addCopyFile', hostPath: '/a.sh', sandboxPath: '~/a.sh' })
    expect(d.copyFiles).toEqual([{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }])
    d = draftReducer(d, { type: 'addCopyFile', hostPath: '/b', sandboxPath: '~/b' })
    expect(d.copyFiles).toHaveLength(2)
    d = draftReducer(d, { type: 'removeCopyFile', index: 0 })
    expect(d.copyFiles).toEqual([{ hostPath: '/b', sandboxPath: '~/b' }])
  })
  it('toSpec drops blank rows and draftFromSpec round-trips', () => {
    let d = draftReducer(initialDraft, { type: 'setField', field: 'workspace', value: '/w' })
    d = { ...d, copyFiles: [{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }, { hostPath: '', sandboxPath: '' }] }
    const spec = toSpec(d, 'id1', 't')
    expect(spec.copyFiles).toEqual([{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }])
    expect(draftFromSpec(spec).copyFiles).toEqual([{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }])
  })
})
