import { Cause, Effect, Exit, Stream } from "effect";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import * as Errors from "../../errors.ts";
import type { ApiProvider } from "../../provider.ts";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  CacheRetention,
  Context,
  OpenAIResponsesModel,
  SimpleStreamOptions,
  StreamOptions,
  ToolCall,
  Usage,
} from "../../types.ts";
import { assistantMessageFromEvent } from "../../utils/assistant-events.ts";
import { supportsXhigh } from "../../models.ts";
import {
  buildCopilotDynamicHeaders,
  hasCopilotVisionInput,
} from "../github-copilot-headers.ts";
import { buildBaseOptions, clampReasoning } from "../simple-options.ts";
import { OpenAIClient } from "./client.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesEvents,
} from "./responses-shared.ts";

const OPENAI_TOOL_CALL_PROVIDERS = new Set([
  "openai",
  "openai-codex",
  "opencode",
]);

export interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "detailed" | "concise" | null;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
}

type DoneReason = Extract<AssistantMessageEvent, { type: "done" }>["reason"];
type ErrorReason = Extract<AssistantMessageEvent, { type: "error" }>["reason"];

function resolveCacheRetention(
  cacheRetention?: CacheRetention,
): CacheRetention {
  if (cacheRetention) {
    return cacheRetention;
  }

  if (
    typeof process !== "undefined" &&
    process.env.PI_CACHE_RETENTION === "long"
  ) {
    return "long";
  }

  return "short";
}

function getPromptCacheRetention(
  baseUrl: string,
  cacheRetention: CacheRetention,
): "24h" | undefined {
  if (cacheRetention !== "long") {
    return undefined;
  }

  if (baseUrl.includes("api.openai.com")) {
    return "24h";
  }

  return undefined;
}

function makeEmptyAssistantMessage(
  model: OpenAIResponsesModel,
): AssistantMessage {
  return {
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
        total: 0 as never,
      },
    },
    stopReason: "stop",
    timestamp: Date.now() as never,
  };
}

function finalizeAssistantMessage(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type !== "toolCall") {
        return block;
      }

      const { partialJson: _partialJson, ...toolCall } = block as ToolCall & {
        partialJson?: string;
      };

      return toolCall as typeof block;
    }) as AssistantMessage["content"],
  };
}

function buildRequestHeaders(
  model: OpenAIResponsesModel,
  context: Context,
  optionHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(model.headers ?? {}),
  };

  if (model.provider === "github-copilot") {
    const hasImages = hasCopilotVisionInput(context.messages);
    Object.assign(
      headers,
      buildCopilotDynamicHeaders({
        messages: context.messages,
        hasImages,
      }),
    );
  }

  if (optionHeaders) {
    Object.assign(headers, optionHeaders);
  }

  return headers;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Errors.AuthMissing) {
    return `No API key for provider: ${error.provider}`;
  }

  if (error instanceof Errors.ProviderHttpError) {
    return error.body ?? `Provider HTTP error: ${error.status}`;
  }

  if (error instanceof Errors.ProviderProtocolError) {
    return error.message;
  }

  if (error instanceof Errors.Aborted) {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function toErrorEvent(
  message: AssistantMessage,
  signal: AbortSignal | undefined,
  error: unknown,
): Extract<AssistantMessageEvent, { type: "error" }> {
  const reason: ErrorReason =
    signal?.aborted || error instanceof Errors.Aborted ? "aborted" : "error";

  return {
    type: "error",
    reason,
    error: finalizeAssistantMessage({
      ...message,
      stopReason: reason,
      errorMessage: toErrorMessage(error),
    } as AssistantMessage),
  };
}

function buildParams(
  model: OpenAIResponsesModel,
  context: Context,
  options?: OpenAIResponsesOptions,
): ResponseCreateParamsStreaming {
  const messages = convertResponsesMessages(
    model,
    context,
    OPENAI_TOOL_CALL_PROVIDERS,
  );

  const cacheRetention = resolveCacheRetention(options?.cacheRetention);
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    input: messages,
    stream: true,
    store: false,
  };

  if (cacheRetention !== "none" && options?.sessionId !== undefined) {
    params.prompt_cache_key = options.sessionId;
  }

  const promptCacheRetention = getPromptCacheRetention(
    model.baseUrl,
    cacheRetention,
  );
  if (promptCacheRetention !== undefined) {
    params.prompt_cache_retention = promptCacheRetention;
  }

  if (options?.maxTokens !== undefined) {
    params.max_output_tokens = options.maxTokens;
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  if (options?.serviceTier !== undefined) {
    params.service_tier = options.serviceTier;
  }

  if (context.tools && context.tools.length > 0) {
    params.tools = convertResponsesTools(context.tools);
  }

  if (model.reasoning) {
    if (
      options?.reasoningEffort !== undefined ||
      options?.reasoningSummary !== undefined
    ) {
      params.reasoning = {
        effort: options?.reasoningEffort ?? "medium",
        summary: options?.reasoningSummary ?? "auto",
      };
      params.include = ["reasoning.encrypted_content"];
    } else if (model.name.startsWith("gpt-5")) {
      messages.push({
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "# Juice: 0 !important",
          },
        ],
      });
    }
  }

  return params;
}

function getServiceTierCostMultiplier(
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): number {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
      return 2;
    default:
      return 1;
  }
}

function applyServiceTierPricing(
  usage: Usage,
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): Usage {
  const multiplier = getServiceTierCostMultiplier(serviceTier);
  if (multiplier === 1) {
    return usage;
  }

  const cost = {
    ...usage.cost,
    input: (usage.cost.input * multiplier) as typeof usage.cost.input,
    output: (usage.cost.output * multiplier) as typeof usage.cost.output,
    cacheRead: (usage.cost.cacheRead * multiplier) as typeof usage.cost.cacheRead,
    cacheWrite: (usage.cost.cacheWrite * multiplier) as typeof usage.cost.cacheWrite,
    total: (
      (usage.cost.input +
        usage.cost.output +
        usage.cost.cacheRead +
        usage.cost.cacheWrite) *
      multiplier
    ) as NonNullable<typeof usage.cost.total>,
  };

  return {
    ...usage,
    cost,
  } as Usage;
}

const streamOpenAIResponsesInternal = (
  model: OpenAIResponsesModel,
  context: Context,
  options?: OpenAIResponsesOptions,
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const initialMessage = makeEmptyAssistantMessage(model);

      if (options?.signal?.aborted) {
        return Stream.make(
          toErrorEvent(
            initialMessage,
            options.signal,
            new Errors.Aborted({ message: "Request was aborted" }),
          ),
        );
      }

      const prepared = yield* Effect.exit(Effect.gen(function* () {
        const client = yield* OpenAIClient;
        let params = buildParams(model, context, options);

        const nextParams = yield* Effect.tryPromise({
          try: () => Promise.resolve(options?.onPayload?.(params, model)),
          catch: (cause) =>
            new Errors.ProviderProtocolError({
              provider: model.provider,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

        if (nextParams !== undefined) {
          params = nextParams as ResponseCreateParamsStreaming;
        }

        const requestInput = {
          provider: model.provider,
          baseUrl: model.baseUrl,
          defaultHeaders: buildRequestHeaders(model, context, options?.headers),
          params,
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
          ...(options?.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        };

        const openaiStream = yield* client.createResponsesStream(requestInput);
        return { openaiStream };
      }));

      if (Exit.isFailure(prepared)) {
        return Stream.make(
          toErrorEvent(
            initialMessage,
            options?.signal,
            Cause.squash(prepared.cause),
          ),
        );
      }

      const events = (async function* (): AsyncGenerator<
        AssistantMessageEvent,
        void,
        void
      > {
        let latestMessage = initialMessage;
        yield { type: "start", partial: latestMessage };

        try {
          const iterator = processResponsesEvents(
            prepared.value.openaiStream,
            initialMessage,
            model,
            {
              serviceTier: options?.serviceTier,
              applyServiceTierPricing,
            },
          );

          while (true) {
            const next = await iterator.next();
            if (next.done) {
              latestMessage = next.value;
              break;
            }

            latestMessage = assistantMessageFromEvent(next.value);
            yield next.value;
          }

          if (options?.signal?.aborted) {
            throw new Errors.Aborted({ message: "Request was aborted" });
          }

          if (
            latestMessage.stopReason === "error" ||
            latestMessage.stopReason === "aborted"
          ) {
            throw new Errors.ProviderProtocolError({
              provider: model.provider,
              message: latestMessage.errorMessage ?? "Provider ended in failure state",
            });
          }

          yield {
            type: "done",
            reason: latestMessage.stopReason as DoneReason,
            message: finalizeAssistantMessage(latestMessage),
          };
        } catch (error) {
          yield toErrorEvent(latestMessage, options?.signal, error);
        }
      })();

      return Stream.fromAsyncIterable(events, (error): never => {
        throw error;
      });
    }).pipe(Effect.provide(OpenAIClient.layer)),
  );

const streamSimpleOpenAIResponsesInternal = (
  model: OpenAIResponsesModel,
  context: Context,
  options?: SimpleStreamOptions,
) => {
  const base = buildBaseOptions(model, options);
  const reasoningEffort = supportsXhigh(model)
    ? options?.reasoning
    : clampReasoning(options?.reasoning);

  const nextOptions = {
    ...base,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  } as OpenAIResponsesOptions;

  return streamOpenAIResponsesInternal(model, context, nextOptions);
};

export const OpenAIResponsesProvider: ApiProvider = {
  api: "openai-responses",
  stream: (model, context, options) =>
    streamOpenAIResponsesInternal(
      model as OpenAIResponsesModel,
      context,
      options as OpenAIResponsesOptions | undefined,
    ) as Stream.Stream<AssistantMessageEvent>,
  streamSimple: (model, context, options) =>
    streamSimpleOpenAIResponsesInternal(
      model as OpenAIResponsesModel,
      context,
      options,
    ) as Stream.Stream<AssistantMessageEvent>,
};
