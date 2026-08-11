# Agent burn queue

Label a ticket `ready-for-agent` and CI implements it, opens a draft pull request,
keeps it green, and marks it ready for your review. Merging that pull request
closes the issue, which unblocks its dependents and starts the next round.

## Your part

1. Write a ticket with acceptance criteria and a `## Blocked by` list.
2. Label it `ready-for-agent`.
3. Review and merge the pull requests that appear.

Everything else is automatic. The agent never merges.

## Ticket convention

Declare blockers as a list under a `## Blocked by` heading:

```markdown
## Blocked by
- #123
- #456
```

**Only list items count.** Prose after the list is ignored, which is what lets a
footer such as `_Part of epic #999._` sit below the list without being mistaken
for a blocker. Omit the section entirely when a ticket has no blockers.

## Labels

| Label | Meaning |
| --- | --- |
| `ready-for-agent` | You applied this. The queue may pick the ticket up. |
| `agent-wip` | Claimed. Applied when the queue starts work; removed if it opens no pull request, or when its pull request is closed without merging. **Not** removed when the queue gives up on CI — see below. |
| `needs-human` | The queue stopped and wants you. Applied when CI stayed red after every retry (to both the issue and the pull request), and when a run ends without opening a pull request at all. The queue will not touch the issue again while this label is present. |
| `agent-retry-N` | Nth automated CI fix attempt on a pull request. |

`needs-human` is what bounds *dispatch* attempts, the way `agent-retry-N` bounds CI
fix attempts. The agent is told to open no pull request when a ticket cannot be
implemented as written; without a terminal label the six-hourly catch-up run would
burn a fresh agent run on that same impossible ticket forever.

## Trust model

**Applying `ready-for-agent` is the trust decision.** There is no second gate.
Everything downstream — an agent with `AGENT_PAT` (Contents, Pull requests and
Issues read+write) running unattended on this repository — follows from that one
label.

- **The issue body is an instruction to the agent, not data.** The agent reads the
  ticket with `gh issue view` and treats its acceptance criteria as the definition
  of done. Whatever the body says, it says to something holding write credentials.
- **Read the body at the moment you label.** Not the version you remember, and not
  the version you reviewed last week.
- **A body edited after labelling is never re-checked.** Nothing in the queue
  re-reads or re-approves it. An issue author can rewrite the body the moment the
  label lands, and the next dispatcher run — event-driven or the six-hourly
  catch-up — will hand the agent the new text. If a ticket's body changes after
  you labelled it, remove `ready-for-agent`, re-read, and re-apply.
- **This repository is public.** Anyone can open an issue. Labelling a ticket
  written by someone you do not trust hands that person influence over an agent
  with write access to this repository. Label your own tickets, or rewrite an
  outside contributor's into a ticket you author, rather than labelling theirs.
- Branch names are not identities, and the queue does not treat them as such.
  Anyone with a fork can push `agent/12-anything`; both workflows filter pull
  requests by head repository, never by branch name alone. Do not add a lookup
  that matches on branch name only.

## Operating it

- **Dry run** — Actions → agent-burn → Run workflow → `dry_run: true`. Prints the
  computed frontier in the job summary without dispatching. Do this after any
  change to `scripts/burn/`.
- **Pause the queue** — set repository variable `AGENT_BURN_ENABLED` to `false`.
  Unset or any other value means enabled. This stops two things: the dispatcher
  claims no new tickets, and the CI-retry job stops running agent fix attempts
  on pull requests that are already open. It deliberately does **not** stop
  everything: an in-flight pull request whose CI just went green is still
  promoted to ready-for-review, and closing a pull request still releases its
  claim and deletes its branch. Both of those are cheap bookkeeping, not agent
  runs, and leaving them enabled means a pause doesn't strand claims or leave
  reviewable work stuck in draft.
- **Give up** — after `maxCiRetries` failed automated fix attempts, the queue
  stops working the pull request, adds `needs-human` to both the issue and the
  pull request, and comments on the pull request with a link to the failing run.
  It deliberately leaves `agent-wip` on the issue so a second agent can't start a
  competing attempt on work that already has an open pull request.
- **Retry a given-up ticket** — remove `needs-human` from the issue, then close
  its pull request. Closing the pull request automatically releases the
  `agent-wip` claim and deletes the branch; the queue then picks the issue up on
  its next run. (Removing `agent-wip` from the issue by hand first is harmless
  but not required.)
- **Throw away an attempt** — close the pull request without merging. The claim
  is released and the branch deleted automatically.
- **Queue frozen** — a given-up ticket keeps `agent-wip` and keeps its pull
  request open, so it holds one of the `maxConcurrent` slots until you act. Once
  every slot is held that way the queue stops dispatching entirely, and the
  computed frontier is empty — which looks exactly like an empty backlog. The
  frontier step says so explicitly when it happens: a `STALLED:` line in the step
  log naming the tickets, and a **Blocked on you** note at the top of the job
  summary. Free a slot by merging, fixing, or closing one of those pull requests.
- **A merged pull request from a fork** does not replan immediately. The
  dispatcher skips `pull_request` events that came from a fork, because such a
  run gets no secrets and would fail on the missing `AGENT_PAT` — a red
  `agent-burn` on every external pull request trains everyone to ignore this
  workflow being red. The next scheduled run (every 6 hours) picks up whatever
  that merge unblocked; a `workflow_dispatch` run replans immediately.

## Configuration

`.github/agent-burn.json`. Every key is optional; defaults live in
`scripts/burn/config.mjs`.

| Key | Default | Meaning |
| --- | --- | --- |
| `readyLabel` | `ready-for-agent` | Label that makes a ticket eligible. |
| `wipLabel` | `agent-wip` | Claim label. |
| `needsHumanLabel` | `needs-human` | Given-up label. |
| `blockedByHeading` | `## Blocked by` | Heading the blocker list sits under. |
| `maxConcurrent` | `2` | Cap on simultaneous agent pull requests. |
| `maxCiRetries` | `2` | Automated fix attempts before handing over. |
| `branchPrefix` | `agent/` | Branch namespace for agent work. |
| `order` | `title-sequence` | `title-sequence` or `issue-number`. |
| `verifyCommands` | `["npm run typecheck", "npm test"]` | Must pass before a PR opens. |
| `ciWorkflow` | `build-check.yml` | CI workflow the retry loop watches. |

## Porting to another repository

1. Copy `scripts/burn/`, `.github/workflows/agent-burn.yml`,
   `.github/workflows/agent-fix-ci.yml`, and `.github/agent-burn-prompt.md`.
2. Add `.github/agent-burn.json` with at least `verifyCommands` and `ciWorkflow`.
3. Edit the two literals in `agent-fix-ci.yml`: the workflow name in
   `workflow_run.workflows`, and the branch prefix in each job's `if:` guard.
   Workflow triggers and `if:` conditions are evaluated before any step runs, so
   neither can read config. `setup.mjs` flags both if they drift.
4. Create an `AGENT_PAT` secret and a `CLAUDE_CODE_OAUTH_TOKEN` secret.
5. Run `node scripts/burn/setup.mjs` and clear anything it lists.
6. Confirm with a `dry_run` dispatch.

## Why AGENT_PAT rather than GITHUB_TOKEN

GitHub does not fire workflow-triggering events for actions taken with the default
`GITHUB_TOKEN`. A pull request opened with it would trigger neither CI nor the
review workflow: the draft would sit with no checks, promotion would never fire
because no CI run ever completes, and the queue would stall while looking healthy.
The dispatcher therefore uses a fine-grained PAT and fails immediately if it is
absent.

Required permissions: **Contents** read/write, **Pull requests** read/write,
**Issues** read/write.
