import { Effect, Schema as S, Stream } from "effect";
import * as Ai from "./index.ts";
import { OpenAIResponsesProvider } from "./providers/openai/responses.ts";

const MODES = ["text", "tool", "tool-roundtrip", "abort"] as const;
type Mode = (typeof MODES)[number];

function parseMode(value: string | undefined): Mode {
  if (value === undefined) {
    return "tool-roundtrip";
  }
  if ((MODES as readonly string[]).includes(value)) {
    return value as Mode;
  }
  throw new Error(
    `Invalid mode: ${value}. Use one of: ${MODES.join(", ")}`,
  );
}

const MODE = parseMode(process.argv[2] ?? process.env.AI_TEMP_MODE);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required");
}

const model = S.decodeSync(Ai.Model)({
  id: "gpt-5.2",
  name: "GPT 5.2",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
  contextWindow: 400000,
  maxTokens: 8192,
}) as Ai.OpenAIResponsesModel;

const decodeContext = S.decodeSync(Ai.Context);
const decodeToolResultMessage = S.decodeSync(Ai.ToolResultMessage);

function providerOptions(
  options: Record<string, unknown>,
): Ai.ProviderStreamOptions {
  return options as unknown as Ai.ProviderStreamOptions;
}

const weatherTool = {
  name: "get_weather",
  description: "Get weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City name",
      },
    },
    required: ["city"],
    additionalProperties: false,
  },
} as const;

const textContext = decodeContext({
  systemPrompt: "Be concise but not too terse.",
  messages: [
    {
      role: "user",
      content:
        "Think first, then write 12 short bullets about Effect Streams. One bullet per line. No intro, no outro.",
      timestamp: Date.now(),
    },
  ],
});

const toolContext = decodeContext({
  messages: [
    {
      role: "user",
      content:
        "Use the get_weather tool for Zurich. Do not answer from memory. Call the tool.",
      timestamp: Date.now(),
    },
  ],
  tools: [weatherTool],
});

const abortController = new AbortController();

function logEvent(turn: string, event: Ai.AssistantMessageEvent) {
  switch (event.type) {
    case "start":
      console.log(`\n[${turn}] [start]`);
      break;
    case "thinking_start":
      console.log(`\n[${turn}] [thinking_start #${event.contentIndex}]`);
      break;
    case "thinking_delta":
      process.stdout.write(event.delta);
      break;
    case "thinking_end":
      console.log(`\n[${turn}] [thinking_end #${event.contentIndex}]`);
      break;
    case "text_start":
      console.log(`\n[${turn}] [text_start #${event.contentIndex}]`);
      break;
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "text_end":
      console.log(`\n[${turn}] [text_end #${event.contentIndex}]`);
      break;
    case "toolcall_start":
      console.log(`\n[${turn}] [toolcall_start #${event.contentIndex}]`);
      break;
    case "toolcall_delta":
      process.stdout.write(event.delta);
      break;
    case "toolcall_end":
      console.log(`\n[${turn}] [toolcall_end #${event.contentIndex}]`);
      console.log(JSON.stringify(event.toolCall, null, 2));
      break;
    case "done":
      console.log(`\n[${turn}] [done reason=${event.reason}]`);
      console.log(JSON.stringify(event.message, null, 2));
      break;
    case "error":
      console.log(`\n[${turn}] [error reason=${event.reason}]`);
      console.log(JSON.stringify(event.error, null, 2));
      break;
  }
}

async function runTurn(
  turn: string,
  context: Ai.Context,
  options: Ai.ProviderStreamOptions,
): Promise<Ai.AssistantMessage> {
  const layer = Ai.ProviderRegistryLive([OpenAIResponsesProvider]);

  const program = Effect.gen(function* () {
    const events = yield* Ai.stream(model, context, options);
    let terminal: Ai.AssistantMessage | undefined;

    yield* Stream.runForEach(events, (event) =>
      Effect.sync(() => {
        logEvent(turn, event);
        if (Ai.isTerminalAssistantMessageEvent(event)) {
          terminal = Ai.assistantMessageFromTerminalEvent(event);
        }
      }),
    );

    if (!terminal) {
      throw new Error(`No terminal event for turn: ${turn}`);
    }

    return terminal;
  }).pipe(Effect.provide(layer));

  return Effect.runPromise(program);
}

function getFirstToolCall(message: Ai.AssistantMessage): Ai.ToolCall {
  const toolCall = message.content.find(
    (block): block is Ai.ToolCall => block.type === "toolCall",
  );
  if (!toolCall) {
    throw new Error("Expected at least one tool call in assistant message");
  }
  return toolCall;
}

function makeWeatherToolResult(toolCall: Ai.ToolCall) {
  const city =
    typeof toolCall.arguments.city === "string" ? toolCall.arguments.city : "Unknown";

  return decodeToolResultMessage({
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          city,
          temperatureC: 12,
          conditions: "Light rain",
          windKph: 8,
          source: "temp.ts mock result",
        }),
      },
    ],
    details: {
      city,
      mocked: true,
    },
    status: "success",
    timestamp: Date.now(),
  });
}

async function main() {
  console.log(`[mode=${MODE}]`);

  if (MODE === "text") {
    await runTurn("turn-1", textContext, providerOptions({
      apiKey,
      reasoningEffort: "high",
      reasoningSummary: "detailed",
      maxTokens: 1500 as never,
    }));
    return;
  }

  if (MODE === "tool") {
    await runTurn("turn-1", toolContext, providerOptions({
      apiKey,
      maxTokens: 400 as never,
    }));
    return;
  }

  if (MODE === "abort") {
    setTimeout(() => abortController.abort(), 1500);
    await runTurn(
      "turn-1",
      decodeContext({
        ...textContext,
        messages: [
          {
            role: "user",
            content:
              "Write a long tutorial on Effect Streams with 40 bullets and short examples.",
            timestamp: Date.now(),
          },
        ],
      }),
      providerOptions({
        apiKey,
        signal: abortController.signal,
        reasoningEffort: "medium",
        reasoningSummary: "detailed",
        maxTokens: 4000 as never,
      }),
    );
    return;
  }

  const firstMessage = await runTurn("turn-1", toolContext, providerOptions({
    apiKey,
    maxTokens: 400 as never,
  }));

  if (firstMessage.stopReason !== "toolUse") {
    throw new Error(
      `Expected first turn to stop for tool use, got: ${firstMessage.stopReason}`,
    );
  }

  const toolCall = getFirstToolCall(firstMessage);
  const toolResult = makeWeatherToolResult(toolCall);

  console.log("\n[tool-result]");
  console.log(JSON.stringify(toolResult, null, 2));

  const secondContext: Ai.Context = {
    messages: [...toolContext.messages, firstMessage, toolResult],
    tools: toolContext.tools,
  };

  await runTurn("turn-2", secondContext, providerOptions({
    apiKey,
    maxTokens: 600 as never,
  }));
}

await main();
