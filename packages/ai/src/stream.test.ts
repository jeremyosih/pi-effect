import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema as S, Stream } from "effect";
import * as Ai from "./index.ts";

const decodeModel = S.decodeSync(Ai.Model);
const decodeContext = S.decodeSync(Ai.Context);
const decodeAssistantMessage = S.decodeSync(Ai.AssistantMessage);
const decodeEvent = S.decodeSync(Ai.AssistantMessageEvent);

const makeModel = () => ({
  ...decodeModel({
    id: "gpt-test",
    name: "GPT Test",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.com",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    contextWindow: 128000,
    maxTokens: 4096,
  }),
  api: "openai-responses",
});

const makeContext = () =>
  decodeContext({
    messages: [],
  });

const makeAssistantMessage = (text: string) =>
  decodeAssistantMessage({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: 0,
  });

const makeEvents = (message: Ai.AssistantMessage) =>
  Stream.make(
    decodeEvent({
      type: "start",
      partial: message,
    }),
    decodeEvent({
      type: "done",
      reason: "stop",
      message,
    }),
  );

describe("stream facade", () => {
  const rawMessage = makeAssistantMessage("raw");
  const simpleMessage = makeAssistantMessage("simple");

  const fakeProvider: Ai.ApiProvider = {
    api: "openai-responses",
    stream: () => makeEvents(rawMessage),
    streamSimple: () => makeEvents(simpleMessage),
  };

  const layer = Ai.ProviderRegistryLive([fakeProvider]);

  it.effect("stream exposes canonical events unchanged", () =>
    Effect.gen(function* () {
      const events = yield* Ai.stream(makeModel(), makeContext()).pipe(Effect.provide(layer));

      const collected = yield* Stream.runFold(
        events,
        () => new Array<Ai.AssistantMessageEvent>(),
        (acc, event) => [...acc, event],
      );

      assert.deepStrictEqual(collected, [
        { type: "start", partial: rawMessage },
        { type: "done", reason: "stop", message: rawMessage },
      ]);
    }),
  );

  it.effect("complete folds the same stream into the final message", () =>
    Effect.gen(function* () {
      const result = yield* Ai.complete(makeModel(), makeContext()).pipe(Effect.provide(layer));

      assert.deepStrictEqual(result, rawMessage);
    }),
  );

  it.effect("completeSimple uses the simple provider path", () =>
    Effect.gen(function* () {
      const result = yield* Ai.completeSimple(makeModel(), makeContext(), {
        reasoning: "medium",
      }).pipe(Effect.provide(layer));

      assert.deepStrictEqual(result, simpleMessage);
    }),
  );

  it.effect("complete fails if the stream never emits a terminal event", () =>
    Effect.gen(function* () {
      const brokenProvider: Ai.ApiProvider = {
        api: "openai-responses",
        stream: () =>
          Stream.make(
            decodeEvent({
              type: "start",
              partial: rawMessage,
            }),
          ),
        streamSimple: () =>
          Stream.make(
            decodeEvent({
              type: "start",
              partial: simpleMessage,
            }),
          ),
      };

      const result = yield* Ai.complete(makeModel(), makeContext()).pipe(
        Effect.provide(Ai.ProviderRegistryLive([brokenProvider])),
        Effect.flip,
      );

      assert.strictEqual(result._tag, "ProviderProtocolError");
    }),
  );
});
