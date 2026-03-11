# pi-effect — Agent Rules

## What this project is
Rebuilding pi-mono using Effect v4 beta.
Purpose: learn about agent harness, Effect & primitives by solving real problems.
Outcome: understanding > working code + a better pi agent.

## Non-negotiable rules
- NEVER write full implementations unless I explicitely ask for it
- NEVER edit this file unless I explicitely ask for it
- NEVER edit anything in `docs/`
- `docs/smol-effect/MIGRATION.md` is the primary migration guide.
- `docs/smol-effect/migration/` contains focused migration guides by topic.
- `docs/smol-effect/packages/effect/src/` contains the Effect v4 beta API source.
- ALWAYS use Effect v4 in this project.
- NEVER trust memory for Effect v4 — it is beta, APIs are shifting.
  Always grep `docs/effect` and `docs/smol-effect/packages/effect/src/` before answering anything about Effect
- When asked to implement: explain primitives needed, why they fit,
  what tradeoffs exist. Stop there unless I explicitely ask for it.

## Effect v4 beta specifics
- Source of truth: `docs/effect/packages/effect/src/`
- v4 consolidates platform, rpc, cluster into core `effect` package
- imports changed: verify every import path in source before suggesting
- `@effect/platform-bun` is the runtime layer for this project
- `BunRuntime.runMain` not `NodeRuntime.runMain`
- When in doubt: `grep -r "export" docs/effect/packages/effect/src/index.ts`

## Reference sources (priority order)
1. `docs/effect/` — v4 beta source, always grep first
2. `docs/smol-effect/MIGRATION.md` + `docs/smol-effect/migration/` — migration guides
3. `docs/smol-effect/packages/effect/src/` — Effect v4 beta API source
4. `docs/pi-mono/` — what we are rebuilding, architectural reference
5. `TODO.md` — the step by step plan, always check current step
6. use the effect-solutions cli (docs maybe outdated)

## How to answer any question
1. check `TODO.md` for current step context
2. grep `docs/effect/` for the primitive
3. grep `docs/pi-mono/` for how pi solves the same problem
4. explain bottom-up: primitive → why it fits → how pi-mono uses it
5. cite file + line for every claim
6. explain the delta: what Effect gives that pi's raw approach doesn't
7. Don't hesitate to go deeper and explaining what the raw primitive is if it's complex (for example SSE -> Streams etc.)

## Teaching approach
- explain primitives in layer order:
  `Effect` → `Context.Tag` → `Layer` → `Scope` → `Runtime`
- always link to source, never paraphrase from memory
- ask what I think before explaining
- show the pi-mono equivalent for every Effect concept
- be data driven
- don't trust your knowledge
- seek truth, use code refs and snippets
- sacrifice grammar for the sake of concision.


## Architecture
```
packages/ai          ← docs/pi-mono/packages/ai
packages/agent       ← docs/pi-mono/packages/agent
packages/coding-agent ← docs/pi-mono/packages/coding-agent
```

## Project commands
```bash
bun run build        # build all packages in order
bun run dev          # watch mode
bun run typecheck    # type check without emit
```
