import { describe, it, expect, vi } from 'vitest'
import { createClient } from '../../scripts/burn/github.mjs'

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function clientWith(fetchImpl) {
  return createClient({ token: 't0ken', repo: 'owner/name', fetchImpl })
}

describe('createClient', () => {
  it('rejects a malformed repo', () => {
    expect(() => createClient({ token: 't', repo: 'nope', fetchImpl: vi.fn() })).toThrow(/owner\/name/)
  })

  it('sends auth and API version headers', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse([]))
    await clientWith(f).listOpenIssuesWithLabel('ready-for-agent')
    const [, init] = f.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer t0ken')
    expect(init.headers.Accept).toBe('application/vnd.github+json')
    expect(init.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })
})

describe('listOpenIssuesWithLabel', () => {
  it('requests open issues filtered by label', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse([{ number: 1, pull_request: undefined }]))
    await clientWith(f).listOpenIssuesWithLabel('ready-for-agent')
    const url = f.mock.calls[0][0]
    expect(url).toContain('/repos/owner/name/issues')
    expect(url).toContain('state=open')
    expect(url).toContain('labels=ready-for-agent')
    expect(url).toContain('per_page=100')
  })

  it('URL-encodes labels containing spaces', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse([]))
    await clientWith(f).listOpenIssuesWithLabel('good first issue')
    expect(f.mock.calls[0][0]).toContain('labels=good%20first%20issue')
  })

  it('drops pull requests, which the issues endpoint also returns', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse([
      { number: 1 }, { number: 2, pull_request: { url: 'x' } }
    ]))
    const got = await clientWith(f).listOpenIssuesWithLabel('l')
    expect(got.map((i) => i.number)).toEqual([1])
  })

  it('follows pagination until a short page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }))
    const f = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse([{ number: 101 }]))
    const got = await clientWith(f).listOpenIssuesWithLabel('l')
    expect(got).toHaveLength(101)
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1][0]).toContain('page=2')
  })

  it('throws with status and body on a failed request', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, 401))
    await expect(clientWith(f).listOpenIssuesWithLabel('l')).rejects.toThrow(/401/)
  })
})

describe('getIssueState', () => {
  it('upper-cases the returned state', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ state: 'closed' }))
    expect(await clientWith(f).getIssueState(7)).toBe('CLOSED')
  })

  it('returns null for a missing issue so the caller can fail safe', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404))
    expect(await clientWith(f).getIssueState(404)).toBeNull()
  })

  it('caches repeat lookups of the same issue', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ state: 'closed' }))
    const c = clientWith(f)
    await c.getIssueState(7)
    await c.getIssueState(7)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('still throws on non-404 errors rather than masking them as null', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ message: 'boom' }, 500))
    await expect(clientWith(f).getIssueState(7)).rejects.toThrow(/500/)
  })
})

describe('listOpenAgentBranches', () => {
  it('returns head branches of open PRs matching the prefix', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse([
      { head: { ref: 'agent/10-a' } }, { head: { ref: 'feature/x' } }
    ]))
    expect(await clientWith(f).listOpenAgentBranches('agent/')).toEqual(['agent/10-a'])
    expect(f.mock.calls[0][0]).toContain('state=open')
  })
})

describe('read-only surface', () => {
  it('exposes no mutation methods', () => {
    const c = clientWith(vi.fn())
    expect(Object.keys(c).sort()).toEqual(
      ['getIssueState', 'listOpenAgentBranches', 'listOpenIssuesWithLabel']
    )
  })
})
