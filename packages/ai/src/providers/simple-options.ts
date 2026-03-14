import type {
  Api,
  ProviderModel as Model,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
} from "../types.ts";

export function buildBaseOptions(
  model: Model<Api>,
  options?: SimpleStreamOptions,
  apiKey?: string,
): StreamOptions {
  const base: Record<string, unknown> = {
    maxTokens: (options?.maxTokens ?? Math.min(model.maxTokens, 32_000)) as never,
  };

  if (options?.temperature !== undefined) {
    base.temperature = options.temperature;
  }
  if (options?.signal !== undefined) {
    base.signal = options.signal;
  }
  const resolvedApiKey = apiKey ?? options?.apiKey;
  if (resolvedApiKey !== undefined) {
    base.apiKey = resolvedApiKey;
  }
  if (options?.cacheRetention !== undefined) {
    base.cacheRetention = options.cacheRetention;
  }
  if (options?.sessionId !== undefined) {
    base.sessionId = options.sessionId;
  }
  if (options?.headers !== undefined) {
    base.headers = options.headers;
  }
  if (options?.onPayload !== undefined) {
    base.onPayload = options.onPayload;
  }
  if (options?.maxRetryDelayMs !== undefined) {
    base.maxRetryDelayMs = options.maxRetryDelayMs;
  }
  if (options?.metadata !== undefined) {
    base.metadata = options.metadata;
  }

  return base as StreamOptions;
}

export function clampReasoning(
  effort: ThinkingLevel | undefined,
): Exclude<ThinkingLevel, "xhigh"> | undefined {
  return effort === "xhigh" ? "high" : effort;
}

export function adjustMaxTokensForThinking(
  baseMaxTokens: number,
  modelMaxTokens: number,
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
  const defaultBudgets: ThinkingBudgets = {
    minimal: 1024 as never,
    low: 2048 as never,
    medium: 8192 as never,
    high: 16384 as never,
  };

  const budgets = { ...defaultBudgets, ...customBudgets };
  const minOutputTokens = 1024;
  const level = clampReasoning(reasoningLevel)!;
  let thinkingBudget = budgets[level]! as number;
  const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

  if (maxTokens <= thinkingBudget) {
    thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
  }

  return { maxTokens, thinkingBudget };
}
