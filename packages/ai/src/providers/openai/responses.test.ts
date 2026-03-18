import { ConfigProvider, Effect, Schema as S, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAiInstances = new Array<{ options: Record<string, unknown> }>();
const createResponseStream = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    readonly responses = {
      create: createResponseStream,
    };

    constructor(options: Record<string, unknown>) {
      openAiInstances.push({ options });
    }
  },
}));

import * as Ai from "../../index.ts";
import { OpenAIResponsesProvider } from "./responses.ts";

const decodeModel = S.decodeSync(Ai.Model);
const decodeContext = S.decodeSync(Ai.Context);

const makeModel = (provider: Ai.Provider = "openai") =>
  ({
    ...decodeModel({
      id: "gpt-test",
      name: "GPT Test",
      api: "openai-responses",
      provider,
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        total: 0,
      },
      contextWindow: 128000,
      maxTokens: 4096,
      headers: { "X-Base": "1" },
    }),
    api: "openai-responses",
    provider,
  }) as Ai.OpenAIResponsesModel;

const makeContext = (withImage = false) =>
  decodeContext({
    messages: [
      withImage
        ? {
            role: "user",
            content: [
              {
                type: "image",
                data: Buffer.from("img").toString("base64"),
                mimeType: "image/png",
              },
            ],
            timestamp: 0,
          }
        : {
            role: "user",
            content: "hello",
            timestamp: 0,
          },
    ],
  });

const makeCompletedStream = (
  overrides?: Partial<{
    status: "completed" | "incomplete";
    serviceTier: "priority" | "flex";
  }>,
) =>
  (async function* () {
    yield {
      type: "response.output_item.added",
      item: {
        type: "message",
        id: "msg_1",
        content: [],
      },
    } as any;
    yield {
      type: "response.content_part.added",
      part: {
        type: "output_text",
        text: "",
        annotations: [],
      },
    } as any;
    yield {
      type: "response.output_text.delta",
      delta: "hello",
    } as any;
    yield {
      type: "response.output_item.done",
      item: {
        type: "message",
        id: "msg_1",
        content: [{ type: "output_text", text: "hello" }],
      },
    } as any;
    yield {
      type: "response.completed",
      response: {
        status: overrides?.status ?? "completed",
        service_tier: overrides?.serviceTier ?? "priority",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          input_tokens_details: { cached_tokens: 2 },
        },
      },
    } as any;
  })();

describe("openai responses provider", () => {
  beforeEach(() => {
    openAiInstances.length = 0;
    createResponseStream.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("emits an aborted terminal event before request when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = OpenAIResponsesProvider.stream(makeModel(), makeContext(), {
      signal: controller.signal,
      apiKey: "test-key",
    });

    const collected = await Effect.runPromise(Stream.runCollect(events));
    expect(Array.from(collected)).toEqual([
      expect.objectContaining({
        type: "error",
        reason: "aborted",
      }),
    ]);
    expect(createResponseStream).not.toHaveBeenCalled();
  });

  it("applies onPayload overrides and prompt cache options before sending the request", async () => {
    createResponseStream.mockResolvedValueOnce(makeCompletedStream());

    const events = OpenAIResponsesProvider.stream(makeModel(), makeContext(), {
      apiKey: "test-key",
      sessionId: "session-1" as never,
      cacheRetention: "long",
      onPayload: (payload) => ({
        ...(payload as Record<string, unknown>),
        max_output_tokens: 77,
      }),
    });

    await Effect.runPromise(Stream.runDrain(events));

    expect(createResponseStream).toHaveBeenCalledTimes(1);
    expect(createResponseStream.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-test",
      prompt_cache_key: "session-1",
      prompt_cache_retention: "24h",
      max_output_tokens: 77,
    });
  });

  it("reads OPENAI_API_KEY from typed config when apiKey is omitted", async () => {
    createResponseStream.mockResolvedValueOnce(makeCompletedStream());

    const events = OpenAIResponsesProvider.stream(makeModel(), makeContext());

    await Effect.runPromise(
      Stream.runDrain(events).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: { OPENAI_API_KEY: "env-key" },
          }),
        ),
      ),
    );

    expect(openAiInstances).toHaveLength(1);
    expect(openAiInstances[0]?.options.apiKey).toBe("env-key");
  });

  it("reads PI_CACHE_RETENTION from typed config when the option is omitted", async () => {
    createResponseStream.mockResolvedValueOnce(makeCompletedStream());

    const events = OpenAIResponsesProvider.stream(makeModel(), makeContext(), {
      apiKey: "test-key",
      sessionId: "session-1" as never,
    });

    await Effect.runPromise(
      Stream.runDrain(events).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: { PI_CACHE_RETENTION: "long" },
          }),
        ),
      ),
    );

    expect(createResponseStream.mock.calls[0]?.[0]).toMatchObject({
      prompt_cache_key: "session-1",
      prompt_cache_retention: "24h",
    });
  });

  it("injects dynamic Copilot headers into the OpenAI client constructor", async () => {
    createResponseStream.mockResolvedValueOnce(makeCompletedStream());

    const events = OpenAIResponsesProvider.stream(makeModel("github-copilot"), makeContext(true), {
      apiKey: "test-key",
    });

    await Effect.runPromise(Stream.runDrain(events));

    expect(openAiInstances).toHaveLength(1);
    expect(openAiInstances[0]?.options.defaultHeaders).toMatchObject({
      "X-Base": "1",
      "X-Initiator": "user",
      "Openai-Intent": "conversation-edits",
      "Copilot-Vision-Request": "true",
    });
  });

  it("applies service tier pricing and completes through the public facade", async () => {
    createResponseStream.mockResolvedValueOnce(makeCompletedStream());

    const layer = Ai.ProviderRegistryLive([OpenAIResponsesProvider]);
    const result = await Effect.runPromise(
      Ai.complete(makeModel(), makeContext(), {
        apiKey: "test-key",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.content).toMatchObject([{ type: "text", text: "hello" }]);
    expect(result.stopReason).toBe("stop");
    expect(result.usage).toMatchObject({
      input: 8,
      output: 5,
      cacheRead: 2,
      totalTokens: 15,
      cost: {
        input: 16,
        output: 10,
        cacheRead: 4,
        total: 30,
      },
    });
  });

  it("emits a canonical error event when auth cannot be resolved", async () => {
    const events = OpenAIResponsesProvider.stream(makeModel(), makeContext());

    const collected = await Effect.runPromise(
      Stream.runCollect(events).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      ),
    );

    expect(Array.from(collected)).toEqual([
      expect.objectContaining({
        type: "error",
        reason: "error",
        error: expect.objectContaining({
          errorMessage: "No API key for provider: openai",
        }),
      }),
    ]);
    expect(createResponseStream).not.toHaveBeenCalled();
  });
});
