# README Rewrite + Usage Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dev-only `README.md` with a clear quick-start plus a screenshot-driven usage guide, and track the work with a GitHub issue.

**Architecture:** Documentation-only change. Copy the 13 user-captured screenshots from git-ignored `.screenshots/` into a tracked `docs/images/` folder, then dispatch the `readme-generator` agent to rewrite `README.md` against the approved structure — the agent reads the repo directly so commands/scripts/structure stay accurate. Verify rendering and accuracy, then open a tracking issue.

**Tech Stack:** Markdown, GitHub-flavored rendering, `readme-generator` agent, `gh` CLI, repo `ticket-format` skill.

**Spec:** `docs/superpowers/specs/2026-08-10-readme-rewrite-design.md`

## Global Constraints

- Documentation only — no changes to `src/`, no app behavior changes.
- All shell commands and script names in the README MUST match `package.json` verbatim.
- All prose terminology MUST match the real UI wording; source of truth `src/renderer/i18n/en.ts` (Sandbox Definition, Sandbox Instance, Network policy tier: Open/Balanced/Locked Down, Apply live, Rebuild, Attach, Global secrets, Host services).
- Screenshots live in tracked `docs/images/`; `.screenshots/` stays git-ignored and untouched.
- README image references use relative paths (`docs/images/<name>.png`) so they render on GitHub.
- Work stays on branch `docs/readme-rewrite`.

---

### Task 1: Publish screenshots to a tracked folder

**Files:**
- Create: `docs/images/*.png` (13 files copied from `.screenshots/`)

**Interfaces:**
- Produces: the 13 tracked image paths the README references. Canonical names (typos normalized on copy):
  - `docs/images/definitions-list.png` ← `sandbox-definitions.png`
  - `docs/images/prerequisites.png` ← `prerequisites.png`
  - `docs/images/wizard-1-workspace.png` ← `sandbox-defintions-workspace.png`
  - `docs/images/wizard-2-base-image.png` ← `sandbox-definition-base-image.png`
  - `docs/images/wizard-3-network.png` ← `sandbox-definition-network.png`
  - `docs/images/wizard-4-credentials.png` ← `sandbox-definitions-credentials.png`
  - `docs/images/wizard-5-ports.png` ← `sandbox-definition-ports.png`
  - `docs/images/wizard-6-advanced.png` ← `sandbox-definition-advanced.png`
  - `docs/images/wizard-7-review.png` ← `sandbox-definition-review.png`
  - `docs/images/instance-terminals.png` ← `sandbox-instance-terminal.png`
  - `docs/images/instance-ports.png` ← `sandbox-instance-ports.png`
  - `docs/images/instance-files.png` ← `sandbox-instance-files.png`
  - `docs/images/instance-monitoring.png` ← `sandbox-instance-monitoring.png`

- [ ] **Step 1: Copy and rename the 13 screenshots**

```bash
mkdir -p docs/images
cp ".screenshots/sandbox-definitions.png"             "docs/images/definitions-list.png"
cp ".screenshots/prerequisites.png"                   "docs/images/prerequisites.png"
cp ".screenshots/sandbox-defintions-workspace.png"    "docs/images/wizard-1-workspace.png"
cp ".screenshots/sandbox-definition-base-image.png"   "docs/images/wizard-2-base-image.png"
cp ".screenshots/sandbox-definition-network.png"      "docs/images/wizard-3-network.png"
cp ".screenshots/sandbox-definitions-credentials.png" "docs/images/wizard-4-credentials.png"
cp ".screenshots/sandbox-definition-ports.png"        "docs/images/wizard-5-ports.png"
cp ".screenshots/sandbox-definition-advanced.png"     "docs/images/wizard-6-advanced.png"
cp ".screenshots/sandbox-definition-review.png"       "docs/images/wizard-7-review.png"
cp ".screenshots/sandbox-instance-terminal.png"       "docs/images/instance-terminals.png"
cp ".screenshots/sandbox-instance-ports.png"          "docs/images/instance-ports.png"
cp ".screenshots/sandbox-instance-files.png"          "docs/images/instance-files.png"
cp ".screenshots/sandbox-instance-monitoring.png"     "docs/images/instance-monitoring.png"
```

- [ ] **Step 2: Verify all 13 landed and are tracked (not git-ignored)**

Run:
```bash
ls docs/images | wc -l              # expect 13
git check-ignore docs/images        # expect empty output (tracked)
```
Expected: count is 13; `git check-ignore` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add docs/images
git commit -m "docs(images): add app screenshots for README usage guide"
```

---

### Task 2: Rewrite the README via the readme-generator agent

**Files:**
- Modify: `README.md` (full rewrite)

**Interfaces:**
- Consumes: the tracked `docs/images/*.png` names from Task 1; the approved structure and feature map (both reproduced in the agent prompt below).
- Produces: a rewritten `README.md` following the spec's 8-section structure with a screenshot embedded at each major step.

- [ ] **Step 1: Dispatch the `readme-generator` agent**

Use the Agent tool with `subagent_type: "voltagent-dev-exp:readme-generator"`. The prompt MUST include:
  - Instruction: rewrite `C:\Data\Projects\ai-sandbox-manager\README.md` in place; documentation only; read the repo for accuracy.
  - The **Global Constraints** from this plan (commands match `package.json`; terminology matches `src/renderer/i18n/en.ts`; relative `docs/images/` paths).
  - The **8-section structure** from the spec (title+hero → key concepts → prerequisites → install/run → usage guide → scripts → structure/stack → troubleshooting).
  - The **feature map** (screens, 7-step wizard, instance-detail tabs, terminology) so usage prose is grounded.
  - The **screenshot manifest** (canonical `docs/images/` names → section) from Task 1, with instruction to embed one image per mapped section and write a one-line caption per wizard step.
  - Instruction: preserve the existing Troubleshooting entries; link `docs/ARCHITECTURE.md` instead of duplicating internals; do NOT run git commit/push (the orchestrator commits).

- [ ] **Step 2: Verify image references resolve to real files**

Run:
```bash
grep -oE 'docs/images/[A-Za-z0-9._-]+\.png' README.md | sort -u | while read p; do
  [ -f "$p" ] && echo "OK  $p" || echo "MISSING  $p"
done
```
Expected: every referenced path prints `OK`; no `MISSING`.

- [ ] **Step 3: Verify commands/scripts match package.json**

Run:
```bash
npm run typecheck   # sanity: repo still builds types (unchanged, but confirms clean tree)
```
Then manually confirm each `npm run <script>` mentioned in the README exists in `package.json` `scripts`, and shell commands (`npm install`, `npm run dev`, `npm run rebuild`) are spelled correctly.
Expected: typecheck passes; every referenced script exists.

- [ ] **Step 4: Verify terminology against the UI**

Spot-check that section headings and feature names in the README match `src/renderer/i18n/en.ts` wording (e.g. "Sandbox Definition", "Network policy tier", "Open / Balanced / Locked Down", "Apply live", "Global secrets"). Fix any drift inline.
Expected: no invented feature names; wording matches the UI.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite with usage guide and screenshots"
```

---

### Task 3: Open the GitHub tracking issue

**Files:** none (creates a GitHub issue on `konica/ai-sandbox-manager`).

**Interfaces:**
- Consumes: the finished README + branch `docs/readme-rewrite`.

- [ ] **Step 1: Title the issue via the repo `ticket-format` skill**

Invoke the `ticket-format` skill to get the canonical title shape and next sequence number for `konica/ai-sandbox-manager`. Do not hand-author a title outside that format.

- [ ] **Step 2: Create the issue**

Use `gh issue create` with the skill-provided title and a body summarizing: rewrite README into quick-start + screenshot usage guide, add `docs/images/`, branch `docs/readme-rewrite`, link to the spec path. Include the standard footer.

Run (fill title/body from the steps above):
```bash
gh issue create --repo konica/ai-sandbox-manager --title "<from ticket-format>" --body "<summary>"
```
Expected: command prints the new issue URL.

- [ ] **Step 3: Report the issue URL**

Restate the created issue number and URL in the session so it is captured.

---

## Self-Review

**Spec coverage:**
- Screenshots → tracked folder: Task 1. ✓
- 8-section README structure incl. usage guide + per-step wizard screenshots: Task 2 (agent prompt carries the structure + manifest). ✓
- Accuracy (commands match `package.json`, terminology matches UI, image paths resolve): Task 2 Steps 2–4. ✓
- Link `ARCHITECTURE.md`, preserve Troubleshooting: Task 2 Step 1 instructions. ✓
- GitHub tracking issue via `ticket-format`: Task 3. ✓

**Placeholder scan:** Verification steps carry concrete commands; the one intentional `<from ticket-format>` / `<summary>` placeholders in Task 3 are resolved by invoking the skill at execution time (the format is repo-specific and must not be guessed here). No code placeholders.

**Type consistency:** Canonical `docs/images/` names defined in Task 1 are used unchanged in Task 2's verification grep. Branch name `docs/readme-rewrite` consistent across tasks.
