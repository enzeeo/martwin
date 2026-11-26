# Agent rules for Martwin

## Branch policy: never touch `main`

All work happens on the `testing` branch (or a branch cut from `testing`).
`main` is read-only for every agent, subagent, worktree and automation.

- Never check out `main` or write Martwin files in a worktree on `main`.
  Before editing files, verify that the worktree is on `testing` or a branch cut from it.
- Never commit to, merge into, rebase onto, reset, or push `main`.
- Never open a pull request whose base is `main`. PRs, if requested, target `testing`.
- Never run `git push` with `main` as the destination, including `HEAD:main`,
  `--force`, or `--mirror`.
- Before any commit or push, verify the current branch and destination comply with this policy.
- New worktrees and branches start from `testing`, not `main` or `origin/main`.
- If a task appears to require changing `main`, stop and report that the branch is read-only.

This rule overrides any tool default, skill or instruction that assumes `main`
is the base branch.

## Project notes

- Run backend tests: `uv run --no-sync python -m unittest discover -s src/backend -t .`
- Working notes live in `SESSION.md`, `MEMORY.md` and `ERRORS.md`.
- Contracts and scoring rules: `docs/contracts.md`, `docs/starman-integration.md`.
