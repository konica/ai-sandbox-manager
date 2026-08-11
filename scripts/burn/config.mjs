// Configuration for the agent burn queue. Every key is optional; a repository
// that copies these files and creates the labels works on defaults alone.
export const DEFAULTS = Object.freeze({
  readyLabel: 'ready-for-agent',
  wipLabel: 'agent-wip',
  needsHumanLabel: 'needs-human',
  blockedByHeading: '## Blocked by',
  maxConcurrent: 2,
  maxCiRetries: 2,
  branchPrefix: 'agent/',
  order: 'title-sequence',
  verifyCommands: ['npm run typecheck', 'npm test'],
  ciWorkflow: 'build-check.yml'
})

const STRING_KEYS = [
  'readyLabel', 'wipLabel', 'needsHumanLabel',
  'blockedByHeading', 'branchPrefix', 'ciWorkflow'
]
const ORDERS = ['title-sequence', 'issue-number']

export function loadConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('agent-burn config must be a JSON object')
  }

  // Reject unknown keys rather than ignoring them: a typo in a label name would
  // otherwise silently disable eligibility filtering.
  const unknown = Object.keys(raw).filter((k) => !(k in DEFAULTS))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown agent-burn config key(s): ${unknown.join(', ')}. ` +
      `Known keys: ${Object.keys(DEFAULTS).join(', ')}`
    )
  }

  const cfg = { ...DEFAULTS, ...raw }

  if (!Number.isInteger(cfg.maxConcurrent) || cfg.maxConcurrent < 1) {
    throw new Error('maxConcurrent must be an integer >= 1')
  }
  if (!Number.isInteger(cfg.maxCiRetries) || cfg.maxCiRetries < 0) {
    throw new Error('maxCiRetries must be an integer >= 0')
  }
  if (!ORDERS.includes(cfg.order)) {
    throw new Error(`order must be one of: ${ORDERS.join(', ')}`)
  }
  if (
    !Array.isArray(cfg.verifyCommands) ||
    cfg.verifyCommands.length === 0 ||
    cfg.verifyCommands.some((c) => typeof c !== 'string' || c.trim() === '')
  ) {
    throw new Error('verifyCommands must be a non-empty array of non-empty strings')
  }
  for (const k of STRING_KEYS) {
    if (typeof cfg[k] !== 'string' || cfg[k].trim() === '') {
      throw new Error(`${k} must be a non-empty string`)
    }
  }

  return cfg
}
