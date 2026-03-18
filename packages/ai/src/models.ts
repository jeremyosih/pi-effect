import type { Api, Cost, KnownProvider, ProviderModel as Model, Usage } from "./types.ts";
import { MODELS } from "./models.generated.ts";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

// Initialize registry from MODELS on module load
for (const [provider, models] of Object.entries(MODELS)) {
  const providerModels = new Map<string, Model<Api>>();
  for (const [id, model] of Object.entries(models)) {
    providerModels.set(id, model as Model<Api>);
  }
  modelRegistry.set(provider, providerModels);
}

type ModelApi<
  TProvider extends KnownProvider,
  TModelId extends keyof (typeof MODELS)[TProvider],
> = (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi }
  ? TApi extends Api
    ? TApi
    : never
  : never;

export function getModel<
  TProvider extends KnownProvider,
  TModelId extends keyof (typeof MODELS)[TProvider],
>(provider: TProvider, modelId: TModelId): Model<ModelApi<TProvider, TModelId>> | undefined {
  const providerModels = modelRegistry.get(provider);
  return providerModels?.get(modelId as string) as Model<ModelApi<TProvider, TModelId>> | undefined;
}

export function getProviders(): KnownProvider[] {
  return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
  provider: TProvider,
): Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
  const models = modelRegistry.get(provider);
  return models
    ? (Array.from(models.values()) as Model<
        ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>
      >[])
    : [];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Cost {
  const input = (model.cost.input / 1_000_000) * usage.input;
  const output = (model.cost.output / 1_000_000) * usage.output;
  const cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead;
  const cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  } as Cost;
}

/**
 * Check if a model supports xhigh thinking level.
 *
 * Supported today:
 * - GPT-5.2 / GPT-5.3 / GPT-5.4 model families
 * - Anthropic Messages API Opus 4.6 models (xhigh maps to adaptive effort "max")
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>) {
  if (
    model.id.includes("gpt-5.2") ||
    model.id.includes("gpt-5.3") ||
    model.id.includes("gpt-5.4")
  ) {
    return true;
  }

  if (model.api === "anthropic-messages") {
    return model.id.includes("opus-4-6") || model.id.includes("opus-4.6");
  }

  return false;
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.provider === b.provider;
}
