import type OpenAI from "openai";
import { Schema as S } from "effect";
import type {
  Tool as OpenAITool,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputText,
  ResponseOutputMessage,
  ResponseReasoningItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import * as Errors from "../../errors.ts";
import { calculateCost } from "../../models.ts";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  ProviderModel as Model,
  StopReason,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  Usage,
} from "../../types.ts";
import { shortHash } from "../../utils/hash.ts";
import { decodeCompletedJson, parseStreamingJson } from "../../utils/json-parse.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { transformMessages } from "../transform-messages.ts";

type TextSignaturePhase = "commentary" | "final_answer";
type TextSignatureV1 = {
  v: 1;
  id: string;
  phase?: TextSignaturePhase;
};

type MutableDeep<T> =
  T extends ReadonlyArray<infer U>
    ? Array<MutableDeep<U>>
    : T extends object
      ? { -readonly [K in keyof T]: MutableDeep<T[K]> }
      : T;

type MutableUsage = MutableDeep<Usage>;
type MutableTextContent = MutableDeep<TextContent>;
type MutableThinkingContent = MutableDeep<ThinkingContent>;
type MutableToolCall = MutableDeep<ToolCall> & { partialJson?: string };
type MutableAssistantContent = MutableTextContent | MutableThinkingContent | MutableToolCall;
type MutableAssistantMessage = MutableDeep<AssistantMessage> & {
  content: Array<MutableAssistantContent>;
  usage: MutableUsage;
};

// =============================================================================
// Utilities
// =============================================================================

function encodeTextSignatureV1(id: string, phase?: TextSignatureV1["phase"]): string {
  const payload: TextSignatureV1 = { v: 1, id };
  if (phase) {
    payload.phase = phase;
  }
  return JSON.stringify(payload);
}

function parseTextSignature(
  signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
  if (!signature) {
    return undefined;
  }
  if (signature.startsWith("{")) {
    try {
      const parsed = JSON.parse(signature) as Partial<TextSignatureV1>;
      if (parsed.v === 1 && typeof parsed.id === "string") {
        if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
          return { id: parsed.id, phase: parsed.phase };
        }
        return { id: parsed.id };
      }
    } catch {
      // Fall through to legacy plain-string handling.
    }
  }
  return { id: signature };
}

function decodeToolArguments(provider: string, json: string | undefined) {
  try {
    return decodeCompletedJson(json);
  } catch (error) {
    throw new Errors.ProviderProtocolError({
      provider,
      message: S.isSchemaError(error)
        ? `Invalid tool call arguments JSON: ${error.message}`
        : `Invalid tool call arguments JSON: ${String(error)}`,
    });
  }
}

function toMutableUsage(usage: Usage): MutableUsage {
  return {
    ...usage,
    cost: {
      ...usage.cost,
    },
  } as MutableUsage;
}

function toUsageSnapshot(usage: MutableUsage): Usage {
  return {
    ...usage,
    cost: {
      ...usage.cost,
    },
  } as Usage;
}

function toMutableAssistantContent(
  content: AssistantMessage["content"][number],
): MutableAssistantContent {
  if (content.type === "text") {
    return {
      type: "text",
      text: content.text,
      ...(content.textSignature !== undefined ? { textSignature: content.textSignature } : {}),
    } as MutableTextContent;
  }

  if (content.type === "thinking") {
    return {
      type: "thinking",
      thinking: content.thinking,
      ...(content.thinkingSignature !== undefined
        ? { thinkingSignature: content.thinkingSignature }
        : {}),
      ...(content.redacted !== undefined ? { redacted: content.redacted } : {}),
    } as MutableThinkingContent;
  }

  return {
    type: "toolCall",
    id: content.id,
    name: content.name,
    arguments: { ...content.arguments },
    ...(content.thoughtSignature !== undefined
      ? { thoughtSignature: content.thoughtSignature }
      : {}),
  } as MutableToolCall;
}

function toAssistantContentSnapshot(
  content: MutableAssistantContent,
): AssistantMessage["content"][number] {
  if (content.type === "text") {
    return {
      type: "text",
      text: content.text,
      ...(content.textSignature !== undefined ? { textSignature: content.textSignature } : {}),
    } as TextContent;
  }

  if (content.type === "thinking") {
    return {
      type: "thinking",
      thinking: content.thinking,
      ...(content.thinkingSignature !== undefined
        ? { thinkingSignature: content.thinkingSignature }
        : {}),
      ...(content.redacted !== undefined ? { redacted: content.redacted } : {}),
    } as ThinkingContent;
  }

  return {
    type: "toolCall",
    id: content.id,
    name: content.name,
    arguments: { ...content.arguments },
    ...(content.thoughtSignature !== undefined
      ? { thoughtSignature: content.thoughtSignature }
      : {}),
  } as ToolCall;
}

function toMutableAssistantMessage(message: AssistantMessage): MutableAssistantMessage {
  return {
    ...message,
    content: message.content.map(toMutableAssistantContent),
    usage: toMutableUsage(message.usage),
  } as MutableAssistantMessage;
}

function toAssistantMessageSnapshot(message: MutableAssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map(toAssistantContentSnapshot) as AssistantMessage["content"],
    usage: toUsageSnapshot(message.usage),
  } as AssistantMessage;
}

export interface OpenAIResponsesStreamOptions {
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
  applyServiceTierPricing?: (
    usage: Usage,
    serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  ) => Usage;
}

export interface ConvertResponsesMessagesOptions {
  includeSystemPrompt?: boolean;
}

export interface ConvertResponsesToolsOptions {
  strict?: boolean | null;
}

// =============================================================================
// Message conversion
// =============================================================================

export function convertResponsesMessages<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  allowedToolCallProviders: ReadonlySet<string>,
  options?: ConvertResponsesMessagesOptions,
): ResponseInput {
  const messages: ResponseInput = [];

  const normalizeToolCallId = (id: string): string => {
    if (!allowedToolCallProviders.has(model.provider)) {
      return id;
    }
    if (!id.includes("|")) {
      return id;
    }
    const [callId, itemId] = id.split("|");
    const sanitizedCallId = callId.replace(/[^a-zA-Z0-9_-]/g, "_");
    let sanitizedItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "_");
    // OpenAI Responses API requires item id to start with "fc"
    if (!sanitizedItemId.startsWith("fc")) {
      sanitizedItemId = `fc_${sanitizedItemId}`;
    }
    // Truncate to 64 chars and strip trailing underscores (OpenAI Codex rejects them)
    let normalizedCallId =
      sanitizedCallId.length > 64 ? sanitizedCallId.slice(0, 64) : sanitizedCallId;
    let normalizedItemId =
      sanitizedItemId.length > 64 ? sanitizedItemId.slice(0, 64) : sanitizedItemId;
    normalizedCallId = normalizedCallId.replace(/_+$/, "");
    normalizedItemId = normalizedItemId.replace(/_+$/, "");
    return `${normalizedCallId}|${normalizedItemId}`;
  };

  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

  const includeSystemPrompt = options?.includeSystemPrompt ?? true;
  if (includeSystemPrompt && context.systemPrompt) {
    const role = model.reasoning ? "developer" : "system";
    messages.push({
      role,
      content: sanitizeSurrogates(context.systemPrompt),
    });
  }

  let msgIndex = 0;
  for (const msg of transformedMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({
          role: "user",
          content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
        });
      } else {
        const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
          if (item.type === "text") {
            return {
              type: "input_text",
              text: sanitizeSurrogates(item.text),
            } satisfies ResponseInputText;
          }
          return {
            type: "input_image",
            detail: "auto",
            image_url: `data:${item.mimeType};base64,${item.data}`,
          } satisfies ResponseInputImage;
        });
        const filteredContent = !model.input.includes("image")
          ? content.filter((c) => c.type !== "input_image")
          : content;
        if (filteredContent.length === 0) {
          continue;
        }
        messages.push({
          role: "user",
          content: filteredContent,
        });
      }
    } else if (msg.role === "assistant") {
      const output: ResponseInput = [];
      const assistantMsg = msg as AssistantMessage;
      const isDifferentModel =
        assistantMsg.model !== model.id &&
        assistantMsg.provider === model.provider &&
        assistantMsg.api === model.api;

      for (const block of msg.content) {
        if (block.type === "thinking") {
          if (block.thinkingSignature) {
            const reasoningItem = JSON.parse(block.thinkingSignature) as ResponseReasoningItem;
            output.push(reasoningItem);
          }
        } else if (block.type === "text") {
          const textBlock = block as TextContent;
          const parsedSignature = parseTextSignature(textBlock.textSignature);
          // OpenAI requires id to be max 64 characters
          let msgId = parsedSignature?.id;
          if (!msgId) {
            msgId = `msg_${msgIndex}`;
          } else if (msgId.length > 64) {
            msgId = `msg_${shortHash(msgId)}`;
          }
          output.push({
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: sanitizeSurrogates(textBlock.text),
                annotations: [],
              },
            ],
            status: "completed",
            id: msgId,
            ...(parsedSignature?.phase !== undefined ? { phase: parsedSignature.phase } : {}),
          } satisfies ResponseOutputMessage);
        } else if (block.type === "toolCall") {
          const toolCall = block as ToolCall;
          const [callId, itemIdRaw] = toolCall.id.split("|");
          let itemId: string | undefined = itemIdRaw;

          // For different-model messages, set id to undefined to avoid pairing validation.
          // OpenAI tracks which fc_xxx IDs were paired with rs_xxx reasoning items.
          // By omitting the id, we avoid triggering that validation (like cross-provider does).
          if (isDifferentModel && itemId?.startsWith("fc_")) {
            itemId = undefined;
          }

          output.push({
            type: "function_call",
            call_id: callId,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
            ...(itemId !== undefined ? { id: itemId } : {}),
          } satisfies ResponseFunctionToolCall);
        }
      }
      if (output.length === 0) {
        continue;
      }
      messages.push(...output);
    } else if (msg.role === "toolResult") {
      // Extract text and image content
      const textResult = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const hasImages = msg.content.some((c): c is ImageContent => c.type === "image");

      // Always send function_call_output with text (or placeholder if only images)
      const hasText = textResult.length > 0;
      const [callId] = msg.toolCallId.split("|");
      messages.push({
        type: "function_call_output",
        call_id: callId,
        output: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
      });

      // If there are images and model supports them, send a follow-up user message with images
      if (hasImages && model.input.includes("image")) {
        const contentParts: ResponseInputContent[] = [];

        // Add text prefix
        contentParts.push({
          type: "input_text",
          text: "Attached image(s) from tool result:",
        } satisfies ResponseInputText);

        // Add images
        for (const block of msg.content) {
          if (block.type === "image") {
            contentParts.push({
              type: "input_image",
              detail: "auto",
              image_url: `data:${block.mimeType};base64,${block.data}`,
            } satisfies ResponseInputImage);
          }
        }

        messages.push({
          role: "user",
          content: contentParts,
        });
      }
    }
    msgIndex++;
  }

  return messages;
}

// =============================================================================
// Tool conversion
// =============================================================================

export function convertResponsesTools(
  tools: ReadonlyArray<Tool>,
  options?: ConvertResponsesToolsOptions,
): OpenAITool[] {
  const strict = options?.strict === undefined ? false : options.strict;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    strict,
  }));
}

// =============================================================================
// Stream processing
// =============================================================================

export async function* processResponsesEvents<TApi extends Api>(
  openaiStream: AsyncIterable<ResponseStreamEvent>,
  initialOutput: AssistantMessage,
  model: Model<TApi>,
  options?: OpenAIResponsesStreamOptions,
): AsyncGenerator<AssistantMessageEvent, AssistantMessage, void> {
  const output = toMutableAssistantMessage(initialOutput);

  let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null =
    null;
  let currentBlock: MutableThinkingContent | MutableTextContent | MutableToolCall | null = null;

  const blockIndex = () => (output.content.length - 1) as never;
  const snapshot = () => toAssistantMessageSnapshot(output);

  for await (const event of openaiStream) {
    if (event.type === "response.output_item.added") {
      const item = event.item;

      if (item.type === "reasoning") {
        currentItem = item;
        currentBlock = { type: "thinking", thinking: "" };
        output.content.push(currentBlock);
        yield {
          type: "thinking_start",
          contentIndex: blockIndex(),
          partial: snapshot(),
        };
      } else if (item.type === "message") {
        currentItem = item;
        currentBlock = { type: "text", text: "" };
        output.content.push(currentBlock);
        yield {
          type: "text_start",
          contentIndex: blockIndex(),
          partial: snapshot(),
        };
      } else if (item.type === "function_call") {
        currentItem = item;
        currentBlock = {
          type: "toolCall",
          id: `${item.call_id}|${item.id}` as never,
          name: item.name,
          arguments: {},
          partialJson: item.arguments || "",
        };
        output.content.push(currentBlock);
        yield {
          type: "toolcall_start",
          contentIndex: blockIndex(),
          partial: snapshot(),
        };
      }
    } else if (event.type === "response.reasoning_summary_part.added") {
      if (currentItem && currentItem.type === "reasoning") {
        currentItem.summary = currentItem.summary || [];
        currentItem.summary.push(event.part);
      }
    } else if (event.type === "response.reasoning_summary_text.delta") {
      if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
        currentItem.summary = currentItem.summary || [];
        const lastPart = currentItem.summary[currentItem.summary.length - 1];

        if (lastPart) {
          currentBlock.thinking += event.delta;
          lastPart.text += event.delta;
          yield {
            type: "thinking_delta",
            contentIndex: blockIndex(),
            delta: event.delta,
            partial: snapshot(),
          };
        }
      }
    } else if (event.type === "response.reasoning_summary_part.done") {
      if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
        currentItem.summary = currentItem.summary || [];
        const lastPart = currentItem.summary[currentItem.summary.length - 1];

        if (lastPart) {
          currentBlock.thinking += "\n\n";
          lastPart.text += "\n\n";
          yield {
            type: "thinking_delta",
            contentIndex: blockIndex(),
            delta: "\n\n",
            partial: snapshot(),
          };
        }
      }
    } else if (event.type === "response.content_part.added") {
      if (currentItem?.type === "message") {
        currentItem.content = currentItem.content || [];
        if (event.part.type === "output_text" || event.part.type === "refusal") {
          currentItem.content.push(event.part);
        }
      }
    } else if (event.type === "response.output_text.delta") {
      if (currentItem?.type === "message" && currentBlock?.type === "text") {
        if (!currentItem.content || currentItem.content.length === 0) {
          continue;
        }

        const lastPart = currentItem.content[currentItem.content.length - 1];
        if (lastPart?.type === "output_text") {
          currentBlock.text += event.delta;
          lastPart.text += event.delta;
          yield {
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: event.delta,
            partial: snapshot(),
          };
        }
      }
    } else if (event.type === "response.refusal.delta") {
      if (currentItem?.type === "message" && currentBlock?.type === "text") {
        if (!currentItem.content || currentItem.content.length === 0) {
          continue;
        }

        const lastPart = currentItem.content[currentItem.content.length - 1];
        if (lastPart?.type === "refusal") {
          currentBlock.text += event.delta;
          lastPart.refusal += event.delta;
          yield {
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: event.delta,
            partial: snapshot(),
          };
        }
      }
    } else if (event.type === "response.function_call_arguments.delta") {
      if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
        currentBlock.partialJson = (currentBlock.partialJson || "") + event.delta;
        currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
        yield {
          type: "toolcall_delta",
          contentIndex: blockIndex(),
          delta: event.delta,
          partial: snapshot(),
        };
      }
    } else if (event.type === "response.function_call_arguments.done") {
      if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
        currentBlock.partialJson = event.arguments;
        currentBlock.arguments = decodeToolArguments(model.provider, currentBlock.partialJson);
      }
    } else if (event.type === "response.output_item.done") {
      const item = event.item;

      if (item.type === "reasoning" && currentBlock?.type === "thinking") {
        currentBlock.thinking = item.summary?.map((summary) => summary.text).join("\n\n") || "";
        currentBlock.thinkingSignature = JSON.stringify(item) as never;
        yield {
          type: "thinking_end",
          contentIndex: blockIndex(),
          content: currentBlock.thinking,
          partial: snapshot(),
        };
        currentBlock = null;
      } else if (item.type === "message" && currentBlock?.type === "text") {
        currentBlock.text = item.content
          .map((content) => (content.type === "output_text" ? content.text : content.refusal))
          .join("");
        currentBlock.textSignature = encodeTextSignatureV1(
          item.id,
          item.phase ?? undefined,
        ) as never;
        yield {
          type: "text_end",
          contentIndex: blockIndex(),
          content: currentBlock.text,
          partial: snapshot(),
        };
        currentBlock = null;
      } else if (item.type === "function_call") {
        const toolCallBlock = currentBlock?.type === "toolCall" ? currentBlock : undefined;

        if (toolCallBlock) {
          toolCallBlock.arguments =
            toolCallBlock.partialJson !== undefined && toolCallBlock.partialJson.trim() !== ""
              ? decodeToolArguments(model.provider, toolCallBlock.partialJson)
              : decodeToolArguments(model.provider, item.arguments || "{}");
        }

        const toolCall: ToolCall = {
          type: "toolCall",
          id: `${item.call_id}|${item.id}` as never,
          name: item.name,
          arguments:
            toolCallBlock?.arguments ?? decodeToolArguments(model.provider, item.arguments || "{}"),
        };

        yield {
          type: "toolcall_end",
          contentIndex: blockIndex(),
          toolCall,
          partial: snapshot(),
        };
        currentBlock = null;
      }
    } else if (event.type === "response.completed") {
      const response = event.response;

      if (response?.usage) {
        const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
        const usageWithoutCost = {
          // OpenAI includes cached tokens in input_tokens, so subtract to get non-cached input
          input: ((response.usage.input_tokens || 0) - cachedTokens) as never,
          output: (response.usage.output_tokens || 0) as never,
          cacheRead: cachedTokens as never,
          cacheWrite: 0 as never,
          totalTokens: (response.usage.total_tokens || 0) as never,
          cost: {
            input: 0 as never,
            output: 0 as never,
            cacheRead: 0 as never,
            cacheWrite: 0 as never,
            total: 0 as never,
          },
        } as Usage;

        let nextUsage = {
          ...usageWithoutCost,
          cost: calculateCost(model, usageWithoutCost),
        } as Usage;

        if (options?.applyServiceTierPricing) {
          const serviceTier = response?.service_tier ?? options.serviceTier;
          nextUsage = options.applyServiceTierPricing(nextUsage, serviceTier);
        }

        output.usage = toMutableUsage(nextUsage);
      }

      output.stopReason = mapStopReason(response?.status) as MutableAssistantMessage["stopReason"];

      if (
        output.content.some((block) => block.type === "toolCall") &&
        output.stopReason === "stop"
      ) {
        output.stopReason = "toolUse";
      }
    } else if (event.type === "error") {
      throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
    } else if (event.type === "response.failed") {
      const error = event.response?.error;
      const details = event.response?.incomplete_details;
      const message = error
        ? `${error.code || "unknown"}: ${error.message || "no message"}`
        : details?.reason
          ? `incomplete: ${details.reason}`
          : "Unknown error (no error details in response)";

      throw new Error(message);
    }
  }

  return snapshot();
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
  if (!status) {
    return "stop";
  }
  switch (status) {
    case "completed":
      return "stop";
    case "incomplete":
      return "length";
    case "failed":
    case "cancelled":
      return "error";
    // These two are wonky ...
    case "in_progress":
    case "queued":
      return "stop";
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled stop reason: ${_exhaustive}`);
    }
  }
}
