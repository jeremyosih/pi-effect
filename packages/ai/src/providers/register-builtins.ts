import type { ApiProvider } from "../provider.ts";
import { ProviderRegistryLive } from "../provider.ts";
import { OpenAIResponsesProvider } from "./openai/responses.ts";

export const builtInProviders = [
  OpenAIResponsesProvider,
] as const satisfies ReadonlyArray<ApiProvider>;

export const ProviderRegistryBuiltinsLive =
  ProviderRegistryLive(builtInProviders);
