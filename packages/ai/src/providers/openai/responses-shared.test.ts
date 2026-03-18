import { Schema as S } from "effect";
import { describe, expect, it } from "vitest";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { Model, type AssistantMessage, type Context } from "../../types.ts";
import { shortHash } from "../../utils/hash.ts";
import { convertResponsesMessages, processResponsesEvents } from "./responses-shared.ts";

const decodeModel = S.decodeSync(Model);

const makeModel = (overrides?: Partial<typeof Model.Type>) =>
  ({
    ...decodeModel({
      id: "gpt-test",
      name: "GPT Test",
      api: "openai-responses",
      provider: "openai",
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
    }),
    ...overrides,
  }) as typeof Model.Type;

const makeInitialAssistantMessage = (model = makeModel()): AssistantMessage =>
  ({
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0 as never,
      output: 0 as never,
      cacheRead: 0 as never,
      cacheWrite: 0 as never,
      totalTokens: 0 as never,
      cost: {
        input: 0 as never,
        output: 0 as never,
        cacheRead: 0 as never,
        cacheWrite: 0 as never,
        total: 0 as never,
      },
    },
    stopReason: "stop",
    timestamp: 0 as never,
  }) as AssistantMessage;

async function collectProcess(
  events: ReadonlyArray<ResponseStreamEvent>,
  initialOutput = makeInitialAssistantMessage(),
  model = makeModel(),
) {
  const generator = processResponsesEvents(
    (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
    initialOutput,
    model,
    {
      applyServiceTierPricing: (usage, tier) =>
        tier === "priority"
          ? ({
              ...usage,
              cost: {
                ...usage.cost,
                input: (usage.cost.input * 2) as typeof usage.cost.input,
                output: (usage.cost.output * 2) as typeof usage.cost.output,
                cacheRead: (usage.cost.cacheRead * 2) as typeof usage.cost.cacheRead,
                cacheWrite: (usage.cost.cacheWrite * 2) as typeof usage.cost.cacheWrite,
                total: ((usage.cost.total ?? 0) * 2) as NonNullable<typeof usage.cost.total>,
              },
            } as typeof usage)
          : usage,
    },
  );

  const collected = new Array<unknown>();
  while (true) {
    const next = await generator.next();
    if (next.done) {
      return {
        events: collected,
        finalMessage: next.value,
      };
    }
    collected.push(next.value);
  }
}

describe("openai responses shared", () => {
  it("maps system prompt to developer role for reasoning models", () => {
    const model = makeModel();
    const context = {
      systemPrompt: "You are helpful.",
      messages: [
        {
          role: "user",
          content: "hi",
          timestamp: 0 as never,
        },
      ],
    } as Context;

    const messages = convertResponsesMessages(
      model,
      context,
      new Set(["openai", "openai-codex", "opencode"]),
    );

    expect(messages[0]).toEqual({
      role: "developer",
      content: "You are helpful.",
    });
  });

  it("hashes long same-model text signatures to OpenAI-safe ids", () => {
    const model = makeModel();
    const longId = "x".repeat(80);
    const context = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "hello",
              textSignature: longId as never,
            },
          ],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: makeInitialAssistantMessage(model).usage,
          stopReason: "stop",
          timestamp: 0 as never,
        },
      ],
    } as Context;

    const messages = convertResponsesMessages(
      model,
      context,
      new Set(["openai", "openai-codex", "opencode"]),
    );

    expect(messages[0]).toMatchObject({
      type: "message",
      id: `msg_${shortHash(longId)}`,
    });
  });

  it("normalizes cross-model tool call ids and omits OpenAI function-call id", () => {
    const model = makeModel();
    const context = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call!id|item!id" as never,
              name: "lookup",
              arguments: { city: "Paris" },
            },
          ],
          api: model.api,
          provider: model.provider,
          model: "older-model" as never,
          usage: makeInitialAssistantMessage(model).usage,
          stopReason: "stop",
          timestamp: 0 as never,
        },
      ],
    } as Context;

    const messages = convertResponsesMessages(
      model,
      context,
      new Set(["openai", "openai-codex", "opencode"]),
    );

    expect(messages[0]).toMatchObject({
      type: "function_call",
      call_id: "call_id",
      name: "lookup",
      arguments: '{"city":"Paris"}',
    });
    expect(messages[0]).not.toHaveProperty("id");
  });

  it("reduces raw response events into canonical events and final state", async () => {
    const model = makeModel();
    const { events, finalMessage } = await collectProcess(
      [
        {
          type: "response.output_item.added",
          item: {
            type: "reasoning",
            id: "rs_1",
            summary: [],
          },
        } as any,
        {
          type: "response.reasoning_summary_part.added",
          part: { type: "summary_text", text: "" },
        } as any,
        {
          type: "response.reasoning_summary_text.delta",
          delta: "think",
        } as any,
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_1",
            summary: [{ text: "think" }],
          },
        } as any,
        {
          type: "response.output_item.added",
          item: {
            type: "message",
            id: "msg_1",
            content: [],
          },
        } as any,
        {
          type: "response.content_part.added",
          part: {
            type: "output_text",
            text: "",
            annotations: [],
          },
        } as any,
        {
          type: "response.output_text.delta",
          delta: "hello",
        } as any,
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            id: "msg_1",
            content: [{ type: "output_text", text: "hello" }],
          },
        } as any,
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "lookup",
            arguments: "{",
          },
        } as any,
        {
          type: "response.function_call_arguments.delta",
          delta: '"city":"Paris"}',
        } as any,
        {
          type: "response.function_call_arguments.done",
          arguments: '{"city":"Paris"}',
        } as any,
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "lookup",
            arguments: '{"city":"Paris"}',
          },
        } as any,
        {
          type: "response.completed",
          response: {
            status: "completed",
            service_tier: "priority",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: { cached_tokens: 2 },
            },
          },
        } as any,
      ],
      makeInitialAssistantMessage(model),
      model,
    );

    expect(events.map((event: any) => event.type)).toEqual([
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "text_start",
      "text_delta",
      "text_end",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
    ]);

    expect(finalMessage.stopReason).toBe("toolUse");
    expect(finalMessage.content).toMatchObject([
      { type: "thinking", thinking: "think" },
      { type: "text", text: "hello" },
      {
        type: "toolCall",
        id: "call_1|fc_1",
        name: "lookup",
        arguments: { city: "Paris" },
      },
    ]);
    expect(finalMessage.usage).toMatchObject({
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

  it("fails with ProviderProtocolError on invalid final tool arguments JSON", async () => {
    const iterator = processResponsesEvents(
      (async function* () {
        yield {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "lookup",
            arguments: "{",
          },
        } as any;
        yield {
          type: "response.function_call_arguments.done",
          arguments: "not-json",
        } as any;
      })(),
      makeInitialAssistantMessage(),
      makeModel(),
    );

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "toolcall_start" },
      done: false,
    });
    await expect(iterator.next()).rejects.toMatchObject({
      _tag: "ProviderProtocolError",
    });
  });
});
