import { Schema as S, Struct, Stream } from "effect";

// Brands

const NonNegativeInt = S.Int.check(S.isGreaterThanOrEqualTo(0));

export const UnixTimestampMs = NonNegativeInt.pipe(
  S.brand("UnixTimestampMs"),
).annotate({
  identifier: "TimestampMs",
  description: "Unix timestamp in milliseconds",
});
export type UnixTimestampMs = typeof UnixTimestampMs.Type;

export const TokenCount = NonNegativeInt.pipe(S.brand("TokenCount")).annotate({
  identifier: "TokenCount",
  description: "Normalized token count reported by a provider",
});
export type TokenCount = typeof TokenCount.Type;

export const MaxTokens = NonNegativeInt.pipe(S.brand("MaxTokens")).annotate({
  identifier: "MaxTokens",
  description: "Maximum tokens allowed for generation",
});
export type MaxTokens = typeof MaxTokens.Type;

export const RetryDelayMs = NonNegativeInt.pipe(
  S.brand("RetryDelayMs"),
).annotate({
  identifier: "RetryDelayMs",
  description: "Retry delay cap in milliseconds",
});
export type RetryDelayMs = typeof RetryDelayMs.Type;

export const ThinkingBudgetTokens = NonNegativeInt.pipe(
  S.brand("ThinkingBudgetTokens"),
).annotate({
  identifier: "ThinkingBudgetTokens",
  description: "Token budget for a reasoning level",
});
export type ThinkingBudgetTokens = typeof ThinkingBudgetTokens.Type;

export const Temperature = S.Number.check(
  S.isBetween({ minimum: 0, maximum: 2 }),
)
  .pipe(S.brand("Temperature"))
  .annotate({
    identifier: "Temperature",
    description: "Sampling temperature in the inclusive range 0..2",
  });
export type Temperature = typeof Temperature.Type;

export const SessionId = S.NonEmptyString.pipe(S.brand("SessionId")).annotate({
  identifier: "SessionId",
  description: "Opaque provider session identifier",
});
export type SessionId = typeof SessionId.Type;

export const ToolCallId = S.NonEmptyString.pipe(S.brand("ToolCallId")).annotate(
  {
    identifier: "ToolCallId",
    description: "Opaque identifier for a tool call",
  },
);
export type ToolCallId = typeof ToolCallId.Type;

export const ModelId = S.NonEmptyString.pipe(S.brand("ModelId")).annotate({
  identifier: "ModelId",
  description: "Unique Model Name",
});
export type ModelId = typeof ModelId.Type;

export const ProviderSignature = S.NonEmptyString.pipe(
  S.brand("ProviderSignature"),
).annotate({
  identifier: "ProviderSignature",
  description: "Opaque provider thinking/thought signature",
});
export type ProviderSignature = typeof ProviderSignature.Type;

export const DollarsPerMillionToken = S.Number.check(
  S.isGreaterThanOrEqualTo(0),
)
  .pipe(S.brand("DollarsPerMillionToken"))
  .annotate({
    identifier: "DollarsPerMillionToken",
    description: "Cost in Dollars per Million Tokens",
  });

const ImageData = S.Uint8ArrayFromBase64.annotate({
  identifier: "ImageData",
  description: "Base64-encoded image bytes",
});
export type ImageData = typeof ImageData.Type;

export const ImageMime = S.NonEmptyString.check(S.isStartsWith("image/"))
  .pipe(S.brand("ImageMime"))
  .annotate({
    identifier: "ImageMime",
    description: "Image MIME ",
  });
export type ImageMime = typeof ImageMime.Type;

export const ContentIndex = NonNegativeInt.pipe(S.brand("ContentIndex"));
export type ContentIndex = typeof ContentIndex.Type;

export const KnownApi = S.Literals([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
  "mistral-conversations",
]);
export const Api = S.Union([KnownApi, S.String]);
export type Api = typeof KnownApi.Type | ({} & string);

export const KnownProvider = S.Literals([
  "amazon-bedrock",
  "anthropic",
  "google",
  "google-gemini-cli",
  "google-antigravity",
  "google-vertex",
  "openai",
  "azure-openai-responses",
  "openai-codex",
  "github-copilot",
  "xai",
  "groq",
  "cerebras",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "mistral",
  "minimax",
  "minimax-cn",
  "huggingface",
  "opencode",
  "opencode-go",
  "kimi-coding",
]);
export const Provider = S.Union([KnownProvider, S.String]);
export type Provider = typeof Provider.Type | ({} & string);

//TODO: I am hihgly suscpicious of this because seems tightly coppled to OAI vs Claude max etc.
export const ThinkingLevel = S.Literals([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type ThinkingLevel = typeof ThinkingLevel.Type;

/** Token budget for each thinking level (token-based providers only) */
export const ThinkingBudgets = S.Struct({
  minimal: S.optional(ThinkingBudgetTokens),
  low: S.optional(ThinkingBudgetTokens),
  medium: S.optional(ThinkingBudgetTokens),
  high: S.optional(ThinkingBudgetTokens),
});
export type ThinkingBudgets = typeof ThinkingBudgets.Type;

//Base options all providers share
export const CacheRetention = S.Literals(["none", "short", "long"]);
export type CacheRetention = typeof CacheRetention.Type;

export const Transport = S.Literals(["sse", "websocket", "auto"]);
export type Transport = typeof Transport.Type;

//TODO: There must be a better way to do this !
export type OnPayload = (
  payload: unknown,
  model: ProviderModel<Api>,
) => unknown | undefined | Promise<unknown | undefined>;

export const OnPayload = S.declare<OnPayload>(
  (input): input is OnPayload => typeof input === "function",
);

export const StreamOptions = S.Struct({
  temperature: S.optional(Temperature),
  maxTokens: S.optional(MaxTokens),
  signal: S.optional(S.instanceOf(AbortSignal)),
  apiKey: S.optional(S.String), //TODO: Use S.Config ?
  /**
   * Preferred tranport for providers that support multiple transports.
   * Providers that do not support this option ignore it.
   */
  transport: S.optional(Transport),
  /**
   * Prompt cache retention preference. Providers map this to their supported value
   * Default: "short". TODO: Where is this done ? + Should this be done on the .
   */
  cacheRetention: S.optional(CacheRetention),
  /**
   * Optional session identifier for providers that support session-based caching.
   * Providers can use this to enable prompt cahcing, request routing, or other
   * session-aware features. Ignored by providers that don't support it.
   */
  sessionId: S.optional(SessionId),
  /**
   * Optional callback for inspecting provider payloads before sending.
   */
  onPayload: S.optional(OnPayload),
  /**
   * Optional custom HTTP headers to include in API requests.
   * Merged with provider defaults; can override default headers.
   * Not supported by all providers (e.g., AWS Bedrock uses SDK auth).
   */
  headers: S.optional(S.Record(S.String, S.String)),
  /**
   * Maximum delay in milliseconds to wait for a retry when the server requests a long wait.
   * If the server's requested delay exceeds this value, the request fails immediately
   * with an error containing the requested delay, allowing higher-level retry logic
   * to handle it with user visibility.
   * Default: 60000 (60 seconds). Set to 0 to disable the cap.
   */
  maxRetryDelayMs: S.optional(RetryDelayMs),
  /**
   * Optional metadata to include in API requests.
   * Providers extract the fields they understand and ignore the rest.
   * For example, Anthropic uses `user_id` for abuse tracking and rate limiting.
   */
  metadata: S.optional(S.Record(S.String, S.Unknown)),
});
export type StreamOptions = typeof StreamOptions.Type;

export const ProviderStreamOptions = S.StructWithRest(StreamOptions, [
  S.Record(S.String, S.Unknown),
]);
export type ProviderStreamOptions = typeof ProviderStreamOptions.Type;

//Unified options with reasoning passed to streamSimple() and completeSimple()
export const SimpleStreamOptions = S.Struct({
  ...StreamOptions.fields,
  reasoning: S.optional(ThinkingLevel),
  thinkingBudgets: S.optional(ThinkingBudgets),
});
export type SimpleStreamOptions = typeof SimpleStreamOptions.Type;

//Generic StreamFunction with typed options
export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
  E = never,
  R = never,
> = (
  model: ProviderModel<TApi>,
  context: Context,
  options?: TOptions,
) => Stream.Stream<AssistantMessageEvent, E, R>;

export const Content = S.Union([
  S.Struct({
    type: S.Literal("text"),
    text: S.String,
    textSignature: S.optional(ProviderSignature), // e.g., for OpenAI responses, the message ID
  }),
  S.Struct({
    type: S.Literal("thinking"),
    thinking: S.String,
    thinkingSignature: S.optional(ProviderSignature),
    redacted: S.optional(S.Boolean),
  }),
  S.Struct({
    type: S.Literal("image"),
    data: ImageData,
    mimeType: ImageMime,
  }),
  S.Struct({
    type: S.Literal("toolCall"),
    id: ToolCallId,
    name: S.String,
    arguments: S.Record(S.String, S.Unknown),
    thoughtSignature: S.optional(ProviderSignature), //Google-specific: opaque signature for reusing thought context
  }),
]).pipe(S.toTaggedUnion("type"));
export type Content = typeof Content.Type;

export const UserContent = S.Union([Content.cases.text, Content.cases.image]);

export const AssistantContent = S.Union([
  Content.cases.text,
  Content.cases.thinking,
  Content.cases.toolCall,
]);

export const Cost = S.Struct({
  input: DollarsPerMillionToken,
  output: DollarsPerMillionToken,
  cacheRead: DollarsPerMillionToken,
  cacheWrite: DollarsPerMillionToken,
  total: S.optionalKey(DollarsPerMillionToken),
});
export type Cost = typeof Cost.Type;

export const Usage = S.Struct({
  input: TokenCount,
  output: TokenCount,
  cacheRead: TokenCount,
  cacheWrite: TokenCount,
  totalTokens: TokenCount,
  cost: Cost,
});
export type Usage = typeof Usage.Type;

export const CompletedStopReason = S.Literals(["stop", "length", "toolUse"]);
export const FailedStopReason = S.Literals(["error", "aborted"]);
export const StopReason = S.Union([CompletedStopReason, FailedStopReason]);
export type StopReason = typeof StopReason.Type;

export const Message = S.Union([
  S.Struct({
    role: S.Literal("user"),
    content: S.Union([S.String, S.Array(UserContent)]),
    timestamp: UnixTimestampMs,
  }),
  S.Struct({
    role: S.Literal("assistant"),
    content: S.Array(AssistantContent),
    api: Api,
    provider: Provider,
    model: ModelId,
    usage: Usage,
    stopReason: StopReason,
    errorMessage: S.optional(S.String),
    timestamp: UnixTimestampMs,
  }),
  S.Struct({
    role: S.Literal("toolResult"),
    toolCallId: S.String,
    toolName: S.String,
    content: S.Array(UserContent),
    details: S.optional(S.Unknown),
    status: S.Literals(["success", "error"]),
    timestamp: UnixTimestampMs,
  }),
]).pipe(S.toTaggedUnion("role"));
export type Message = typeof Message.Type;

export const UserMessage = Message.cases.user;
export type UserMessage = typeof UserMessage.Type;

export const AssistantMessage = Message.cases.assistant;
export type AssistantMessage = typeof AssistantMessage.Type;

export const PartialAssistantMessage = AssistantMessage.mapFields(
  Struct.mapOmit(["role"], S.optionalKey),
);
export type PartialAssistantMessage = typeof PartialAssistantMessage.Type;

export const ToolResult = Message.cases.toolResult;
export type ToolResult = typeof ToolResult.Type;

export const Tool = S.Struct({
  name: S.String,
  description: S.String,
  parameters: S.Record(S.String, S.Unknown),
});
export type Tool = typeof Tool.Type;

export const Context = S.Struct({
  systemPrompt: S.optional(S.String),
  messages: S.Array(Message),
  tools: S.optional(S.Array(Tool)),
});
export type Context = typeof Context.Type;

export const AssistantMessageEvent = S.Union([
  S.Struct({
    type: S.Literal("start"),
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("text_start"),
    contentIndex: ContentIndex,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("text_delta"),
    contentIndex: ContentIndex,
    delta: S.String,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("text_end"),
    contentIndex: ContentIndex,
    content: S.String,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("thinking_start"),
    contentIndex: ContentIndex,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("thinking_delta"),
    contentIndex: ContentIndex,
    delta: S.String,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("thinking_end"),
    contentIndex: ContentIndex,
    content: S.String,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("toolcall_start"),
    contentIndex: ContentIndex,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("toolcall_delta"),
    contentIndex: ContentIndex,
    delta: S.String,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("toolcall_end"),
    contentIndex: ContentIndex,
    toolCall: Content.cases.toolCall,
    partial: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("done"),
    reason: CompletedStopReason,
    message: AssistantMessage,
  }),
  S.Struct({
    type: S.Literal("error"),
    reason: FailedStopReason,
    error: AssistantMessage,
  }),
]).pipe(S.toTaggedUnion("type"));
export type AssistantMessageEvent = typeof AssistantMessageEvent.Type;

/**
 * OpenRouter provider routing preferences.
 * Controls which upstream providers OpenRouter routes requests to.
 * @see https://openrouter.ai/docs/provider-routing
 */
export const OpenRouterRouting = S.Struct({
  /** List of provider slugs to exclusively use for this request (e.g., ["amazon-bedrock", "anthropic"]). */
  only: S.optional(S.Array(S.String)),
  /** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
  order: S.optional(S.Array(S.String)),
});
export type OpenRouterRouting = typeof OpenRouterRouting.Type;

/**
 * Vercel AI Gateway routing preferences.
 * Controls which upstream providers the gateway routes requests to.
 * @see https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 */
export const VercelGatewayRouting = S.Struct({
  /** List of provider slugs to exclusively use for this request (e.g., ["amazon-bedrock", "anthropic"]). */
  only: S.optional(S.Array(S.String)),
  /** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
  order: S.optional(S.Array(S.String)),
});

export const OpenAICompletionsCompat = S.Struct({
  /** Wether the provider supports the `store` field. Default: auto-detected from URL. */
  supportsStore: S.optional(S.Boolean),
  /** Wether the provider supports the `developer` role (vs `system`) Default: auto-detetced from URL. */
  supportsDeveloperRole: S.optional(S.Boolean),
  /** Wether the provider supports `reasoning_effort`. Default: auto-detected from the URL. */
  supportsReasoningEffort: S.optional(S.Boolean),
  /** Optional mapping from pi-ai reasoning levels to provider/model-specific `reasoning_effort` values. */
  reasoningEffortMap: S.optionalKey(
    S.Record(ThinkingLevel, S.optionalKey(S.String)),
  ),
  /** Wether the provider supports `stream_options: {include_usage: true }` for token usage in streaming responses. Default.true */
  supportsUsageInStreaming: S.optional(S.Boolean),
  /** Which dield to use for max tokens. Default: auto-detected from the URL */
  maxTokensField: S.optional(
    S.Literals(["max_completion_tokens", "max_tokens"]),
  ),
  /** Whether tool results require the `name` field. Default: auto-detected from URL. */
  requiresToolResultName: S.optional(S.Boolean),
  /** Whether a user message after tool results requires an assistant message in between. Default: auto-detected from URL. */
  requiresAssistantAfterToolResult: S.optional(S.Boolean),
  /** Whether thinking blocks must be converted to text blocks with <thinking> delimiters. Default: auto-detected from URL. */
  requiresThinkingAsText: S.optional(S.Boolean),
  /** Format for reasoning/thinking parameter. "openai" uses reasoning_effort, "zai" uses thinking: { type: "enabled" }, "qwen" uses enable_thinking: boolean. Default: "openai". */
  thinkingFormat: S.optional(S.Literals(["openai", "zai", "qwen"])),
  /** OpenRouter-specific routing preferences. Only used when baseUrl points to OpenRouter. */
  openRouterRouting: S.optional(OpenRouterRouting),
  /** Vercel AI Gateway routing preferences. Only used when baseUrl points to Vercel AI Gateway. */
  vercelGatewayRouting: S.optional(VercelGatewayRouting),
  /** Whether the provider supports the `strict` field in tool definitions. Default: true. */
  supportsStrictMode: S.optional(S.Boolean),
});
export type OpenAICompletionsCompat = typeof OpenAICompletionsCompat.Type;

/** Compatibility settings for OpenAI Responses APIs. */
export const OpenAIResponsesCompat = S.Struct({
  // Reserved for future use as per pi-mono
});
export type OpenAIResponsesCompat = typeof OpenAIResponsesCompat.Type;

export const Model = S.Struct({
  id: ModelId,
  name: S.String,
  api: Api,
  provider: Provider,
  baseUrl: S.String,
  reasoning: S.Boolean,
  input: S.Array(S.Literals(["text", "image"])),
  cost: Cost,
  contextWindow: S.Number,
  maxTokens: MaxTokens,
  headers: S.optional(S.Record(S.String, S.String)),
});
export type Model = typeof Model.Type;

type CompatFor<TApi extends Api> = TApi extends "openai-completions"
  ? OpenAICompletionsCompat
  : TApi extends "openai-responses"
    ? OpenAIResponsesCompat
    : never;

export type ProviderModel<TApi extends Api = Api> = Omit<Model, "api"> & {
  api: TApi;
  compat?: CompatFor<TApi>;
};

export type OpenAICompletionsModel = ProviderModel<"openai-completions">;
export type OpenAIResponsesModel = ProviderModel<"openai-responses">;
