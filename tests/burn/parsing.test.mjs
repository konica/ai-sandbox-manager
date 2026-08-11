import { describe, it, expect } from 'vitest'
import {
  parseBlockers, ticketSequence, slugify, branchFor, issueNumbersFromBranches
} from '../../scripts/burn/frontier.mjs'

const H = '## Blocked by'

describe('parseBlockers', () => {
  it('reads issue numbers from list items under the heading', () => {
    const body = `## What to build\nStuff.\n\n${H}\n- #123\n- #456\n`
    expect(parseBlockers(body, H)).toEqual([123, 456])
  })

  it('ignores prose after the list, including an epic footer', () => {
    const body = `${H}\n- #123\n\n_Part of epic #999._`
    expect(parseBlockers(body, H)).toEqual([123])
  })

  it('stops at the next markdown heading', () => {
    const body = `${H}\n- #123\n\n## Notes\n- see #999 for context`
    expect(parseBlockers(body, H)).toEqual([123])
  })

  it('recognises full issue URLs alongside shorthand', () => {
    const body = `${H}\n- https://github.com/owner/repo/issues/77\n- #78`
    expect(parseBlockers(body, H)).toEqual([77, 78])
  })

  it('accepts asterisk bullets and de-duplicates', () => {
    const body = `${H}\n* #5\n- #5\n`
    expect(parseBlockers(body, H)).toEqual([5])
  })

  it('returns empty when there is no blocker section', () => {
    expect(parseBlockers('## What to build\nNo blockers here #42', H)).toEqual([])
  })

  it('returns empty for missing or non-string bodies', () => {
    expect(parseBlockers('', H)).toEqual([])
    expect(parseBlockers(null, H)).toEqual([])
    expect(parseBlockers(undefined, H)).toEqual([])
  })

  it('matches the heading case-insensitively and ignores surrounding whitespace', () => {
    expect(parseBlockers(`  ## blocked BY  \n- #9`, H)).toEqual([9])
  })
})

describe('ticketSequence', () => {
  it('extracts a leading sequence number before an em dash', () => {
    expect(ticketSequence('5 — Persist the binding')).toBe(5)
  })
  it('accepts en dash and hyphen separators', () => {
    expect(ticketSequence('12 – Something')).toBe(12)
    expect(ticketSequence('7 - Something')).toBe(7)
  })
  it('returns null when the title carries no sequence', () => {
    expect(ticketSequence('Fix the thing')).toBeNull()
    expect(ticketSequence('')).toBeNull()
    expect(ticketSequence(undefined)).toBeNull()
  })
})

describe('slugify', () => {
  it('strips the sequence prefix and kebab-cases the rest', () => {
    expect(slugify('5 — Persist MCP binding: schema migration')).toBe('persist-mcp-binding-schema-migration')
  })
  it('caps length and never leaves a trailing dash', () => {
    const s = slugify('x'.repeat(80))
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('-')).toBe(false)
  })
  it('falls back to a placeholder when nothing survives', () => {
    expect(slugify('!!!')).toBe('ticket')
  })
})

describe('branchFor', () => {
  it('builds prefix + number + slug', () => {
    const cfg = { branchPrefix: 'agent/' }
    expect(branchFor({ number: 18, title: '5 — Persist the binding' }, cfg)).toBe('agent/18-persist-the-binding')
  })
})

describe('issueNumbersFromBranches', () => {
  it('extracts issue numbers from matching branches only', () => {
    const got = issueNumbersFromBranches(
      ['agent/18-a', 'agent/29-b', 'feature/99-c', 'main'], 'agent/'
    )
    expect([...got].sort((a, b) => a - b)).toEqual([18, 29])
  })
  it('treats regex metacharacters in the prefix literally', () => {
    expect([...issueNumbersFromBranches(['a.b/7-x'], 'a.b/')]).toEqual([7])
    expect([...issueNumbersFromBranches(['axb/7-x'], 'a.b/')]).toEqual([])
  })
  it('handles an empty or missing branch list', () => {
    expect([...issueNumbersFromBranches([], 'agent/')]).toEqual([])
    expect([...issueNumbersFromBranches(undefined, 'agent/')]).toEqual([])
  })
})
