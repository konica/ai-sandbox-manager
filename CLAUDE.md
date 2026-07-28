## Project lifecycle (Superpowers)

Feature work runs through the Superpowers skills: brainstorming → writing-plans →
subagent-driven-development (or executing-plans) → requesting-code-review →
finishing-a-development-branch.

Design docs and implementation plans live in `docs/superpowers/specs/` and
`docs/superpowers/plans/`. That directory is git-ignored, so those artifacts are local
to each machine and are not part of the branch — read them from disk rather than
expecting them in git history.

**Rules:** don't start implementing a feature until its plan is approved; run
`npm run typecheck` and `npm test` before claiming work is complete.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
