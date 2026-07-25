import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec } from '../../../src/renderer/wizard/draft'

describe('draft copyFiles', () => {
  it('adds, edits, and removes rows', () => {
    let d = draftReducer(initialDraft, { type: 'addCopyFile' })
    expect(d.copyFiles).toEqual([{ hostPath: '', sandboxPath: '' }])
    d = draftReducer(d, { type: 'setCopyFilePath', index: 0, field: 'hostPath', value: '/a.sh' })
    d = draftReducer(d, { type: 'setCopyFilePath', index: 0, field: 'sandboxPath', value: '~/a.sh' })
    expect(d.copyFiles[0]).toEqual({ hostPath: '/a.sh', sandboxPath: '~/a.sh' })
    d = draftReducer(d, { type: 'removeCopyFile', index: 0 })
    expect(d.copyFiles).toEqual([])
  })
  it('toSpec drops blank rows and draftFromSpec round-trips', () => {
    let d = draftReducer(initialDraft, { type: 'setField', field: 'workspace', value: '/w' })
    d = { ...d, copyFiles: [{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }, { hostPath: '', sandboxPath: '' }] }
    const spec = toSpec(d, 'id1', 't')
    expect(spec.copyFiles).toEqual([{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }])
    expect(draftFromSpec(spec).copyFiles).toEqual([{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }])
  })
})
