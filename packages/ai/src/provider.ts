import { Effect, ServiceMap, Layer, Stream } from "effect";
import * as Errors from "./errors.ts";
import type {
  Api,
  AssistantMessageEvent,
  Context,
  ProviderModel,
  SimpleStreamOptions,
  StreamOptions,
} from "./types.ts";

export type ProviderStream = Stream.Stream<
  AssistantMessageEvent,
  typeof Errors.ProviderStreamError.Type
>;

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
