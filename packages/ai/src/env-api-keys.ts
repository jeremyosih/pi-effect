import { Config, Option, Redacted } from "effect"
import type { CacheRetention, KnownProvider, Provider } from "./types.ts"

export const AUTHENTICATED = "<authenticated>" as const
export type Authenticated = typeof AUTHENTICATED
export type EnvApiKey = Redacted.Redacted<string>
export type EnvAuth = EnvApiKey | Authenticated

type EnvKeyChain = readonly [string, ...string[]]
type OptionalStringConfig = Config.Config<Option.Option<string>>
export type OptionalApiKeyConfig = Config.Config<Option.Option<EnvApiKey>>
export type OptionalAuthenticatedConfig = Config.Config<Option.Option<Authenticated>>
export type OptionalEnvAuthConfig = Config.Config<Option.Option<EnvAuth>>

// Fall back to environment variables
const apiKeyEnvByProvider = {
  "github-copilot": ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
  // ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "azure-openai-responses": ["AZURE_OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  zai: ["ZAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  huggingface: ["HF_TOKEN"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
} as const satisfies Partial<Record<KnownProvider, EnvKeyChain>>

const nonEmptyStringConfig = (name: string): Config.Config<string> =>
  Config.nonEmptyString(name)

const firstStringConfig = (names: EnvKeyChain): OptionalStringConfig => {
  const [head, ...tail] = names

  return tail
    .reduce(
      (config, name) => config.pipe(Config.orElse(() => nonEmptyStringConfig(name))),
      nonEmptyStringConfig(head),
    )
    .pipe(
      Config.map((value) => Option.some(value)),
      Config.orElse(() => Config.succeed(Option.none())),
    )
}

const apiKeyConfig = (name: string): Config.Config<EnvApiKey> =>
  nonEmptyStringConfig(name).pipe(
    Config.map((value) => Redacted.make(value, { label: name })),
  )

const firstApiKeyConfig = (names: EnvKeyChain): OptionalApiKeyConfig => {
  const [head, ...tail] = names

  return tail
    .reduce(
      (config, name) => config.pipe(Config.orElse(() => apiKeyConfig(name))),
      apiKeyConfig(head),
    )
    .pipe(
      Config.map((value) => Option.some(value)),
      Config.orElse(() => Config.succeed(Option.none())),
    )
}

const hasAnyEnvConfig = (names: EnvKeyChain): Config.Config<boolean> =>
  firstStringConfig(names).pipe(
    Config.map(Option.isSome),
  )

export const googleApplicationCredentialsConfig: OptionalStringConfig =
  firstStringConfig(["GOOGLE_APPLICATION_CREDENTIALS"])

export const googleVertexProjectConfig: OptionalStringConfig = firstStringConfig([
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
])

export const googleVertexLocationConfig: OptionalStringConfig = firstStringConfig([
  "GOOGLE_CLOUD_LOCATION",
])

/**
 * Amazon Bedrock supports multiple credential sources:
 * 1. AWS_PROFILE - named profile from ~/.aws/credentials
 * 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY - standard IAM keys
 * 3. AWS_BEARER_TOKEN_BEDROCK - Bedrock API keys (bearer token)
 * 4. AWS_CONTAINER_CREDENTIALS_RELATIVE_URI - ECS task roles
 * 5. AWS_CONTAINER_CREDENTIALS_FULL_URI - ECS task roles (full URI)
 * 6. AWS_WEB_IDENTITY_TOKEN_FILE - IRSA (IAM Roles for Service Accounts)
 */
export const bedrockAuthenticatedConfig: OptionalAuthenticatedConfig = Config.all({
  hasProfile: hasAnyEnvConfig(["AWS_PROFILE"]),
  hasAccessKeyId: hasAnyEnvConfig(["AWS_ACCESS_KEY_ID"]),
  hasSecretAccessKey: hasAnyEnvConfig(["AWS_SECRET_ACCESS_KEY"]),
  hasBearerToken: hasAnyEnvConfig(["AWS_BEARER_TOKEN_BEDROCK"]),
  hasRelativeUri: hasAnyEnvConfig(["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"]),
  hasFullUri: hasAnyEnvConfig(["AWS_CONTAINER_CREDENTIALS_FULL_URI"]),
  hasWebIdentityToken: hasAnyEnvConfig(["AWS_WEB_IDENTITY_TOKEN_FILE"]),
}).pipe(
  Config.map(
    ({
      hasProfile,
      hasAccessKeyId,
      hasSecretAccessKey,
      hasBearerToken,
      hasRelativeUri,
      hasFullUri,
      hasWebIdentityToken,
    }) =>
      hasProfile ||
      (hasAccessKeyId && hasSecretAccessKey) ||
      hasBearerToken ||
      hasRelativeUri ||
      hasFullUri ||
      hasWebIdentityToken
        ? Option.some(AUTHENTICATED)
        : Option.none(),
  ),
)

export const cacheRetentionConfig = Config.literal(
  "long",
  "PI_CACHE_RETENTION",
).pipe(
  Config.orElse(() => Config.succeed("short" as const)),
)

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function envApiKeyConfig(provider: KnownProvider): OptionalApiKeyConfig
export function envApiKeyConfig(provider: Provider): OptionalApiKeyConfig
export function envApiKeyConfig(provider: Provider): OptionalApiKeyConfig {
  const names =
    provider in apiKeyEnvByProvider
      ? apiKeyEnvByProvider[provider as keyof typeof apiKeyEnvByProvider]
      : undefined

  return names === undefined
    ? Config.succeed(Option.none())
    : firstApiKeyConfig(names)
}

export function envAuthConfig(provider: KnownProvider): OptionalEnvAuthConfig
export function envAuthConfig(provider: Provider): OptionalEnvAuthConfig
export function envAuthConfig(provider: Provider): OptionalEnvAuthConfig {
  if (provider === "amazon-bedrock") {
    return bedrockAuthenticatedConfig
  }
  return envApiKeyConfig(provider).pipe(
    Config.map((key) =>
      Option.match(key, {
        onSome: (value) => Option.some<EnvAuth>(value),
        onNone: () => Option.none<EnvAuth>(),
      }),
    ),
  )
}
