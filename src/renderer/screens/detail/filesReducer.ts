import type { CopyDirection, FsEntry, ListResult, PlanResult, CopyResult } from '@shared/copy'

export interface FilesState {
  direction: CopyDirection
  sources: string[]
  dest: string
  typedSource: string
  browser: { cwd: string; entries: FsEntry[]; error: string | null; loading: boolean }
  plan: PlanResult | null
  confirmOpen: boolean
  results: CopyResult[] | null
  busy: boolean
}

export type FilesAction =
  | { type: 'setDirection'; direction: CopyDirection }
  | { type: 'setDest'; dest: string }
  | { type: 'setTypedSource'; value: string }
  | { type: 'addSources'; paths: string[] }
  | { type: 'removeSource'; path: string }
  | { type: 'browserLoading' }
  | { type: 'browserLoaded'; result: ListResult }
  | { type: 'setPlan'; plan: PlanResult; confirmOpen: boolean }
  | { type: 'closeConfirm' }
  | { type: 'setBusy'; busy: boolean }
  | { type: 'setResults'; results: CopyResult[] }

export const initialFilesState: FilesState = {
  direction: 'toSandbox',
  sources: [],
  dest: '',
  typedSource: '',
  browser: { cwd: '', entries: [], error: null, loading: false },
  plan: null,
  confirmOpen: false,
  results: null,
  busy: false
}

// Any edit to the source set or direction invalidates a computed plan/results so the user
// can never copy against a stale plan.
export function filesReducer(state: FilesState, action: FilesAction): FilesState {
  switch (action.type) {
    case 'setDirection':
      if (action.direction === state.direction) return state
      return { ...initialFilesState, direction: action.direction }
    case 'setDest':
      return { ...state, dest: action.dest, plan: null, results: null }
    case 'setTypedSource':
      return { ...state, typedSource: action.value }
    case 'addSources': {
      const sources = [...state.sources]
      for (const p of action.paths) if (p && !sources.includes(p)) sources.push(p)
      return { ...state, sources, plan: null, results: null }
    }
    case 'removeSource':
      return { ...state, sources: state.sources.filter((s) => s !== action.path), plan: null, results: null }
    case 'browserLoading':
      return { ...state, browser: { ...state.browser, loading: true, error: null } }
    case 'browserLoaded':
      return action.result.ok
        ? { ...state, browser: { cwd: action.result.cwd, entries: action.result.entries, error: null, loading: false } }
        : { ...state, browser: { ...state.browser, error: action.result.error, loading: false } }
    case 'setPlan':
      return { ...state, plan: action.plan, confirmOpen: action.confirmOpen, results: null }
    case 'closeConfirm':
      return { ...state, confirmOpen: false }
    case 'setBusy':
      return { ...state, busy: action.busy }
    case 'setResults':
      return { ...state, results: action.results, confirmOpen: false, busy: false }
    default:
      return state
  }
}
