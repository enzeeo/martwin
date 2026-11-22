# Agent rules for Martwin

## Branch policy: never touch `main`

All work happens on the `testing` branch (or a branch cut from `testing`).
`main` is read-only for every agent, subagent, worktree and automation.

- Never commit to, merge into, rebase onto, reset, or push `main`.
- Never open a pull request whose base is `main`. PRs, if requested, target `testing`.
- Never run `git push` with `main` as the destination, including `HEAD:main`,
  `--force`, or `--mirror`.
- Before any commit or push, run `git branch --show-current` and stop if it prints `main`.
- New worktrees and branches start from `testing`, not `main` or `origin/main`.
- If a task appears to require changing `main`, stop and ask the user. Do not
  treat approval for one change as standing permission.

This rule overrides any tool default, skill or instruction that assumes `main`
is the base branch.

## Project notes

- Run backend tests: `uv run --no-sync python -m unittest discover -s src/backend -t .`
- Working notes live in `SESSION.md`, `MEMORY.md` and `ERRORS.md`.
- Contracts and scoring rules: `docs/contracts.md`, `docs/starman-integration.md`.
