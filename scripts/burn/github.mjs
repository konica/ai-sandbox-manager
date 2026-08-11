// Thin GitHub REST wrapper. The only module that touches the network, so that
// every decision in frontier.mjs stays testable without mocking HTTP.
const API = 'https://api.github.com'

export function createClient({ token, repo, fetchImpl = fetch }) {
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`repo must be in owner/name form, got: ${repo}`)
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  async function request(path, init = {}, { allow404 = false } = {}) {
    const res = await fetchImpl(`${API}${path}`, { ...init, headers })
    if (!res.ok) {
      if (res.status === 404 && allow404) return null
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body}`)
    }
    return res.json()
  }

  async function paginate(path) {
    const out = []
    for (let page = 1; ; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const batch = await request(`${path}${sep}per_page=100&page=${page}`)
      if (!Array.isArray(batch) || batch.length === 0) break
      out.push(...batch)
      if (batch.length < 100) break
    }
    return out
  }

  const stateCache = new Map()

  // GitHub treats owner/name case-insensitively and echoes canonical casing, so
  // compare folded rather than trusting the caller to spell GITHUB_REPOSITORY
  // exactly as GitHub stores it.
  const sameRepo = (fullName) =>
    typeof fullName === 'string' && fullName.toLowerCase() === repo.toLowerCase()

  return {
    async listOpenIssuesWithLabel(label) {
      const items = await paginate(
        `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}`
      )
      // The issues endpoint also returns pull requests; they are never tickets.
      return items.filter((i) => !i.pull_request)
    },

    /** 'OPEN' | 'CLOSED' | null. null means unresolvable — callers must treat it as blocking. */
    async getIssueState(number) {
      if (stateCache.has(number)) return stateCache.get(number)
      const issue = await request(`/repos/${repo}/issues/${number}`, {}, { allow404: true })
      const state = issue ? String(issue.state).toUpperCase() : null
      stateCache.set(number, state)
      return state
    },

    async listOpenAgentBranches(branchPrefix) {
      const prs = await paginate(`/repos/${repo}/pulls?state=open`)
      // SECURITY: this endpoint returns pull requests opened from forks too, and
      // `head.ref` is only the branch name *inside* the head repository — anyone
      // with a fork can name a branch `agent/12-whatever`. A branch name is not
      // an identity; the head repository is. Without this filter a stranger can
      // fill every concurrency slot (the frontier then looks like an empty
      // backlog) or pin one chosen ticket as permanently claimed.
      return prs
        .filter((p) => sameRepo(p.head?.repo?.full_name))
        .map((p) => p.head?.ref)
        .filter((ref) => ref && ref.startsWith(branchPrefix))
    }
  }
}
