# OpenAI Responses Slice Research

## 1. smol-effect AI overview

smol-effect exposes a provider-agnostic AI stack centered on `LanguageModel`, plus `Toolkit`, `Chat`, `AiError`, and `Model`.

- The guide entrypoint explicitly frames the AI modules as provider-agnostic text, object, and stream generation in `docs/smol-effect/LLMS.md:309-323`.
- The `LanguageModel` example shows the intended app-level story: configure a provider layer once, then call `LanguageModel.generateText`, `LanguageModel.generateObject`, or `LanguageModel.streamText` from services built with `ServiceMap.Service` and `Layer.effect` in `docs/smol-effect/ai-docs/src/71_ai/10_language-model.ts:77-139`.
- The tools guide adds `Tool.make`, `Toolkit.make`, and `toolkit.toLayer(...)` so tool schemas and handlers are modeled as typed services, then passed into `LanguageModel.generateText` in `docs/smol-effect/ai-docs/src/71_ai/20_tools.ts:20-126`.
- The chat module adds a stateful history layer on top of the same provider-agnostic language-model core in `docs/smol-effect/packages/effect/src/unstable/ai/Chat.ts:1-220`.
- The `Model` abstraction packages a provider name plus a `Layer` that provides the chosen AI services, and also injects provider/model identity into the environment in `docs/smol-effect/packages/effect/src/unstable/ai/Model.ts:1-162`.
- `AiError` is the canonical provider-agnostic error wrapper with semantic reasons like auth, rate-limit, malformed output, tool validation, and network failures in `docs/smol-effect/packages/effect/src/unstable/ai/AiError.ts:1-220`.

Takeaway: smol-effect is not a per-provider adapter registry like pi-mono. It is a higher-level provider-agnostic language-model runtime with layers, typed toolkits, structured output, and semantic AI errors.

## 2. how smol-effect actually works internally

The important internal split is in `docs/effect/packages/ai/ai/src/LanguageModel.ts:556-740`.

- Provider implementations do **not** implement tool resolution, structured output orchestration, or chat semantics themselves. They only provide low-level `generateText` and `streamText` hooks to `LanguageModel.make(...)` at `docs/effect/packages/ai/ai/src/LanguageModel.ts:564-565`.
- `LanguageModel.make(...)` builds the public service interface itself. It allocates mutable provider options, applies prompt/tool/response-format transformation, resolves tool calls, decodes response parts, wires tracing spans, and maps malformed output into AI errors.
- Internal state is intentionally mutable:
  - `Mutable<ProviderOptions>` is used while normalizing requests at `docs/effect/packages/ai/ai/src/LanguageModel.ts:596-602` and again for streaming at `docs/effect/packages/ai/ai/src/LanguageModel.ts:692-698`.
  - `Schema.mutable(...)` is used when decoding mutable response collections and parts at `docs/effect/packages/ai/ai/src/LanguageModel.ts:751-775`.
- The public streaming function itself uses `Stream.unwrap(...)`, not `Effect<Stream>`, at `docs/effect/packages/ai/ai/src/LanguageModel.ts:986`. That matters for `@pi-effect/ai`: keeping provider functions as plain `Stream` is fully compatible with Effect-native internals.

Takeaway: the key smol-effect lesson for this slice is not "import `LanguageModel`". It is "keep public stream APIs plain, keep provider-specific transport at the edge, and use local mutable accumulators internally when schema-driven readonly outputs would otherwise make the reducer impossible."

## 3. how pi-mono AI works

pi-mono has a different abstraction boundary.

- The public API is a thin facade over a provider registry in `docs/pi-mono/packages/ai/src/stream.ts:1-46`.
- Each provider adapter emits canonical assistant events. `openai-responses.ts` creates the initial assistant message, builds request params, opens the provider stream, and emits `start`, then body events, then terminal `done` or `error` in `docs/pi-mono/packages/ai/src/providers/openai-responses.ts:61-127`.
- Provider-specific replay/payload conversion lives in `openai-responses-shared.ts`, which converts canonical messages/tools into OpenAI Responses input and reduces raw Responses SSE events into canonical assistant events in `docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts:1-277` and `docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts:277-470`.
- The in-flight canonical output is mutable in the reducer: `output.content.push(...)`, `currentBlock.text += ...`, `output.usage = ...`, and `output.stopReason = ...` all happen inside `processResponsesStream(...)` at `docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts:289-468`.
- pi-mono also uses a custom queue-backed async event stream wrapper in `docs/pi-mono/packages/ai/src/utils/event-stream.ts:1-79` rather than Effect `Stream`.

Takeaway: pi-mono is a canonical event-normalization layer with provider adapters, not a provider-agnostic language-model runtime. For parity, `@pi-effect/ai` should keep that architecture and only replace the transport/runtime seams with Effect-native ones.

## 4. current local gap analysis

The local OpenAI Responses port is structurally close to pi-mono, but it is broken at the exact seams where local Effect v4 beta types differ from pi-mono.

### 4.1 readonly canonical schema vs mutable reducer

- Canonical assistant messages, usage, and content are schema-derived and readonly in `packages/ai/src/types.ts:330-384`.
- The current reducer still mutates them directly:
  - `output.content.push(...)` and block mutation in `packages/ai/src/providers/openai/responses-shared.ts:366-531`
  - `output.usage = ...` and `output.stopReason = ...` in `packages/ai/src/providers/openai/responses-shared.ts:569-598`
  - `output.stopReason = ...` and `output.errorMessage = ...` in `packages/ai/src/providers/openai/responses.ts:169-184`

This is the main break. pi-mono’s plain interfaces tolerate this; local schema-derived types do not.

### 4.2 Effect v3 API drift

- `responses.ts` still uses static `Effect.catchAll(...)` at `packages/ai/src/providers/openai/responses.ts:210-243`.
- The repo is pinned to `effect@4.0.0-beta.31` in `package.json:18`, and local typecheck reports that `catchAll` is an outdated API for this setup.

This means the provider is not just type-incorrect; it is using the wrong Effect API shape for the installed beta.

### 4.3 provider contract mismatch

- Public provider functions still return plain `Stream` in `packages/ai/src/provider.ts:14-26`.
- The current OpenAI provider implementation is strongly typed to `OpenAIResponsesModel` in `packages/ai/src/providers/openai/responses.ts:187-193`, then exported as a plain `ApiProvider` at the bottom of the file.

That causes assignment friction because registry dispatch is generic by `api`, while the concrete implementation is narrowed to one API.

### 4.4 exact optional-property bugs on OpenAI wire types

- `phase: parsedSignature?.phase` is emitted in `packages/ai/src/providers/openai/responses-shared.ts:226-239`
- `id: itemId` is emitted in `packages/ai/src/providers/openai/responses-shared.ts:252-258`

Under `exactOptionalPropertyTypes`, these are wrong when the value is `undefined`. The OpenAI SDK types expect omission or a non-undefined value.

### 4.5 client bug at the transport boundary

- `packages/ai/src/providers/openai/client.ts:34-59` has two concrete issues:
  - the service identifier string is malformed (`pi/ai/clients/OPenAIClient`)
  - the `Effect.tryPromise` `catch` mapper constructs `ProviderHttpError` but does not return it

That makes the client error type collapse incorrectly and is the direct reason local typecheck reports `void` in the error channel.

### 4.6 JSON boundary split

- pi-mono’s `parseStreamingJson(...)` is intentionally permissive and best-effort in `docs/pi-mono/packages/ai/src/utils/json-parse.ts:1-24`
- local `json-parse.ts` already adds a strict completed-string decoder via `Schema.fromJsonString(...)` in `packages/ai/src/utils/json-parse.ts:1-30`
- because the repo is pinned to `effect@4.0.0-beta.31`, the right helper is `Schema.fromJsonString(...)` from `docs/smol-effect/packages/effect/src/Schema.ts:8702` and the installed package, not `Schema.parseJson(...)` from newer Effect docs

Takeaway: the split should be:

- partial streaming args: permissive `partial-json`
- completed tool-call args: strict `Schema.fromJsonString(Schema.Record(...))`

## 5. recommendation

Preserve pi-mono branch behavior and event semantics. Do **not** rewrite this slice onto `effect/unstable/ai/LanguageModel`, `Toolkit`, or `Chat`.

The lowest-risk fix is:

1. keep the public `ApiProvider` contract unchanged as plain `Stream`
2. keep the current OpenAI Responses adapter split (`responses.ts` + `responses-shared.ts`)
3. make the provider transport boundary Effect-native with `ServiceMap.Service`, `Layer.effect`, `Effect.fn`, `Effect.tryPromise`, and `Stream.unwrap(...)`
4. move mutable in-flight state into private reducer accumulators so canonical schema types stay readonly
5. use Effect `Stream.fromAsyncIterable(...)` instead of pi-mono’s custom `EventStream`
6. use `Schema.fromJsonString(...)` only at the completed JSON boundary

This matches:

- smol-effect’s lesson about internal mutability plus plain public `Stream` APIs
- pi-mono’s adapter architecture and branch behavior
- the local repo’s current public `stream` / `complete` facade in `packages/ai/src/stream.ts:12-65`

So the fix should be an adapter-boundary correction, not an architectural rewrite.
