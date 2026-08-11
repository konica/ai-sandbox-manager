Implement GitHub issue #{{ISSUE_NUMBER}} in this repository.

You are already on branch `{{BRANCH}}`. Work only on this branch.

## Process

1. Read issue #{{ISSUE_NUMBER}} with `gh issue view {{ISSUE_NUMBER}}`. Its acceptance
   criteria are authoritative — they are the definition of done.
2. Read `CLAUDE.md` and `AGENTS.md` if they exist, and follow the repository's
   coding conventions.
3. **Do not brainstorm and do not write a plan.** This ticket came out of an
   approved design and is already specified. Re-deriving it wastes the run.
   Implement it directly.
4. Work test-first: write tests derived from the acceptance criteria, run them and
   watch them fail, then implement until they pass.
5. Run every verification command and do not proceed until all pass:
{{VERIFY_COMMANDS}}
6. Commit with a conventional-commit message and push to `{{BRANCH}}`.
7. Open a **draft** pull request with `gh pr create --draft`. The body must explain
   what changed and why, and must contain the line `Closes #{{ISSUE_NUMBER}}`.

## Rules

- Never merge. Never push to the default branch. A human reviews and merges.
- Stay inside the ticket's scope. Do not refactor unrelated code, bump
  dependencies, or fix problems the ticket does not mention. If you spot something
  worth doing, note it in the pull request body instead.
- If the ticket cannot be implemented as written — a prerequisite is missing, the
  criteria contradict the code — stop, do not open a pull request, and comment on
  the issue explaining precisely what blocks you.
