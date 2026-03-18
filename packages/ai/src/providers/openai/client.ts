import OpenAI from "openai";
import { Effect, Layer, Redacted, Schema as S, ServiceMap } from "effect";
import { AuthMissing, AuthResolver } from "../../auth-resolver.ts";
import type { Provider } from "../../types.ts";

export class ProviderHttpError extends S.TaggedErrorClass<ProviderHttpError>("ProviderHttpError")(
  "ProviderHttpError",
  {
    provider: S.String,
    status: S.Number,
    body: S.optional(S.String),
  },
) {}

export interface CreateResponsesStreamInput {
  readonly provider: Provider;
  readonly baseUrl: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly params: OpenAI.Responses.ResponseCreateParamsStreaming;
  readonly signal?: AbortSignal;
  readonly apiKey?: string;
}

export class OpenAIClient extends ServiceMap.Service<
  OpenAIClient,
  {
    readonly createResponsesStream: (
      input: CreateResponsesStreamInput,
    ) => Effect.Effect<
      AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
      AuthMissing | ProviderHttpError
    >;
  }
>()("pi-effect/ai/providers/openai/client") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const authResolver = yield* AuthResolver;

      return OpenAIClient.of({
        createResponsesStream: Effect.fn("OpenAIClient.createResponsesStream")(function* (input) {
          const apiKey = yield* authResolver
            .resolveApiKey({
              provider: input.provider,
              explicitApiKey: input.apiKey,
            })
            .pipe(Effect.map(Redacted.value));

          const client = new OpenAI({
            apiKey,
            baseURL: input.baseUrl,
            dangerouslyAllowBrowser: true,
            ...(input.defaultHeaders ? { defaultHeaders: input.defaultHeaders } : {}),
          });

          return yield* Effect.tryPromise({
            try: () =>
              client.responses.create(
                input.params,
                input.signal ? { signal: input.signal } : undefined,
              ) as Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>>,
            catch: (cause) =>
              new ProviderHttpError({
                provider: input.provider,
                status:
                  typeof cause === "object" &&
                  cause !== null &&
                  "status" in cause &&
                  typeof cause.status === "number"
                    ? cause.status
                    : 0,
                body: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        }),
      });
    }),
  ).pipe(Layer.provide(AuthResolver.layer));
}
