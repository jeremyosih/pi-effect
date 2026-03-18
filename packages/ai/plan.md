# Plan: 1.3 OpenAI Responses First Vertical Slice

## Goal

Implement exactly one real provider end-to-end in `@pi-effect/ai`: OpenAI Responses.

This slice should prove:

- one real provider emits canonical `AssistantMessageEvent`s
- `complete` still derives the final `AssistantMessage` from the same stream
- text deltas, thinking deltas, tool calls, usage, stop reasons, abort, and provider failure behavior all work through the canonical facade

This plan intentionally rewrites the earlier draft.

The earlier draft leaned too hard toward a direct JS port of pi-mono:

- too much setup inside raw `async function*`
- too many plain `throw new Error(...)`
- not enough `Effect.fn(...)`, `Effect.tryPromise(...)`, and `Stream.unwrap(...)`

The local Effect guidance is clear that:

- functions returning effects should prefer `Effect.fn(...)` [docs/smol-effect/LLMS.md](/Users/jeremy/Developer/pi-effect/docs/smol-effect/LLMS.md#L51)
- Promise APIs should use `Effect.tryPromise(...)` [docs/smol-effect/ai-docs/src/01_effect/01_basics/10_creating-effects.ts](/Users/jeremy/Developer/pi-effect/docs/smol-effect/ai-docs/src/01_effect/01_basics/10_creating-effects.ts#L45)
- async iterables should be bridged with `Stream.fromAsyncIterable(...)` [docs/smol-effect/ai-docs/src/02_stream/10_creating-streams.ts](/Users/jeremy/Developer/pi-effect/docs/smol-effect/ai-docs/src/02_stream/10_creating-streams.ts#L62)
- an effect that returns a stream should be turned into a stream with `Stream.unwrap(...)` [docs/effect/packages/effect/src/Stream.ts](/Users/jeremy/Developer/pi-effect/docs/effect/packages/effect/src/Stream.ts#L5502)

## Source of Truth

Behavioral source:

- [docs/pi-mono/packages/ai/src/providers/openai-responses.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses.ts#L61)
- [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts#L38)
- [TODO.md](/Users/jeremy/Developer/pi-effect/TODO.md#L63)

Effect primitives source:

- [docs/smol-effect/LLMS.md](/Users/jeremy/Developer/pi-effect/docs/smol-effect/LLMS.md#L14)
- [docs/smol-effect/ai-docs/src/01_effect/01_basics/10_creating-effects.ts](/Users/jeremy/Developer/pi-effect/docs/smol-effect/ai-docs/src/01_effect/01_basics/10_creating-effects.ts#L45)
- [docs/smol-effect/ai-docs/src/02_stream/10_creating-streams.ts](/Users/jeremy/Developer/pi-effect/docs/smol-effect/ai-docs/src/02_stream/10_creating-streams.ts#L62)
- [docs/effect/packages/effect/src/Stream.ts](/Users/jeremy/Developer/pi-effect/docs/effect/packages/effect/src/Stream.ts#L5502)

## What pi-mono Actually Does

### Provider entry points

pi-mono exposes:

- `streamOpenAIResponses(...)`
- `streamSimpleOpenAIResponses(...)`

Source:

- [docs/pi-mono/packages/ai/src/providers/openai-responses.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses.ts#L61)

The raw path:

1. constructs an empty in-progress `AssistantMessage`
2. builds the OpenAI client
3. builds the Responses payload
4. optionally lets `onPayload` replace the payload
5. calls `client.responses.create(...)`
6. emits canonical `start`
7. translates raw OpenAI Responses events into canonical assistant events
8. emits terminal canonical `done` or `error`

### The hard part is message replay

`convertResponsesMessages(...)` is not a trivial serializer.

It handles:

- system prompt -> `developer` for reasoning models, otherwise `system`
- user string content -> `input_text`
- user image blocks -> `input_image`
- replaying previous assistant thinking blocks via `thinkingSignature`
- replaying previous assistant text blocks via encoded `textSignature`
- replaying assistant tool calls as `function_call`
- replaying tool results as `function_call_output`
- emitting follow-up user image messages for image tool results

Source:

- [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts#L113)

### Tool call IDs are provider-sensitive

pi-mono normalizes tool call IDs for:

- `openai`
- `openai-codex`
- `opencode`

Source:

- [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts#L92)

This normalization is not optional if you want replay back into OpenAI Responses to work.

### The raw stream translation is stateful

`processResponsesStream(...)` in pi-mono mutates:

- the in-progress `AssistantMessage`
- the current raw OpenAI item
- the current block being accumulated

Source:

- [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts#L271)

Important mappings:

- `response.output_item.added` + `reasoning` -> `thinking_start`
- `response.reasoning_summary_text.delta` -> `thinking_delta`
- `response.output_item.done` + `reasoning` -> `thinking_end`
- `response.output_item.added` + `message` -> `text_start`
- `response.output_text.delta` and `response.refusal.delta` -> `text_delta`
- `response.output_item.done` + `message` -> `text_end`
- `response.output_item.added` + `function_call` -> `toolcall_start`
- `response.function_call_arguments.delta` -> `toolcall_delta`
- `response.output_item.done` + `function_call` -> `toolcall_end`
- `response.completed` -> update usage and stop reason
- `error` / `response.failed` -> fail provider processing

### Provider-specific quirks worth preserving

- GPT-5 hack: inject `# Juice: 0 !important` when reasoning is supported but no reasoning options are provided
  Source: [docs/pi-mono/packages/ai/src/providers/openai-responses.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses.ts#L224)
- cached tokens are carved out of `input` into `cacheRead`
  Source: [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts#L421)
- final stop reason may be overridden to `toolUse`
  Source: [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts#L434)
- `service_tier` changes price multipliers, not token counts
  Source: [docs/pi-mono/packages/ai/src/providers/openai-responses.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses.ts#L243)

### Retries

Do not add provider-level retries in this slice.

pi-mono does not retry inside OpenAI Responses. It catches failures and emits terminal canonical `error` events instead:

- [docs/pi-mono/packages/ai/src/providers/openai-responses.ts](/Users/jeremy/Developer/pi-effect/docs/pi-mono/packages/ai/src/providers/openai-responses.ts#L117)

Retry policy, if added later, should be a separate decision.

## Effect-Native Shape

This is the design correction.

### Provider boundary

The provider method should not be one big raw async generator.

Instead:

1. `Effect.fn("OpenAIResponses.prepareStream")`
2. `yield* Effect.tryPromise(...)` for Promise boundaries
3. return `Stream.fromAsyncIterable(...)`
4. expose `Stream.unwrap(prepare(...))`

That gives a clean split:

- `Effect` owns setup and typed errors
- `Stream` owns raw event translation

### Stream primitive choice

Use `Stream.fromAsyncIterable(...)` because the SDK already exposes an `AsyncIterable<ResponseStreamEvent>`:

- [docs/smol-effect/ai-docs/src/02_stream/10_creating-streams.ts](/Users/jeremy/Developer/pi-effect/docs/smol-effect/ai-docs/src/02_stream/10_creating-streams.ts#L62)

Do not start with:

- `Stream.asyncScoped`
- `Queue` + `Stream.fromQueue`

Those are for callback registration or explicit mailboxes. OpenAI Responses already gives the iterable.

### `Effect.tryPromise` boundaries

Use `Effect.tryPromise(...)` for:

- `options.onPayload(...)`
- `client.responses.create(...)`

Do not `await` them inside the raw translation generator.

### Provider stream error channel

For `1.3`, the cleanest first pass is:

```ts
export type ProviderStream = Stream.Stream<AssistantMessageEvent>;
```

Reason:

- `ProviderNotFound` belongs to registry resolution
- reducer errors are unrelated to provider execution
- normal provider failures should surface as canonical terminal `error` events for parity with pi-mono

This addresses the current drift in [packages/ai/src/provider.ts](/Users/jeremy/Developer/pi-effect/packages/ai/src/provider.ts#L12).

### JSON parsing split

Use:

- `partial-json` for incomplete streaming fragments
- `Schema.parseJson(...)` only once you have complete JSON and want schema validation

So the answer to the earlier JSON question is: yes, that split makes sense. No, `Schema.parseJson(...)` should not replace the streaming partial parser.

## Files To Change

- create `packages/ai/src/utils/json-parse.ts`
- replace `packages/ai/src/providers/openai-responses-shared.ts`
- replace `packages/ai/src/providers/openai-responses.ts`
- change `packages/ai/src/provider.ts`
- change `packages/ai/src/index.ts`
- keep `packages/ai/src/stream.ts` unless typing fallout requires a tiny update

## Deferred To 1.5: Client Wrapper

Do not pull this into `1.3`.

It belongs in the config/auth slice, because that is when:

- API key loading moves behind `Config`
- SDK construction stops living inside provider files
- providers depend on a typed client boundary instead of raw `new OpenAI(...)`

This is the v4-shaped wrapper to remember for `1.5`:

```ts
import OpenAI from "openai";
import { Config, Effect, Layer, Redacted, ServiceMap } from "effect";
import * as Errors from "../errors.ts";

export interface OpenAIClientService {
  readonly createResponsesStream: (
    params: OpenAI.Responses.ResponseCreateParamsStreaming,
    options?: { signal?: AbortSignal },
  ) => Effect.Effect<
    AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
    Errors.AuthMissing | Errors.ProviderHttpError
  >;
}

export class OpenAIClient extends ServiceMap.Service<
  OpenAIClient,
  OpenAIClientService
>()("pi-effect/ai/clients/OpenAIClient") {
  static readonly make = Effect.gen(function* () {
    const apiKey = yield* Config.redacted("OPENAI_API_KEY");

    const client = new OpenAI({
      apiKey: Redacted.value(apiKey),
      dangerouslyAllowBrowser: true,
    });

    const createResponsesStream = Effect.fn("OpenAIClient.createResponsesStream")(
      (params: OpenAI.Responses.ResponseCreateParamsStreaming, options?: { signal?: AbortSignal }) =>
        Effect.tryPromise({
          try: () => client.responses.create(params, options),
          catch: (cause) =>
            new Errors.ProviderHttpError({
              provider: "openai",
              status: 0,
              body: cause instanceof Error ? cause.message : String(cause),
            }),
        }),
    );

    return OpenAIClient.of({
      createResponsesStream,
    });
  });

  static readonly layer = Layer.effect(this, this.make);
}
```

Use the client wrapper with named operations, not a generic `use(...)` callback.

That is a better fit for this repo because:

- the provider only needs a small number of concrete SDK operations
- the operation names become better trace/span names
- the provider keeps a stable domain boundary while auth/config concerns move out

## Copy-Paste Snippets

### `packages/ai/src/provider.ts`

```ts
import { Effect, Layer, ServiceMap, Stream } from "effect";
import * as Errors from "./errors.ts";
import type {
  Api,
  AssistantMessageEvent,
  Context,
  ProviderModel,
  SimpleStreamOptions,
  StreamOptions,
} from "./types.ts";

export type ProviderStream = Stream.Stream<AssistantMessageEvent>;

export interface ApiProvider {
  readonly api: Api;
  readonly stream: (
    model: ProviderModel,
    context: Context,
    options?: StreamOptions,
  ) => ProviderStream;
  readonly streamSimple: (
    model: ProviderModel,
    context: Context,
    options?: SimpleStreamOptions,
  ) => ProviderStream;
}

export interface ProviderRegistry {
  readonly resolve: (
    api: Api,
  ) => Effect.Effect<ApiProvider, Errors.ProviderNotFound>;
}

export const ProviderRegistry =
  ServiceMap.Service<ProviderRegistry>("ProviderRegistry");

export const makeProviderRegistry = (providers: ReadonlyArray<ApiProvider>) => {
  const providersByApi = new Map<Api, ApiProvider>(
    providers.map((provider) => [provider.api, provider]),
  );

  return {
    resolve: (api: Api) =>
      Effect.gen(function* () {
        const provider = providersByApi.get(api);
        if (provider === undefined) {
          return yield* new Errors.ProviderNotFound({ api });
        }
        return provider;
      }),
  };
};

export const ProviderRegistryLive = (providers: ReadonlyArray<ApiProvider>) =>
  Layer.succeed(ProviderRegistry, makeProviderRegistry(providers));
```

### `packages/ai/src/utils/json-parse.ts`

```ts
import { Effect, Schema as S } from "effect";
import { parse as partialParse } from "partial-json";

export const parseStreamingJson = <T = Record<string, unknown>>(
  partialJson: string | undefined,
): T => {
  if (!partialJson || partialJson.trim() === "") {
    return {} as T;
  }

  try {
    return JSON.parse(partialJson) as T;
  } catch {
    try {
      return (partialParse(partialJson) ?? {}) as T;
    } catch {
      return {} as T;
    }
  }
};

export const decodeJsonWithSchema = Effect.fn("JsonParse.decodeJsonWithSchema")(
  <A, I, R>(schema: S.Schema<A, I, R>, json: string) =>
    S.decodeUnknown(S.parseJson(schema))(json),
);
```

### `packages/ai/src/providers/openai-responses-shared.ts`

This file should stay mostly plain translation logic. It does not need to be “Effect everywhere”.

```ts
import type {
  ResponseFunctionToolCall,
  ResponseOutputMessage,
  ResponseReasoningItem,
  ResponseStreamEvent,
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputText,
  ResponseOutputMessage as OpenAIResponseOutputMessage,
  Tool as OpenAITool,
} from "openai/resources/responses/responses.js";
import * as Errors from "../errors.ts";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  OpenAIResponsesModel,
  StopReason,
  Tool,
  ToolCall,
  ToolResult,
  Usage,
} from "../types.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";

type TextSignaturePhase = "commentary" | "final_answer";
type TextSignatureV1 = {
  v: 1;
  id: string;
  phase?: TextSignaturePhase;
};

const OPENAI_TOOL_CALL_PROVIDERS = new Set([
  "openai",
  "openai-codex",
  "opencode",
]);

export interface OpenAIResponsesStreamOptions {
  readonly serviceTier?: "auto" | "default" | "flex" | "priority";
  readonly applyServiceTierPricing?: (
    usage: Usage,
    serviceTier: OpenAIResponsesStreamOptions["serviceTier"] | undefined,
  ) => void;
}

const providerProtocolError = (
  model: OpenAIResponsesModel,
  message: string,
) =>
  new Errors.ProviderProtocolError({
    provider: model.provider,
    message,
  });

const encodeTextSignatureV1 = (
  id: string,
  phase?: TextSignaturePhase,
): string => JSON.stringify(phase ? { v: 1, id, phase } : { v: 1, id });

const parseTextSignature = (
  signature: string | undefined,
): { id: string; phase?: TextSignaturePhase } | undefined => {
  if (!signature) {
    return undefined;
  }

  if (signature.startsWith("{")) {
    try {
      const parsed = JSON.parse(signature) as Partial<TextSignatureV1>;
      if (parsed.v === 1 && typeof parsed.id === "string") {
        if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
          return { id: parsed.id, phase: parsed.phase };
        }
        return { id: parsed.id };
      }
    } catch {
      // fall through
    }
  }

  return { id: signature };
};

const normalizeToolCallId = (provider: string, id: string): string => {
  if (!OPENAI_TOOL_CALL_PROVIDERS.has(provider) || !id.includes("|")) {
    return id;
  }

  const [callId, itemId] = id.split("|");
  const sanitize = (value: string) =>
    value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64).replace(/_+$/, "");

  const normalizedCallId = sanitize(callId);
  const normalizedItemId = sanitize(
    itemId.startsWith("fc_") ? itemId : `fc_${itemId}`,
  );

  return `${normalizedCallId}|${normalizedItemId}`;
};

const mapStopReason = (
  status:
    | "completed"
    | "incomplete"
    | "failed"
    | "cancelled"
    | "in_progress"
    | "queued"
    | undefined,
): StopReason => {
  switch (status) {
    case "incomplete":
      return "length";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "stop";
  }
};

export const convertResponsesMessages = (
  model: OpenAIResponsesModel,
  context: Context,
): ResponseInput => {
  // Keep this as a direct, explicit port of pi-mono.
  // The important behaviors to preserve are:
  // - developer/system role switching
  // - replay of thinkingSignature
  // - replay of textSignature
  // - tool call id normalization
  // - synthetic tool result fallback for orphaned tool calls
  return [] as ResponseInput;
};

export const convertResponsesTools = (
  tools: ReadonlyArray<Tool>,
): Array<OpenAITool> =>
  tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as never,
    strict: false,
  }));

export const processResponsesStream = async function* (
  raw: AsyncIterable<ResponseStreamEvent>,
  output: AssistantMessage,
  model: OpenAIResponsesModel,
  options?: OpenAIResponsesStreamOptions,
): AsyncIterable<AssistantMessageEvent> {
  let currentItem:
    | ResponseReasoningItem
    | ResponseOutputMessage
    | ResponseFunctionToolCall
    | null = null;

  let currentToolCallJson = "";

  const blockIndex = () => output.content.length - 1;

  for await (const event of raw) {
    if (event.type === "response.output_item.added") {
      if (event.item.type === "reasoning") {
        currentItem = event.item;
        output.content.push({ type: "thinking", thinking: "" });
        yield {
          type: "thinking_start",
          contentIndex: blockIndex() as never,
          partial: output,
        };
        continue;
      }

      if (event.item.type === "message") {
        currentItem = event.item;
        output.content.push({ type: "text", text: "" });
        yield {
          type: "text_start",
          contentIndex: blockIndex() as never,
          partial: output,
        };
        continue;
      }

      if (event.item.type === "function_call") {
        currentItem = event.item;
        currentToolCallJson = event.item.arguments || "";
        output.content.push({
          type: "toolCall",
          id: `${event.item.call_id}|${event.item.id}`,
          name: event.item.name,
          arguments: {},
        });
        yield {
          type: "toolcall_start",
          contentIndex: blockIndex() as never,
          partial: output,
        };
        continue;
      }
    }

    if (event.type === "response.output_text.delta") {
      const block = output.content[blockIndex()];
      if (block?.type === "text") {
        block.text += event.delta;
        yield {
          type: "text_delta",
          contentIndex: blockIndex() as never,
          delta: event.delta,
          partial: output,
        };
      }
      continue;
    }

    if (event.type === "response.refusal.delta") {
      const block = output.content[blockIndex()];
      if (block?.type === "text") {
        block.text += event.delta;
        yield {
          type: "text_delta",
          contentIndex: blockIndex() as never,
          delta: event.delta,
          partial: output,
        };
      }
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const block = output.content[blockIndex()];
      if (block?.type === "toolCall") {
        currentToolCallJson += event.delta;
        block.arguments = parseStreamingJson(currentToolCallJson);
        yield {
          type: "toolcall_delta",
          contentIndex: blockIndex() as never,
          delta: event.delta,
          partial: output,
        };
      }
      continue;
    }

    if (event.type === "response.output_item.done") {
      if (event.item.type === "message") {
        const block = output.content[blockIndex()];
        if (block?.type === "text") {
          block.textSignature = encodeTextSignatureV1(
            event.item.id,
            event.item.phase === "commentary" || event.item.phase === "final_answer"
              ? event.item.phase
              : undefined,
          ) as never;
          yield {
            type: "text_end",
            contentIndex: blockIndex() as never,
            content: block.text,
            partial: output,
          };
        }
        continue;
      }

      if (event.item.type === "function_call") {
        const toolCall: ToolCall = {
          type: "toolCall",
          id: `${event.item.call_id}|${event.item.id}`,
          name: event.item.name,
          arguments: parseStreamingJson(
            currentToolCallJson || event.item.arguments || "{}",
          ),
        };

        yield {
          type: "toolcall_end",
          contentIndex: blockIndex() as never,
          toolCall,
          partial: output,
        };
        continue;
      }
    }

    if (event.type === "response.completed") {
      const cachedTokens =
        event.response?.usage?.input_tokens_details?.cached_tokens || 0;

      output.usage = {
        input: ((event.response?.usage?.input_tokens || 0) - cachedTokens) as never,
        output: (event.response?.usage?.output_tokens || 0) as never,
        cacheRead: cachedTokens as never,
        cacheWrite: 0 as never,
        totalTokens: (event.response?.usage?.total_tokens || 0) as never,
        cost: {
          input: 0 as never,
          output: 0 as never,
          cacheRead: 0 as never,
          cacheWrite: 0 as never,
        },
      };

      if (options?.applyServiceTierPricing) {
        options.applyServiceTierPricing(
          output.usage,
          event.response?.service_tier ?? options.serviceTier,
        );
      }

      output.stopReason = mapStopReason(event.response?.status as never);
      if (
        output.stopReason === "stop" &&
        output.content.some((block) => block.type === "toolCall")
      ) {
        output.stopReason = "toolUse";
      }

      continue;
    }

    if (event.type === "error") {
      throw providerProtocolError(
        model,
        event.message
          ? `Error Code ${event.code}: ${event.message}`
          : "Unknown error",
      );
    }

    if (event.type === "response.failed") {
      const error = event.response?.error;
      const details = event.response?.incomplete_details;
      throw providerProtocolError(
        model,
        error
          ? `${error.code || "unknown"}: ${error.message || "no message"}`
          : details?.reason
            ? `incomplete: ${details.reason}`
            : "Unknown error (no error details in response)",
      );
    }
  }
};
```

Notes:

- `convertResponsesMessages(...)` is intentionally left as the one place where a near-direct pi-mono port is acceptable. It is deterministic data transformation, not the Effect boundary.
- `processResponsesStream(...)` is intentionally an `async function*`, because its job is only raw iterable -> canonical event translation.

### `packages/ai/src/providers/openai-responses.ts`

This is the core rewrite.

```ts
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { Effect, Stream } from "effect";
import * as Errors from "../errors.ts";
import type { ApiProvider } from "../provider.ts";
import type {
  AssistantMessage,
  Context,
  OpenAIResponsesModel,
  ProviderModel,
  SimpleStreamOptions,
  StreamOptions,
} from "../types.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from "./openai-responses-shared.ts";

export interface OpenAIResponsesOptions extends StreamOptions {
  readonly reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly reasoningSummary?: "auto" | "detailed" | "concise" | null;
  readonly serviceTier?: ResponseCreateParamsStreaming["service_tier"];
}

export interface OpenAIResponsesRuntime {
  readonly now: () => number;
  readonly createClient: (
    model: OpenAIResponsesModel,
    apiKey: string,
    headers?: Record<string, string>,
  ) => OpenAI;
}

const defaultRuntime: OpenAIResponsesRuntime = {
  now: () => Date.now(),
  createClient: (model, apiKey, headers) =>
    new OpenAI({
      apiKey,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        ...model.headers,
        ...headers,
      },
    }),
};

const clampReasoning = (
  reasoning: SimpleStreamOptions["reasoning"],
): OpenAIResponsesOptions["reasoningEffort"] =>
  reasoning === "xhigh" ? "high" : reasoning;

const makeEmptyAssistantMessage = (
  model: OpenAIResponsesModel,
  now: number,
): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0 as never,
    output: 0 as never,
    cacheRead: 0 as never,
    cacheWrite: 0 as never,
    totalTokens: 0 as never,
    cost: {
      input: 0 as never,
      output: 0 as never,
      cacheRead: 0 as never,
      cacheWrite: 0 as never,
    },
  },
  stopReason: "stop",
  timestamp: now as never,
});

const requireApiKey = Effect.fn("OpenAIResponses.requireApiKey")(
  function*(model: OpenAIResponsesModel, options?: StreamOptions) {
    if (options?.apiKey) {
      return options.apiKey;
    }

    return yield* new Errors.AuthMissing({
      provider: model.provider,
    });
  },
);

const buildParams = (
  model: OpenAIResponsesModel,
  context: Context,
  options?: OpenAIResponsesOptions,
): ResponseCreateParamsStreaming => {
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    input: convertResponsesMessages(model, context),
    stream: true,
    store: false,
  };

  if (options?.maxTokens !== undefined) {
    params.max_output_tokens = options.maxTokens;
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  if (options?.serviceTier !== undefined) {
    params.service_tier = options.serviceTier;
  }

  if (context.tools) {
    params.tools = convertResponsesTools(context.tools);
  }

  if (model.reasoning && (options?.reasoningEffort || options?.reasoningSummary)) {
    params.reasoning = {
      effort: options.reasoningEffort || "medium",
      summary: options.reasoningSummary || "auto",
    };
    params.include = ["reasoning.encrypted_content"];
  }

  return params;
};

const prepareOpenAIResponsesStream = Effect.fn("OpenAIResponses.prepareStream")(
  function* (
    runtime: OpenAIResponsesRuntime,
    model: OpenAIResponsesModel,
    context: Context,
    options?: OpenAIResponsesOptions,
  ) {
    const apiKey = yield* requireApiKey(model, options);
    const client = runtime.createClient(model, apiKey, options?.headers);
    const output = makeEmptyAssistantMessage(model, runtime.now());

    let params = buildParams(model, context, options);

    if (options?.onPayload) {
      const nextParams = yield* Effect.tryPromise({
        try: () => options.onPayload!(params, model),
        catch: (cause) =>
          new Errors.ProviderProtocolError({
            provider: model.provider,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      if (nextParams !== undefined) {
        params = nextParams as ResponseCreateParamsStreaming;
      }
    }

    const raw = yield* Effect.tryPromise({
      try: () =>
        client.responses.create(
          params,
          options?.signal ? { signal: options.signal } : undefined,
        ),
      catch: (cause) =>
        new Errors.ProviderHttpError({
          provider: model.provider,
          status: 0,
          body: cause instanceof Error ? cause.message : String(cause),
        }),
    });

    async function* emitEvents() {
      yield { type: "start", partial: output } as const;

      try {
        yield* processResponsesStream(raw, output, model, {
          serviceTier: options?.serviceTier,
        });

        yield {
          type: "done",
          reason: output.stopReason,
          message: output,
        } as const;
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        output.errorMessage =
          error instanceof Error ? error.message : String(error);

        yield {
          type: "error",
          reason: output.stopReason,
          error: output,
        } as const;
      }
    }

    return Stream.fromAsyncIterable(
      emitEvents(),
      (cause) =>
        new Errors.ProviderProtocolError({
          provider: model.provider,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    );
  },
);

export const makeOpenAIResponsesProvider = (
  runtime: OpenAIResponsesRuntime = defaultRuntime,
): ApiProvider => ({
  api: "openai-responses",
  stream: (model, context, options) =>
    Stream.unwrap(
      prepareOpenAIResponsesStream(
        runtime,
        model as OpenAIResponsesModel,
        context,
        options as OpenAIResponsesOptions | undefined,
      ),
    ),
  streamSimple: (model, context, options) =>
    Stream.unwrap(
      prepareOpenAIResponsesStream(
        runtime,
        model as OpenAIResponsesModel,
        context,
        {
          ...(options ?? {}),
          reasoningEffort: clampReasoning(options?.reasoning),
        },
      ),
    ),
});

export const OpenAIResponsesProvider = makeOpenAIResponsesProvider();
```

### `packages/ai/src/index.ts`

```ts
export * from "./types.ts";
export * from "./errors.ts";
export * from "./provider.ts";
export * from "./stream.ts";
export * from "./utils/assistant-events.ts";
export * from "./utils/json-parse.ts";
export * from "./providers/openai-responses.ts";
```

## Event Mapping Checklist

`processResponsesStream(...)` should implement this mapping:

- `response.output_item.added` + `reasoning` -> `thinking_start`
- `response.reasoning_summary_text.delta` -> `thinking_delta`
- `response.output_item.done` + `reasoning` -> `thinking_end`
- `response.output_item.added` + `message` -> `text_start`
- `response.output_text.delta` -> `text_delta`
- `response.refusal.delta` -> `text_delta`
- `response.output_item.done` + `message` -> `text_end`
- `response.output_item.added` + `function_call` -> `toolcall_start`
- `response.function_call_arguments.delta` -> `toolcall_delta`
- `response.output_item.done` + `function_call` -> `toolcall_end`
- `response.completed` -> update usage and stop reason only
- terminal canonical `done` / `error` are emitted by `openai-responses.ts`, not by the shared translator

## Test Plan

### Provider translator test

Add:

- `packages/ai/src/providers/openai-responses-shared.test.ts`

Test:

- text-only stream
- reasoning stream
- tool call partial JSON stream
- cached token usage remapping
- `toolUse` stop reason override
- raw `response.failed` path

### Provider boundary test

Add:

- `packages/ai/src/providers/openai-responses.test.ts`

Use a fake runtime:

- `createClient(...)` returns a fake `responses.create(...)`
- `responses.create(...)` returns an async iterable of raw OpenAI events

Assert:

- `stream(...)` exposes canonical events
- `streamSimple(...)` uses normalized reasoning mapping
- setup failure becomes terminal canonical `error`
- abort becomes terminal canonical `error` with `reason: "aborted"`

### Public facade test

Extend the existing stream facade test so it can use:

```ts
const layer = ProviderRegistryLive([
  makeOpenAIResponsesProvider(fakeRuntime),
]);
```

Then assert:

- `stream(...)` exposes canonical events unchanged
- `complete(...)` returns the same final assistant message
- `completeSimple(...)` goes through the simple path

## Implementation Order

1. narrow `ProviderStream` in `provider.ts`
2. add `utils/json-parse.ts`
3. implement `openai-responses-shared.ts` helper layer
4. implement `prepareOpenAIResponsesStream` in `openai-responses.ts`
5. wire `stream` and `streamSimple` with `Stream.unwrap(...)`
6. export from `index.ts`
7. add provider tests
8. extend public facade tests

## Summary

The main design correction is simple:

- keep translation in `async function*`
- move setup into `Effect.fn(...)`
- wrap Promise boundaries with `Effect.tryPromise(...)`
- return the provider stream with `Stream.unwrap(...)`

That stays faithful to pi-mono behavior while actually looking like Effect code.
