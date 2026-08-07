import { useEffect, useReducer, useRef } from 'react'
import type { CopyDirection, ListResult, PlanResult, CopyResult } from '@shared/copy'
import { posixJoin } from '@shared/copy'
import { useT } from '../../i18n'
import { ConfirmModal } from '../../components/ConfirmModal'
import { filesReducer, initialFilesState } from './filesReducer'

interface FilesTabProps {
  running: boolean
  hostDir: string
  sandboxDir: string
  onSetHostDir: (v: string) => void
  onSetSandboxDir: (v: string) => void
  listDir: (path: string) => Promise<ListResult | null>
  plan: (direction: CopyDirection, sources: string[], dest: string) => Promise<PlanResult | null>
  copy: (direction: CopyDirection, sources: string[], dest: string) => Promise<CopyResult[] | null>
  pickPaths: (mode: 'files' | 'folder') => Promise<string[]>
  pickFolder: () => Promise<string | null>
}

/**
 * Files tab: copy files/folders between host and a running sandbox in both directions,
 * wrapping `sbx cp`. The host side uses native OS pickers; the sandbox side is a navigable
 * `ls`-backed browser. Overwrites are detected via a plan step and confirmed before copying.
 * Requires a running instance (mirrors the Monitoring resource card's gate).
 */
export function FilesTab(props: FilesTabProps): JSX.Element {
  const { running, hostDir, sandboxDir, onSetHostDir, onSetSandboxDir } = props
  const t = useT()
  const [state, dispatch] = useReducer(filesReducer, initialFilesState)
  const { direction, sources, dest, browser } = state
  const toSandbox = direction === 'toSandbox'
  // The destination side's configured default dir; used as the destination when the user
  // hasn't picked/typed one, so a configured default is enough to enable Copy.
  const destDefault = toSandbox ? sandboxDir : hostDir
  const effectiveDest = dest.trim() || destDefault.trim()

  // Load the sandbox browser at the default dir whenever it becomes relevant. Skip while the
  // sandbox default dir is still empty (e.g. before prefs load) — listing '' just errors.
  useEffect(() => {
    if (!running || !sandboxDir.trim()) return
    void loadDir(sandboxDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, direction, sandboxDir])

  // Monotonic token so a slow/stale listDir response can never overwrite a newer one — the
  // mount-time load and a later prefs-driven load would otherwise race and the loser (often an
  // empty-path error) could clobber the good listing.
  const loadSeq = useRef(0)
  async function loadDir(path: string): Promise<void> {
    const seq = ++loadSeq.current
    dispatch({ type: 'browserLoading' })
    const r = await props.listDir(path)
    if (seq !== loadSeq.current) return // superseded by a newer load
    if (r) dispatch({ type: 'browserLoaded', result: r })
    else dispatch({ type: 'browserLoaded', result: { ok: false, error: 'IPC unavailable' } })
  }

  async function addFiles(mode: 'files' | 'folder'): Promise<void> {
    const picked = await props.pickPaths(mode)
    if (picked.length) dispatch({ type: 'addSources', paths: picked })
  }

  function addTypedSource(): void {
    const v = state.typedSource.trim()
    if (!v) return
    dispatch({ type: 'addSources', paths: [v] })
    dispatch({ type: 'setTypedSource', value: '' })
  }

  async function onCopy(): Promise<void> {
    if (!sources.length || !effectiveDest) return
    dispatch({ type: 'setBusy', busy: true })
    const p = await props.plan(direction, sources, effectiveDest)
    dispatch({ type: 'setBusy', busy: false })
    if (!p) return
    const hasOverwrite = p.items.some((it) => it.willOverwrite)
    dispatch({ type: 'setPlan', plan: p, confirmOpen: hasOverwrite })
    if (!hasOverwrite) await runCopy(p)
  }

  async function runCopy(p: PlanResult): Promise<void> {
    dispatch({ type: 'closeConfirm' })
    dispatch({ type: 'setBusy', busy: true })
    const results = await props.copy(direction, p.items.map((it) => it.resolvedSource), p.resolvedDest)
    dispatch({ type: 'setResults', results: results ?? [] })
  }

  const overwriteCount = state.plan?.items.filter((it) => it.willOverwrite).length ?? 0

  return (
    <div>
      {/* Direction toggle */}
      <div role="tablist" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <button className={`btn btn-sm ${toSandbox ? 'btn-primary' : 'btn-secondary'}`} onClick={() => dispatch({ type: 'setDirection', direction: 'toSandbox' })}>{t('detail.filesToSandbox')}</button>
        <button className={`btn btn-sm ${!toSandbox ? 'btn-primary' : 'btn-secondary'}`} onClick={() => dispatch({ type: 'setDirection', direction: 'fromSandbox' })}>{t('detail.filesFromSandbox')}</button>
      </div>

      {!running && <p className="section-desc" style={{ fontSize: 12 }}>{t('detail.filesRunningHint')}</p>}

      {/* Default directories — host + sandbox share one row (and both directions); wraps when narrow */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="field-label">{t('detail.filesHostDir')}</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input className="input" style={{ flex: 1, minWidth: 0 }} value={hostDir} onChange={(e) => onSetHostDir(e.target.value)} />
              <button className="btn btn-secondary btn-sm" onClick={async () => { const d = await props.pickFolder(); if (d) onSetHostDir(d) }}>{t('detail.filesBrowse')}</button>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="field-label">{t('detail.filesSandboxDir')}</label>
            <input className="input" style={{ width: '100%' }} value={sandboxDir} onChange={(e) => onSetSandboxDir(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Sources — title + add controls collapsed onto one wrapping row to save space */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: sources.length ? 'var(--space-2)' : 0 }}>
          <span className="card-title">{t('detail.filesSources')}</span>
          {toSandbox && <>
            <button className="btn btn-secondary btn-sm" disabled={!running} onClick={() => void addFiles('files')}>{t('detail.filesAddFiles')}</button>
            <button className="btn btn-secondary btn-sm" disabled={!running} onClick={() => void addFiles('folder')}>{t('detail.filesAddFolder')}</button>
          </>}
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder={t('detail.filesSourcePlaceholder')} value={state.typedSource}
            onChange={(e) => dispatch({ type: 'setTypedSource', value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') addTypedSource() }} />
          <button className="btn btn-secondary btn-sm" disabled={!running} onClick={addTypedSource}>{t('detail.filesAddPath')}</button>
        </div>
        {sources.length === 0
          ? <p className="section-desc" style={{ fontSize: 12, margin: 0 }}>{t('detail.filesNoSources')}</p>
          : sources.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '3px 0', fontSize: 13 }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s}>{s}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'removeSource', path: s })}>{t('detail.filesRemove')}</button>
            </div>
          ))}
      </div>

      {/* Sandbox browser — used to pick the destination dir (toSandbox) or sources (fromSandbox) */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, flex: 1 }}>
            <span className="card-title" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{browser.cwd || sandboxDir}</span>
            {browser.loading && <span className="spinner" role="status" aria-label={t('detail.filesLoading')} />}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" disabled={!running || !browser.cwd} onClick={() => void loadDir(browser.cwd ? posixJoin(browser.cwd, '..') : sandboxDir)}>{t('detail.filesUp')}</button>
            <button className="btn btn-ghost btn-sm" disabled={!running} onClick={() => void loadDir(browser.cwd || sandboxDir)}>{t('detail.filesRefresh')}</button>
          </div>
        </div>
        {browser.error && <p className="section-desc" style={{ fontSize: 12, color: 'var(--danger)' }}>{t('detail.filesBrowserError', { error: browser.error })}</p>}
        {!browser.error && browser.entries.length === 0 && !browser.loading && <p className="section-desc" style={{ fontSize: 12 }}>{t('detail.filesEmptyDir')}</p>}
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {browser.entries.map((e) => {
            const full = posixJoin(browser.cwd, e.name)
            return (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '3px 0', fontSize: 13 }}>
                {!toSandbox && !e.isDir && (
                  <input type="checkbox" checked={sources.includes(full)}
                    onChange={(ev) => dispatch(ev.target.checked ? { type: 'addSources', paths: [full] } : { type: 'removeSource', path: full })} />
                )}
                <span style={{ flex: 1, cursor: e.isDir ? 'pointer' : 'default', fontFamily: 'var(--font-mono, monospace)' }}
                  onClick={() => { if (e.isDir) void loadDir(full) }}>
                  {e.isDir ? `📁 ${e.name}/` : `📄 ${e.name}`}
                </span>
                {toSandbox && e.isDir && (
                  <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'setDest', dest: full })}>→ {t('detail.filesDestination')}</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Destination + Copy */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <input className="input" style={{ flex: 1 }} placeholder={destDefault.trim() || t('detail.filesDestPlaceholder')} aria-label={t('detail.filesDestination')} value={dest}
          onChange={(e) => dispatch({ type: 'setDest', dest: e.target.value })} />
        {!toSandbox && <button className="btn btn-secondary btn-sm" onClick={async () => { const d = await props.pickFolder(); if (d) dispatch({ type: 'setDest', dest: d }) }}>{t('detail.filesBrowse')}</button>}
        <button className="btn btn-primary btn-sm" disabled={!running || state.busy || sources.length === 0 || !effectiveDest} onClick={() => void onCopy()}>
          {state.busy ? t('detail.filesCopying') : t('detail.filesCopy')}
        </button>
      </div>

      {/* Results */}
      {state.results && (
        <div className="card">
          {state.results.map((r) => (
            <div key={r.source} style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 13, padding: '2px 0' }}>
              <span className={r.ok ? 'traffic-allowed' : 'traffic-blocked'}>{r.ok ? '✓' : '✕'}</span>
              <span style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.source}>{r.source}</span>
              <span style={{ color: 'var(--text-muted)' }}>{r.ok ? t('detail.filesResultOk') : `${t('detail.filesResultFailed')}: ${r.error ?? ''}`}</span>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={state.confirmOpen}
        title={t('detail.filesConfirmTitle')}
        body={t('detail.filesConfirmBody', { count: overwriteCount })}
        confirmLabel={t('detail.filesConfirmOverwrite')}
        cancelLabel={t('detail.filesCancel')}
        onCancel={() => dispatch({ type: 'closeConfirm' })}
        onConfirm={() => { if (state.plan) void runCopy(state.plan) }}
      />
    </div>
  )
}
