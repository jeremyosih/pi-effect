import { ConfigProvider, Effect, FileSystem, Layer, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { AuthResolver } from "./auth-resolver.ts";
import { AUTHENTICATED } from "./env-api-keys.ts";

describe("AuthResolver", () => {
  it("prefers explicit apiKey over env config", async () => {
    const result = await Effect.runPromise(
      AuthResolver.use((resolver) =>
        resolver.resolveApiKey({
          provider: "openai",
          explicitApiKey: "explicit-key",
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            AuthResolver.layer,
            Layer.succeed(ConfigProvider.ConfigProvider)(
              ConfigProvider.fromEnv({
                env: { OPENAI_API_KEY: "env-key" },
              }),
            ),
          ),
        ),
      ),
    );

    expect(Redacted.value(result)).toBe("explicit-key");
  });

  it("reads provider auth from env via typed config", async () => {
    const result = await Effect.runPromise(
      AuthResolver.use((resolver) =>
        resolver.resolveApiKey({
          provider: "openai",
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            AuthResolver.layer,
            Layer.succeed(ConfigProvider.ConfigProvider)(
              ConfigProvider.fromEnv({
                env: { OPENAI_API_KEY: "env-key" },
              }),
            ),
          ),
        ),
      ),
    );

    expect(Redacted.value(result)).toBe("env-key");
  });

  it("supports google-vertex ADC when filesystem and config are available", async () => {
    const result = await Effect.runPromise(
      AuthResolver.use((resolver) =>
        resolver.resolveAuth({
          provider: "google-vertex",
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            AuthResolver.layer,
            FileSystem.layerNoop({
              exists: (path) =>
                Effect.succeed(path === "/tmp/application-default-credentials.json"),
            }),
            Layer.succeed(ConfigProvider.ConfigProvider)(
              ConfigProvider.fromEnv({
                env: {
                  GOOGLE_APPLICATION_CREDENTIALS: "/tmp/application-default-credentials.json",
                  GOOGLE_CLOUD_PROJECT: "demo-project",
                  GOOGLE_CLOUD_LOCATION: "europe-west4",
                },
              }),
            ),
          ),
        ),
      ),
    );

    expect(result).toBe(AUTHENTICATED);
  });

  it("fails with AuthMissing when auth cannot be resolved", async () => {
    await expect(
      Effect.runPromise(
        AuthResolver.use((resolver) =>
          resolver.resolveApiKey({
            provider: "openai",
          }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              AuthResolver.layer,
              Layer.succeed(ConfigProvider.ConfigProvider)(ConfigProvider.fromEnv({ env: {} })),
            ),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "AuthMissing",
      provider: "openai",
    });
  });
});
