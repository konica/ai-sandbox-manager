// Pure decision logic for the burn queue. No I/O lives here, which is what makes
// the queue's behaviour testable.

const ISSUE_REF = /#(\d+)\b|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)\b/g
const HEADING = /^#{1,6}\s/
const LIST_ITEM = /^\s*[-*]\s+/
const SEQ_PREFIX = /^\s*(\d+)\s*[—–-]/

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Issue numbers declared as blockers under `heading`.
 *
 * Only references inside list items count. Ticket bodies carry trailing prose
 * after the list — often a footer naming a parent epic. Counting that footer
 * would mark every child of an open epic permanently blocked, stalling the
 * queue in a way that looks exactly like an empty backlog.
 */
export function parseBlockers(body, heading) {
  if (typeof body !== 'string' || body === '') return []

  const wanted = heading.trim().toLowerCase()
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim().toLowerCase() === wanted)
  if (start === -1) return []

  const refs = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (HEADING.test(line.trim())) break
    if (!LIST_ITEM.test(line)) continue
    for (const m of line.matchAll(ISSUE_REF)) refs.push(Number(m[1] ?? m[2]))
  }
  return [...new Set(refs)]
}

/** Leading sequence number in a ticket title, or null. */
export function ticketSequence(title) {
  const m = SEQ_PREFIX.exec(String(title ?? ''))
  return m ? Number(m[1]) : null
}

/** Branch-safe slug from a title, with any sequence prefix removed. */
export function slugify(title) {
  const body = String(title ?? '').replace(/^\s*\d+\s*[—–-]\s*/, '')
  const slug = body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
  return slug || 'ticket'
}

export function branchFor(issue, config) {
  return `${config.branchPrefix}${issue.number}-${slugify(issue.title)}`
}

/** Issue numbers implied by open agent branches. */
export function issueNumbersFromBranches(branches, branchPrefix) {
  const re = new RegExp(`^${escapeRegExp(branchPrefix)}(\\d+)-`)
  const out = new Set()
  for (const b of branches ?? []) {
    const m = re.exec(b)
    if (m) out.add(Number(m[1]))
  }
  return out
}

function labelSet(issue) {
  return new Set((issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)))
}

function orderKey(issue, config) {
  if (config.order === 'issue-number') return issue.number
  const seq = ticketSequence(issue.title)
  return seq === null ? Number.MAX_SAFE_INTEGER : seq
}

/**
 * Decide which tickets to dispatch.
 *
 * Fails safe throughout: a blocker whose state is unknown counts as open, so a
 * bug here stalls the queue rather than dispatching work with unmet prerequisites.
 */
export function computeFrontier({
  candidates = [],
  issueStates = new Map(),
  openAgentBranches = [],
  config
}) {
  const claimedByBranch = issueNumbersFromBranches(openAgentBranches, config.branchPrefix)

  // Union rather than sum: a stale label or a deleted branch must not
  // double-count one ticket and starve the queue.
  const inFlight = new Set(claimedByBranch)
  for (const i of candidates) {
    if (labelSet(i).has(config.wipLabel)) inFlight.add(i.number)
  }

  const skipped = []
  const eligible = []

  for (const issue of candidates) {
    const labels = labelSet(issue)

    if (issue.state && String(issue.state).toUpperCase() !== 'OPEN') {
      skipped.push({ number: issue.number, reason: 'closed' }); continue
    }
    if (!labels.has(config.readyLabel)) {
      skipped.push({ number: issue.number, reason: 'missing-ready-label' }); continue
    }
    if (labels.has(config.needsHumanLabel)) {
      skipped.push({ number: issue.number, reason: 'needs-human' }); continue
    }
    if (labels.has(config.wipLabel)) {
      skipped.push({ number: issue.number, reason: 'claimed' }); continue
    }
    if (claimedByBranch.has(issue.number)) {
      skipped.push({ number: issue.number, reason: 'open-agent-pr' }); continue
    }

    const open = []
    for (const b of parseBlockers(issue.body, config.blockedByHeading)) {
      const state = issueStates.get(b)
      if (state === undefined || String(state).toUpperCase() !== 'CLOSED') open.push(b)
    }
    if (open.length > 0) {
      skipped.push({ number: issue.number, reason: `blocked-by:${open.join(',')}` }); continue
    }

    eligible.push(issue)
  }

  eligible.sort((a, b) => orderKey(a, config) - orderKey(b, config) || a.number - b.number)

  const slots = Math.max(0, config.maxConcurrent - inFlight.size)
  const ready = eligible.slice(0, slots).map((i) => ({
    number: i.number,
    title: i.title,
    branch: branchFor(i, config)
  }))

  return { ready, skipped, inFlight: [...inFlight].sort((a, b) => a - b), slots }
}
