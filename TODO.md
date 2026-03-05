# pi-effect: Project Outline

> Rebuild pi-mono layer by layer using Effect-ts.
> 3 projects, full parity at the end of each.

---

## PROJECT 1 — `@pi-effect/ai`
**Parity target:** `packages/ai/src/`
**Goal:** Unified streaming LLM API across providers.

---

- [ ] **1.1 — Types & Schema**

**Maps to:** `src/types.ts`
**Build:** `Model`, `Message`, `ContentBlock`, `Tool`, `AssistantMessage`, `StreamEvent` types using `@effect/schema`.

**Effect primitives:**
- `Schema.Struct`, `Schema.Union`, `Schema.Literal`
- `Schema.Class` for domain types
- `Data.TaggedError` for `LLMError`, `ProviderError`

**Test:** Encode/decode a `Model` and a `Message[]` round-trip. All schema errors are typed.

---

- [ ] **1.2 — Provider Service + Registry**

**Maps to:** `src/api-registry.ts`, `src/models.ts`, `src/providers/register-builtins.ts`
**Build:** `ApiRegistry` service that maps `(provider, modelId)` → provider implementation. Hardcode 3 models (claude, gpt-4o, gemini-flash).

**Effect primitives:**
- `Context.Tag` — define the `ApiRegistry` service interface
- `Layer.succeed` — simplest Layer, no async needed yet
- `Ref<Map<...>>` — mutable registry state

**Test:** `ApiRegistry` resolves the right provider for each model. Unknown model returns typed `ModelNotFoundError`.

---

- [ ] **1.3 — Auth Storage**

**Maps to:** `src/env-api-keys.ts`, utils in `oauth/types.ts`
**Build:** `AuthStorage` service: reads keys from env vars + `~/.pi/agent/auth.json`. Priority: runtime → file → env.

**Effect primitives:**
- `Layer.effect` — async layer construction
- `@effect/platform` `FileSystem`, `Path`
- `Effect.orElse`, `Effect.catchTag` — typed fallback chain
- `Config.string`, `Config.withDefault` — env var reading

**Test:** Reads key from env. Falls back to file. Returns typed `MissingKeyError` if neither exists.

---

- [ ] **1.4 — Message Transformation**

**Maps to:** `src/providers/transform-messages.ts`, `src/providers/openai-responses-shared.ts`, `src/providers/google-shared.ts`
**Build:** Pure functions that transform pi's canonical `Message[]` into provider-specific formats (Anthropic, OpenAI, Google).

**Effect primitives:**
- `Effect.gen` with pure transformations
- `Schema.encode` / `Schema.decode` for provider payloads
- `Array` module from `effect` (not lodash)

**Test:** A `Message[]` with tool results transforms correctly for each provider. Snapshot test the output shape.

---

- [ ] **1.5 — Streaming Core**

**Maps to:** `src/stream.ts`, `src/utils/event-stream.ts`
**Build:** `stream(model, context)` → `Stream<StreamEvent, LLMError>`. Wraps provider SDK streams. Normalizes events: `text_delta`, `tool_use_start/delta/end`, `usage`, `thinking_delta`.

**Effect primitives:**
- `Stream.fromAsyncIterable` — wrap SDK async iterables
- `Stream.mapEffect`, `Stream.tap`
- `Stream.catchAll`, `Stream.ensuring`
- `Stream.runCollect`, `Stream.runFold` for consuming

**Test:** Mock a provider that emits 3 chunks. Assert `Stream.runCollect` yields the right `StreamEvent[]`. Assert errors surface as typed `LLMError`.

---

- [ ] **1.6 — Provider Implementations**

**Maps to:** `src/providers/anthropic.ts`, `src/providers/openai-responses.ts`, `src/providers/google.ts`, `src/providers/openai-completions.ts`
**Build:** One `Layer` per provider. Each takes `AuthStorage` as dependency, builds the API client, implements `stream()`.

**Effect primitives:**
- `Layer.effect` with `AuthStorage` dependency
- `Effect.acquireRelease` — SDK client lifecycle
- `Effect.tryPromise` with error mapping
- `Layer.provide`, `Layer.merge`

**Test:** Each provider layer resolves with a real (or mocked) client. Swap layers in tests without changing logic.

---

- [ ] **1.7 — Token Usage & Cost Tracking**

**Maps to:** `src/utils/overflow.ts`, test files `tokens.test.ts`, `total-tokens.test.ts`
**Build:** Accumulate `usage` events from stream. Compute cost using model's `inputCostPer1k` / `outputCostPer1k`. Expose as a `Metric`.

**Effect primitives:**
- `Metric.counter`, `Metric.gauge` — token/cost tracking
- `Stream.runFold` — accumulate usage over stream
- `Effect.withSpan` — trace a completion call

**Test:** After consuming a stream, total tokens and cost are correct. Metrics are queryable.

---

- [ ] **1.8 — OAuth Support**

**Maps to:** `src/oauth.ts`, `src/utils/oauth/` (anthropic, github-copilot, google-gemini-cli, pkce)
**Build:** `OAuthService` — handles PKCE flow, token storage, refresh. Providers that need OAuth (Copilot, Gemini CLI) use it instead of API keys.

**Effect primitives:**
- `Effect.acquireRelease` — token lifecycle
- `Schedule.exponential` — retry on token expiry
- `HttpClient` from `@effect/platform` — PKCE token exchange

**Test:** Token refresh is retried with backoff. Expired token triggers re-auth flow.

---

### ✅ PROJECT 1 PARITY CHECKLIST
- [ ] All provider SDKs wrapped as Effect Layers
- [ ] Streaming normalised to canonical `StreamEvent` union
- [ ] Auth: env → file → OAuth fallback chain
- [ ] Token usage + cost computed per call
- [ ] Message transformation for all 3 provider families
- [ ] All errors are typed `Data.TaggedError` subtypes

Optional add on: 
- [ ] Add support for models.dev
- [ ] Add support for OpenAI Websocket connections.

---

## PROJECT 2 — `@pi-effect/agent-core`
**Parity target:** `packages/agent/src/`
**Goal:** Agent loop, tool dispatch, message queue, context management.

---

- [ ] **2.1 — Agent Types**

**Maps to:** `src/types.ts`
**Build:** `AgentContext` (systemPrompt + messages + tools), `ToolDefinition<I,O>`, `AgentEvent` union (text, tool_use, tool_result, done, error), `CompactionEntry`.

**Effect primitives:**
- `Schema.TaggedStruct` — discriminated union events
- `Data.TaggedError` — `ToolError`, `AgentError`, `ContextOverflowError`
- `Chunk<AgentEvent>` — efficient event accumulation

**Test:** Encode/decode a full `AgentContext`. All event variants parse correctly.

---

- [ ] **2.2 — Tool Dispatch**

**Maps to:** `src/agent.ts` (tool execution portion), test `utils/calculate.ts`, `utils/get-current-time.ts`
**Build:** `dispatchTool(def, rawInput)` — validates input via schema, executes, returns stringified result. `ToolRegistry` service holding a map of tools.

**Effect primitives:**
- `Schema.decodeUnknown` — safe runtime input parsing
- `Effect.timeout` — per-tool execution timeout
- `Effect.all({ concurrency })` — parallel tool execution
- `Effect.mapError` — wrap errors in `ToolError`

**Test:** Valid input executes and returns result. Invalid input returns `ParseError`. Timeout fires for slow tools. 2 tools run concurrently.

---

- [ ] **2.3 — The Agent Loop**

**Maps to:** `src/agent-loop.ts`
**Build:** Core loop: send context → collect stream → if tool calls: dispatch all → append results → loop. Otherwise return final message.

```
agentLoop(context, tools, onEvent) → Effect<AssistantMessage, AgentError, LLMProvider>
```

**Effect primitives:**
- `Ref<AgentContext>` — accumulate messages across turns
- `Effect.iterate` / `Effect.loop` — loop until no tool calls
- `Effect.all` with `concurrency: "unbounded"` — parallel tools
- `Stream.runFold` — collect stream into message + tool calls
- `Queue<AgentEvent>` — emit events to caller

**Test:** Agent with a `calculate` tool runs 2 tool turns then returns final text. Events emitted in correct order.

---

- [ ] **2.4 — Message Steering & Interruption**

**Maps to:** `src/agent-loop.ts` (steer/followUp logic), `src/agent.ts`
**Build:** `steer(message)` — interrupt current tool execution, inject message, restart loop. `followUp(message)` — queue message, deliver after agent finishes.

**Effect primitives:**
- `Fiber.interrupt` — cancel in-flight tool execution
- `Effect.fork`, `Fiber.join` — run loop as background fiber
- `Queue.offer` / `Queue.take` — steer message delivery
- `Effect.race` — agent loop vs incoming steer message
- `Deferred` — signal agent completion to waiters

**Test:** Steer mid-tool-execution interrupts and resumes with new message. FollowUp is delivered after all tools finish.

---

- [ ] **2.5 — Agent Class & Public API**

**Maps to:** `src/agent.ts` (the `Agent` class wrapper)
**Build:** `Agent` service wrapping the loop. Methods: `prompt()`, `steer()`, `followUp()`, `clearQueues()`, `abort()`. Exposes `events` stream.

**Effect primitives:**
- `Effect.Service` pattern (class wrapping fibers + queues)
- `PubSub<AgentEvent>` — broadcast events to multiple subscribers
- `Scope` — tie agent lifetime to a scope
- `Effect.scoped` — auto-cleanup on done/error

**Test:** Subscribe two consumers to events. Both receive all events. `abort()` cancels the loop and closes the PubSub.

---

- [ ] **2.6 — Proxy / Transport Abstraction**

**Maps to:** `src/proxy.ts`
**Build:** `AgentTransport` service — decouples agent from how it talks to the LLM. Local = direct `LLMProvider`. Remote = HTTP proxy. Swap via Layer.

**Effect primitives:**
- `HttpClient` from `@effect/platform` — HTTP transport
- `Layer` substitution — swap transport in tests
- `Stream.fromEventSource` — SSE transport for streaming

**Test:** Swap `LocalTransport` for `MockTransport` in tests without changing agent code.

---

### ✅ PROJECT 2 PARITY CHECKLIST
- [ ] Tool dispatch: validation, timeout, parallel execution
- [ ] Agent loop: multi-turn with tool results fed back
- [ ] Steering: interrupt + inject mid-loop
- [ ] FollowUp: queued post-completion delivery
- [ ] Event stream via `PubSub` with multiple consumers
- [ ] Transport layer abstracted behind `AgentTransport` service
- [ ] All test cases from `agent-loop.test.ts` + `agent.test.ts` pass equivalently

Optional add on
- [ ] Add support for durable-stream protocol to client ?

---

## PROJECT 3 — `@pi-effect/coding-agent`
**Parity target:** `packages/coding-agent/src/`
**Goal:** Full CLI coding agent with sessions, tools, extensions, 3 modes.

---

- [ ] **3.1 — Auth Storage**

**Maps to:** `src/core/auth-storage.ts`, test `auth-storage.test.ts`
**Build:** `AuthStorage` service for `~/.pi/agent/auth.json`. Store/retrieve API keys and OAuth tokens. Priority: overrides → file → env.

**Effect primitives:**
- `@effect/platform` `FileSystem` + `Path`
- `Effect.catchTag` — file not found → create empty
- `Ref` — in-memory cache of loaded auth

**Test:** Set key, read it back. In-memory `TestAuthStorage` for unit tests.

---

- [ ] **3.2 — Settings Manager**

**Maps to:** `src/core/settings-manager.ts`, `src/core/resolve-config-value.ts`, tests `settings-manager.test.ts`
**Build:** Cascading settings: defaults < `~/.pi/agent/settings.json` < `.pi/settings.json` < CLI flags. Typed `Settings` schema.

**Effect primitives:**
- `Config` + `ConfigProvider` — load from JSON files
- `Effect.mergeAll` — merge config layers
- `Ref<Settings>` — live settings with hot-reload support

**Test:** CLI flag overrides project setting overrides global. Missing file → use defaults, no error.

---

- [ ] **3.3 — Session Manager (JSONL + Tree)**

**Maps to:** `src/core/session-manager.ts`, `src/core/messages.ts`, all `test/session-manager/` tests
**Build:** Append-only JSONL session files. Each entry has `id` + `parentId`. Methods: `save`, `load`, `branch(fromId)`, `listRecent`, `continueRecent`.

```
~/.pi/agent/sessions/<encoded-cwd>/<uuid>.jsonl
```

**Effect primitives:**
- `Stream.fromReadableStream` + `Stream.splitLines` — JSONL reading
- `Effect.acquireRelease` — file handle open/close
- `Effect.ensuring` — flush on error
- `Ref<SessionTree>` — in-memory tree index

**Test:** Save 5 messages. Load them back. Branch from message 3 → new file with messages 1–3 copied. `listRecent` returns sorted by mtime.

---

- [ ] **3.4 — Model Registry**

**Maps to:** `src/core/model-registry.ts`, `src/core/model-resolver.ts`, tests `model-registry.test.ts`, `model-resolver.test.ts`
**Build:** `ModelRegistry` wrapping `AuthStorage`. `getAvailable()` filters to models with valid API keys. `find(provider, id)` resolves custom models from `models.json`.

**Effect primitives:**
- `Effect.filter` — models with keys
- `Effect.cached` — memoize available models list
- `Layer.effect` with `AuthStorage` dep

**Test:** `getAvailable()` only returns models with valid keys. Custom model from `models.json` resolves. Unknown model → `ModelNotFoundError`.

---

- [ ] **3.5 — File System Tools**

**Maps to:** `src/core/tools/read.ts`, `write.ts`, `edit.ts`, `edit-diff.ts`, `find.ts`, `grep.ts`, `ls.ts`, `truncate.ts`, `path-utils.ts`
**Build:** 7 tools as `ToolDefinition` instances. Input validated via Schema. All use `@effect/platform FileSystem`.

Key constraints to match:
- `read`: truncate large files, image support
- `edit`: patch-based, returns diff
- `bash`: timeout, stream stdout/stderr
- `find`/`grep`: respect `.gitignore`

**Effect primitives:**
- `@effect/platform` `Command` — bash execution
- `Stream.merge` — interleave stdout/stderr
- `Effect.timeout` — bash timeout
- `Effect.acquireRelease` — temp file cleanup

**Test:** Each tool: happy path + error path. `edit` on non-existent file → `FileNotFoundError`. `bash` timeout fires correctly.

---

- [ ] **3.6 — Bash Executor**

**Maps to:** `src/core/bash-executor.ts`, test referenced in `tools.test.ts`
**Build:** Persistent bash session (single shell process, reuse env). Commands streamed, output buffered. Timeout per command.

**Effect primitives:**
- `Effect.acquireRelease` — shell process lifecycle
- `Stream.fromReadableStream` — stdout/stderr as streams
- `Deferred<string>` — signal command completion
- `Semaphore` — one command at a time

**Test:** Run 2 sequential commands in same shell (env var set in cmd1 is visible in cmd2). Timeout kills only the command, not the shell.

---

- [ ] **3.7 — Extension System**

**Maps to:** `src/core/extensions/types.ts`, `loader.ts`, `runner.ts`, `wrapper.ts`, tests `extensions-runner.test.ts`, `extensions-discovery.test.ts`
**Build:** `Extension` interface with lifecycle hooks. `ExtensionLoader` discovers and loads `.ts` files via `jiti`. `ExtensionRunner` fires hooks in order.

Hook events:
- `session:start/end`, `tool:before/after`, `turn:start/end`
- `tool:before` can return `{ block: true }` to cancel

**Effect primitives:**
- `PubSub<HookEvent>` — broadcast to all extensions
- `Effect.forEach` — run hooks sequentially
- `Effect.dynamic import` — `Effect.promise(() => import(path))`
- `Scope` — extension cleanup on session end

**Test:** Hook blocks a tool call. Hook modifies tool result. Two extensions both receive same event.

---

- [ ] **3.8 — Skills System**

**Maps to:** `src/core/skills.ts`, `src/core/resource-loader.ts`, tests `skills.test.ts`, `sdk-skills.test.ts`, fixtures in `test/fixtures/skills/`
**Build:** Skills = markdown files with YAML frontmatter (`name`, `description`). Discovered from: global `~/.pi/agent/skills/`, project `.pi/skills/`, installed packages. Loaded on-demand into system prompt.

**Effect primitives:**
- `Effect.all` with `concurrency: 5` — parallel discovery
- `Effect.cached` — memoize loaded skill content
- `Effect.mapError` — invalid frontmatter → `SkillLoadError`
- `Stream.fromIterable` — iterate skill directories

**Test:** Valid skill loads. Invalid YAML frontmatter → error, not crash. Collision between two skills with same name → project wins.

---

- [ ] **3.9 — System Prompt Builder**

**Maps to:** `src/core/system-prompt.ts`, `src/core/defaults.ts`, test `system-prompt.test.ts`
**Build:** Compose system prompt from: default base, `AGENTS.md` files (walked up from cwd), `SYSTEM.md` (replace or append), active skills, extension injections.

**Effect primitives:**
- `Effect.all` — load all prompt sources in parallel
- `Effect.gen` — compose final string
- `Ref<string[]>` — extensions can append to prompt

**Test:** With `SYSTEM.md` present, base prompt is replaced. `AGENTS.md` in parent dir is included. Skill content appended when loaded.

---

- [ ] **3.10 — Compaction**

**Maps to:** `src/core/compaction/compaction.ts`, `branch-summarization.ts`, `utils.ts`, all `test/compaction*.test.ts`
**Build:** Auto-trigger when context approaches limit. Summarize older messages, keep last N turns. Custom compaction via extensions. Branch summarization for tree sessions.

**Effect primitives:**
- `Effect.when` — conditional compaction trigger
- `Schedule` — retry failed compaction
- `Effect.race` — compaction vs incoming message
- `Chunk.splitAt` — split messages at compaction boundary

**Test:** Context at 90% triggers compaction. Custom extension compaction is called instead of default. Compacted session has correct message count.

---

- [ ] **3.11 — AgentSession (SDK core)**

**Maps to:** `src/core/sdk.ts`, `src/index.ts`, all `test/agent-session-*.test.ts`
**Build:** `AgentSession` — the top-level object tying everything together. Methods: `prompt()`, `branch()`, `compact()`, `setModel()`, `on(event, handler)`. Created via `createAgentSession(options)`.

**Effect primitives:**
- `Effect.Service` with full composition
- `Layer.mergeAll` — compose all subsystems
- `ManagedRuntime` — reuse runtime across prompts
- `Effect.addFinalizer` — session cleanup

**Test:** Full integration: prompt → tool call → tool result → final response. Branch from turn 2 → independent history. Auto-compaction triggers at limit.

---

- [ ] **3.12 — Print Mode**

**Maps to:** `src/modes/print-mode.ts`
**Build:** `-p "message"` flag. Run agent once, stream output to stdout. `--mode json` emits newline-delimited JSON events.

**Effect primitives:**
- `@effect/platform` `Stdout`
- `Stream.tap(event => console.log)` 
- `Effect.scoped` — cleanup after single run

**Test:** Run with mock agent. Assert stdout contains streamed text. `--mode json` output parses as valid JSON events.

---

- [ ] **3.13 — RPC Mode**

**Maps to:** `src/modes/rpc/rpc-types.ts`, `rpc-mode.ts`, `rpc-client.ts`, test `rpc.test.ts`, example `test/rpc-example.ts`
**Build:** JSON protocol over stdin/stdout. Events: `message`, `tool_use`, `tool_result`, `steer`, `done`, `error`. Bidirectional: client sends user messages and tool approvals.

**Effect primitives:**
- `Stream.fromReadableStream` + `Stream.splitLines` — JSONL stdin
- `Channel` — bidirectional stdin/stdout
- `Queue` — buffer incoming RPC messages
- `Effect.fork` — concurrent read loop + agent loop

**Test:** Send message over stdin pipe. Receive streamed events on stdout. Send steer mid-stream → agent redirects.

---

- [ ] **3.14 — Interactive Mode (TUI)**

**Maps to:** `src/modes/interactive/` (all components), `src/core/keybindings.ts`, `src/core/event-bus.ts`
**Build:** Terminal UI. Reuse `pi-tui` primitives (or port key ones). Components: editor, message list, tool execution display, model selector, session picker, footer.

**Effect primitives:**
- `Terminal` from `@effect/platform`
- `Fiber` orchestration: input fiber + render fiber + agent fiber
- `PubSub<UIEvent>` — event bus across components
- `Effect.never` + `Effect.race` — blocking on user input
-  OpenTUI

**Test (lighter):** Editor accepts input. Ctrl+C sends interrupt. `/model` command triggers model selector overlay.

---

- [ ] ** 3.15 — CLI Entry Point & Args**

**Maps to:** `src/main.ts`, `src/cli/args.ts`, tests `args.test.ts`
**Build:** Parse CLI args → route to correct mode. Handle: `-p`, `--mode`, `-c` (continue), `-r` (session picker), `--session`, `--no-session`, `pi install/remove/list/update` package commands.

**Effect primitives:**
- `@effect/cli` — `Command`, `Options`, `Args`
- `Effect.matchCauseEffect` — top-level error handler
- `NodeRuntime.runMain` — signal handling, exit codes
- `Layer` — full app layer composed here

**Test:** Each CLI flag routes to correct mode. Unknown flag → help text. `pi install` runs without starting agent.

---

### ✅ PROJECT 3 PARITY CHECKLIST
- [ ] All 7 file tools with correct error types
- [ ] Persistent bash session with timeout
- [ ] Sessions: JSONL, branching, tree navigation
- [ ] Settings: full cascade, in-memory for tests  
- [ ] Extensions: discovery, loading, hook interception
- [ ] Skills: discovery, collision handling, on-demand loading
- [ ] System prompt: AGENTS.md walk, SYSTEM.md replace/append
- [ ] Compaction: auto-trigger, custom extension, branch
- [ ] `AgentSession`: all test scenarios from `test/agent-session-*.test.ts`
- [ ] Print mode + JSON mode
- [ ] RPC mode: full bidirectional protocol
- [ ] Interactive TUI: editor, streaming, overlays
- [ ] CLI: all flags, all subcommands

---

## Effect Primitives Master Reference

| Primitive | Introduced in |
|---|---|
| `Effect<A,E,R>`, `Effect.gen`, `Effect.tryPromise` | 1.1 |
| `Schema.Struct/Union/Class`, `Data.TaggedError` | 1.1 |
| `Context.Tag`, `Layer.succeed` | 1.2 |
| `Ref<A>` | 1.2 |
| `Layer.effect`, `Effect.orElse/catchTag` | 1.3 |
| `Config`, `ConfigProvider` | 1.3 |
| `Stream<A,E,R>`, `Stream.fromAsyncIterable` | 1.5 |
| `Stream.runCollect/runFold/tap` | 1.5 |
| `Effect.acquireRelease` | 1.6 |
| `Metric.counter/gauge` | 1.7 |
| `Effect.withSpan`, `Tracer` | 1.7 |
| `HttpClient` | 1.8 |
| `Effect.all({ concurrency })` | 2.2 |
| `Effect.timeout` | 2.2 |
| `Effect.iterate/loop` | 2.3 |
| `Queue<A>` | 2.3 |
| `Fiber`, `Effect.fork`, `Fiber.interrupt` | 2.4 |
| `Effect.race` | 2.4 |
| `Deferred<A>` | 2.4 |
| `PubSub<A>` | 2.5 |
| `Effect.scoped`, `Scope` | 2.5 |
| `Semaphore` | 3.6 |
| `Effect.when` | 3.10 |
| `Schedule` | 3.10 |
| `ManagedRuntime` | 3.11 |
| `@effect/cli` `Command/Options/Args` | 3.15 |
| `NodeRuntime.runMain` | 3.15 |
| `Channel` | 3.13 |
