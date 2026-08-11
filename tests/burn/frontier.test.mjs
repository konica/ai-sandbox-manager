import { describe, it, expect } from 'vitest'
import { computeFrontier } from '../../scripts/burn/frontier.mjs'
import { loadConfig } from '../../scripts/burn/config.mjs'

const cfg = loadConfig()

function issue(number, over = {}) {
  return {
    number,
    title: `${number} — Ticket ${number}`,
    body: '',
    state: 'OPEN',
    labels: [cfg.readyLabel],
    ...over
  }
}

const CLOSED = (...ns) => new Map(ns.map((n) => [n, 'CLOSED']))

describe('computeFrontier eligibility', () => {
  it('returns a ticket whose blockers are all closed', () => {
    const c = [issue(10, { body: '## Blocked by\n- #1\n- #2' })]
    const { ready } = computeFrontier({
      candidates: c, issueStates: CLOSED(1, 2), openAgentBranches: [], config: cfg
    })
    expect(ready).toEqual([{ number: 10, title: '10 — Ticket 10', branch: 'agent/10-ticket-10' }])
  })

  it('withholds a ticket with one open blocker', () => {
    const c = [issue(10, { body: '## Blocked by\n- #1\n- #2' })]
    const states = new Map([[1, 'CLOSED'], [2, 'OPEN']])
    const { ready, skipped } = computeFrontier({
      candidates: c, issueStates: states, openAgentBranches: [], config: cfg
    })
    expect(ready).toEqual([])
    expect(skipped[0].reason).toContain('blocked-by:2')
  })

  it('treats an unresolvable blocker as blocking rather than ready', () => {
    const c = [issue(10, { body: '## Blocked by\n- #404' })]
    const { ready, skipped } = computeFrontier({
      candidates: c, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready).toEqual([])
    expect(skipped[0].reason).toContain('404')
  })

  it('treats a ticket with no blocker section as ready', () => {
    const { ready } = computeFrontier({
      candidates: [issue(10, { body: '## What to build\nStuff.' })],
      issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready.map((r) => r.number)).toEqual([10])
  })

  it('does not treat an epic footer as a blocker', () => {
    const c = [issue(10, { body: '## Blocked by\n- #1\n\n_Part of epic #999._' })]
    const { ready } = computeFrontier({
      candidates: c, issueStates: CLOSED(1), openAgentBranches: [], config: cfg
    })
    expect(ready.map((r) => r.number)).toEqual([10])
  })

  it('excludes closed, unlabelled, claimed, and needs-human tickets', () => {
    const candidates = [
      issue(10, { state: 'CLOSED' }),
      issue(11, { labels: [] }),
      issue(12, { labels: [cfg.readyLabel, cfg.wipLabel] }),
      issue(13, { labels: [cfg.readyLabel, cfg.needsHumanLabel] })
    ]
    const { ready, skipped } = computeFrontier({
      candidates, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready).toEqual([])
    expect(skipped.map((s) => s.reason)).toEqual([
      'closed', 'missing-ready-label', 'claimed', 'needs-human'
    ])
  })

  it('accepts labels given as objects', () => {
    const c = [issue(10, { labels: [{ name: cfg.readyLabel }] })]
    const { ready } = computeFrontier({
      candidates: c, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready.map((r) => r.number)).toEqual([10])
  })

  it('excludes a ticket that already has an open agent branch', () => {
    const { ready, skipped } = computeFrontier({
      candidates: [issue(10)], issueStates: new Map(),
      openAgentBranches: ['agent/10-ticket-10'], config: cfg
    })
    expect(ready).toEqual([])
    expect(skipped[0].reason).toBe('open-agent-pr')
  })
})

describe('computeFrontier concurrency', () => {
  it('caps the frontier at maxConcurrent', () => {
    const candidates = [issue(10), issue(11), issue(12)]
    const { ready, slots } = computeFrontier({
      candidates, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(slots).toBe(2)
    expect(ready.map((r) => r.number)).toEqual([10, 11])
  })

  it('subtracts in-flight work from the available slots', () => {
    const candidates = [issue(10, { labels: [cfg.readyLabel, cfg.wipLabel] }), issue(11), issue(12)]
    const { ready, slots } = computeFrontier({
      candidates, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(slots).toBe(1)
    expect(ready.map((r) => r.number)).toEqual([11])
  })

  it('counts a ticket once when both its label and its branch are present', () => {
    const candidates = [issue(10, { labels: [cfg.readyLabel, cfg.wipLabel] }), issue(11), issue(12)]
    const { slots, inFlight } = computeFrontier({
      candidates, issueStates: new Map(),
      openAgentBranches: ['agent/10-ticket-10'], config: cfg
    })
    expect(inFlight).toEqual([10])
    expect(slots).toBe(1)
  })

  it('yields nothing when in-flight work fills every slot', () => {
    const candidates = [issue(12)]
    const { ready, slots } = computeFrontier({
      candidates, issueStates: new Map(),
      openAgentBranches: ['agent/10-a', 'agent/11-b'], config: cfg
    })
    expect(slots).toBe(0)
    expect(ready).toEqual([])
  })

  it('never reports negative slots when in-flight exceeds the cap', () => {
    const { slots } = computeFrontier({
      candidates: [issue(12)], issueStates: new Map(),
      openAgentBranches: ['agent/1-a', 'agent/2-b', 'agent/3-c'], config: cfg
    })
    expect(slots).toBe(0)
  })
})

describe('computeFrontier ordering', () => {
  it('orders by title sequence, not issue number, by default', () => {
    const candidates = [
      issue(30, { title: '2 — second' }),
      issue(20, { title: '9 — ninth' }),
      issue(40, { title: '1 — first' })
    ]
    const { ready } = computeFrontier({
      candidates, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready.map((r) => r.number)).toEqual([40, 30])
  })

  it('sorts sequence-less titles last, by issue number', () => {
    const candidates = [
      issue(30, { title: 'no sequence' }),
      issue(20, { title: 'also none' }),
      issue(40, { title: '1 — first' })
    ]
    const { ready } = computeFrontier({
      candidates, issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready.map((r) => r.number)).toEqual([40, 20])
  })

  it('orders by issue number when configured to', () => {
    const byNumber = { ...cfg, order: 'issue-number' }
    const candidates = [issue(30, { title: '1 — a' }), issue(20, { title: '9 — b' })]
    const { ready } = computeFrontier({
      candidates, issueStates: new Map(), openAgentBranches: [], config: byNumber
    })
    expect(ready.map((r) => r.number)).toEqual([20, 30])
  })
})

// A given-up ticket keeps its wip label and its pull request stays open, so it
// holds a slot until a human acts. Two of those freeze the queue — and `ready:
// []` looks exactly like an empty backlog, so the frozen state has to be
// reported separately or nobody finds out.
describe('computeFrontier stall detection', () => {
  const gaveUp = (n) => issue(n, { labels: [cfg.readyLabel, cfg.wipLabel, cfg.needsHumanLabel] })

  it('reports stalled when every slot is held by a handed-over ticket', () => {
    const { ready, slots, stalled, handedOver } = computeFrontier({
      candidates: [gaveUp(10), gaveUp(11), issue(12)],
      issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(ready).toEqual([])
    expect(slots).toBe(0)
    expect(handedOver).toEqual([10, 11])
    expect(stalled).toBe(true)
  })

  it('is not stalled while one slot-holder is still being worked', () => {
    const { stalled, handedOver } = computeFrontier({
      candidates: [gaveUp(10), issue(11, { labels: [cfg.readyLabel, cfg.wipLabel] }), issue(12)],
      issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(handedOver).toEqual([10])
    expect(stalled).toBe(false)
  })

  it('is not stalled when slots remain, however many tickets were given up', () => {
    const { slots, stalled } = computeFrontier({
      candidates: [gaveUp(10), issue(11)], issueStates: new Map(),
      openAgentBranches: [], config: cfg
    })
    expect(slots).toBe(1)
    expect(stalled).toBe(false)
  })

  it('is not stalled when a slot is held by a branch with no matching candidate', () => {
    // Unknowable rather than known-stuck: fail safe and stay quiet.
    const { slots, stalled, handedOver } = computeFrontier({
      candidates: [gaveUp(10)], issueStates: new Map(),
      openAgentBranches: ['agent/99-mystery'], config: cfg
    })
    expect(slots).toBe(0)
    expect(handedOver).toEqual([10])
    expect(stalled).toBe(false)
  })

  it('is never stalled with nothing in flight', () => {
    const { stalled } = computeFrontier({
      candidates: [], issueStates: new Map(), openAgentBranches: [], config: cfg
    })
    expect(stalled).toBe(false)
  })
})

describe('computeFrontier edge cases', () => {
  it('returns a valid empty result for no candidates', () => {
    const r = computeFrontier({ candidates: [], issueStates: new Map(), openAgentBranches: [], config: cfg })
    expect(r).toEqual({ ready: [], skipped: [], inFlight: [], slots: 2, handedOver: [], stalled: false })
  })

  it('defaults every input so a bare config call does not throw', () => {
    expect(() => computeFrontier({ config: cfg })).not.toThrow()
  })
})
