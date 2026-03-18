import { Schema as S, Effect, ServiceMap } from "effect";
import type { EnvAuth } from "./env-api-keys.ts";
import type { Provider } from "./types.ts";

export class OAuthUnavailable extends S.TaggedErrorClass<OAuthUnavailable>("OAuthUnavailable")(
  "OAuthUnavailable",
  {
    provider: S.String,
  },
) {}

export class OAuthResolver extends ServiceMap.Service<
  OAuthResolver,
  {
    readonly resolveAuth: (provider: Provider) => Effect.Effect<EnvAuth, OAuthUnavailable>;
  }
>()("pi-effect/ai/OAuthResolver") {}
