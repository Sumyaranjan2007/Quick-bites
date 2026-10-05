# Quick Bites — instructions for AI agents

Read **`CLAUDE.md`** first. It is the single, current handoff for every AI tool
(Claude, Codex, Cursor, Gemini and others): what the platform is, where it runs,
where every setting and secret lives, the owner's decisions, the commands, the
release process and the launch status.

The short version of the rules:

- This repository is **public**. Never commit a key, password, token, phone code
  or personal ID. `node scripts/check-secrets.mjs` must pass.
- Stage files by explicit path. Never `git add -A`, `git stash`, `git reset --hard`
  or `git clean`. Pushing `main` deploys the live server.
- Run the gate before every commit that touches the backend:
  `node scripts/run-backend-tests.mjs` (81 suites).
- Never sign in to the live system with the owner's password.
- The owner is not a developer: answer their question plainly first, lead with
  cost and consequence, then do the work.
