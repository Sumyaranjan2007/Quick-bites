# Quick Bites — getting an AI back on track

**Updated:** 5 October 2026 (replaces the 6 September version, whose protocol
pointed at the old chunk plan, `MANIFEST.md` and a stack that no longer exists)

Copy-paste these to an AI assistant when it loses context, drifts, or invents
things.

---

## 1. Starting, or after it lost context

> "Read `CLAUDE.md` in full, then `OWNER_ACTIONS.md` Part 0 and the top three
> entries of `CHANGELOG.md`. Tell me in five lines: what the platform is, the
> last release, what is live, and what is waiting on me. Don't change anything
> yet."

## 2. It invents files, routes or features

> "Stop. Show me the file or route you are relying on with a directory listing
> or grep. If it does not exist, say so and continue from what actually exists.
> `CLAUDE.md` §9 lists which documents are current and which are historical."

## 3. It is about to do something risky

> "Before you continue: are you staging by explicit path? No `git add -A`,
> `git stash`, `git reset --hard` or `git clean`. Is any key, password or phone
> code going into a tracked file? The repository is public. Pushing `main`
> deploys the live server — has the gate (`node scripts/run-backend-tests.mjs`)
> passed?"

## 4. It says something is fixed

> "Fixed where — in the code, on the live server, or on a phone? Show the check
> that would fail if the fix were removed, and whether it is deployed. Deployed
> and observed working are different claims."

## 5. It asks me for a password or wants to sign in to live

> "No. Never sign in to the live system with my password. Tell me what to type
> or click and I will do it. Keys go straight into Railway, never into chat."

## 6. It adds things nobody asked for

> "Stop. The scope is the four phone apps and what I asked for, nothing extra,
> no over-the-air updates. List what you added beyond my request and remove it."

## 7. It explains in code terms

> "I'm not a developer. Tell me what it costs, earns or risks, then what I need
> to do, in plain words."
