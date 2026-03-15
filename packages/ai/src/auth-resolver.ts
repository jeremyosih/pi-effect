import { Effect, FileSystem, Layer, Option, Path, Redacted, Schema as S, ServiceMap } from "effect"
import {
  AUTHENTICATED,
  envAuthConfig,
  googleApplicationCredentialsConfig,
  googleVertexLocationConfig,
  googleVertexProjectConfig,
  type EnvApiKey,
  type EnvAuth,
} from "./env-api-keys.ts"
import { OAuthResolver } from "./oauth.ts"
import type { Provider } from "./types.ts"

export class AuthMissing extends S.TaggedErrorClass<AuthMissing>("AuthMissing")(
  "AuthMissing",
  {
    provider: S.String,
  },
) {}

// NEVER convert to top-level imports - breaks browser/Vite builds (web-ui)
let _homedir: typeof import("node:os").homedir | null = null

type DynamicImport = (specifier: string) => Promise<unknown>

const dynamicImport: DynamicImport = (specifier) => import(specifier)
const NODE_OS_SPECIFIER = "node:" + "os"

// Eagerly load in Node.js/Bun environment only
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
  dynamicImport(NODE_OS_SPECIFIER).then((m) => {
    _homedir = (m as typeof import("node:os")).homedir
  })
}

export interface ResolveAuthInput {
  readonly provider: Provider
  readonly explicitApiKey?: string | undefined
}

let cachedVertexAdcCredentialsExists: boolean | null = null

const isNodeRuntime = () =>
  typeof process !== "undefined" && Boolean(process.versions?.node || process.versions?.bun)

const failMissingAuth = (provider: Provider) =>
  new AuthMissing({ provider })

const explicitApiKeyOption = (
  apiKey: string | undefined,
): Option.Option<EnvApiKey> =>
  apiKey && apiKey.length > 0
    ? Option.some(Redacted.make(apiKey, { label: "explicitApiKey" }))
    : Option.none()

const hasVertexAdcCredentials = Effect.fn(
  "AuthResolver.hasVertexAdcCredentials",
)(function* () {
  if (cachedVertexAdcCredentialsExists !== null) {
    return cachedVertexAdcCredentialsExists
  }

  const maybeFs = yield* Effect.serviceOption(FileSystem.FileSystem)

  if (Option.isNone(maybeFs)) {
    if (!isNodeRuntime()) {
      cachedVertexAdcCredentialsExists = false
    }
    return false
  }

  // Check GOOGLE_APPLICATION_CREDENTIALS env var first (standard way)
  const gacPath = yield* googleApplicationCredentialsConfig.asEffect().pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  )

  if (Option.isSome(gacPath)) {
    const exists = yield* maybeFs.value.exists(gacPath.value).pipe(
      Effect.orElseSucceed(() => false),
    )

    cachedVertexAdcCredentialsExists = exists
    return exists
  }

  const maybePath = yield* Effect.serviceOption(Path.Path)

  // If node modules haven't loaded yet (async import race at startup),
  // return false WITHOUT caching so the next call retries once they're ready.
  // Only cache false permanently in a browser environment where fs is never available.
  if (Option.isNone(maybePath) || !_homedir) {
    if (!isNodeRuntime()) {
      // Definitively in a browser — safe to cache false permanently
      cachedVertexAdcCredentialsExists = false
    }
    return false
  }

  // Fall back to default ADC path (lazy evaluation)
  const exists = yield* maybeFs.value.exists(
    maybePath.value.join(
      _homedir(),
      ".config",
      "gcloud",
      "application_default_credentials.json",
    ),
  ).pipe(
    Effect.orElseSucceed(() => false),
  )

  cachedVertexAdcCredentialsExists = exists
  return exists
})

const resolveOAuth = Effect.fn("AuthResolver.resolveOAuth")(function* (
  provider: Provider,
) {
  const maybeOAuthResolver = yield* Effect.serviceOption(OAuthResolver)

  if (Option.isNone(maybeOAuthResolver)) {
    return yield* failMissingAuth(provider)
  }

  return yield* maybeOAuthResolver.value.resolveAuth(provider).pipe(
    Effect.catchTag("OAuthUnavailable", () =>
      Effect.fail(failMissingAuth(provider)),
    ),
  )
})

const resolveAuth = Effect.fn("AuthResolver.resolveAuth")(function* (
  input: ResolveAuthInput,
) {
  const explicitApiKey = explicitApiKeyOption(input.explicitApiKey)

  if (Option.isSome(explicitApiKey)) {
    return explicitApiKey.value
  }

  const envAuth = yield* envAuthConfig(input.provider).asEffect().pipe(
    Effect.orElseSucceed(() => Option.none<EnvAuth>()),
  )

  if (Option.isSome(envAuth)) {
    return envAuth.value
  }

  // Vertex AI supports either an explicit API key or Application Default Credentials
  // Auth is configured via `gcloud auth application-default login`
  if (input.provider === "google-vertex") {
    const hasCredentials = yield* hasVertexAdcCredentials()
    const project = yield* googleVertexProjectConfig.asEffect().pipe(
      Effect.orElseSucceed(() => Option.none<string>()),
    )
    const location = yield* googleVertexLocationConfig.asEffect().pipe(
      Effect.orElseSucceed(() => Option.none<string>()),
    )

    if (hasCredentials && Option.isSome(project) && Option.isSome(location)) {
      return AUTHENTICATED
    }
  }

  return yield* resolveOAuth(input.provider)
})

const resolveApiKey = Effect.fn("AuthResolver.resolveApiKey")(function* (
  input: ResolveAuthInput,
) {
  const auth = yield* resolveAuth(input)

  return auth === AUTHENTICATED
    ? yield* failMissingAuth(input.provider)
    : auth
})

export class AuthResolver extends ServiceMap.Service<
  AuthResolver,
  {
    readonly resolveAuth: (
      input: ResolveAuthInput,
    ) => Effect.Effect<EnvAuth, AuthMissing>
    readonly resolveApiKey: (
      input: ResolveAuthInput,
    ) => Effect.Effect<EnvApiKey, AuthMissing>
  }
>()("pi-effect/ai/AuthResolver") {
  static readonly layer = Layer.succeed(
    this,
    AuthResolver.of({
      resolveAuth,
      resolveApiKey,
    }),
  )
}
