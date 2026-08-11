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
