import type {
  Api,
  AssistantMessage,
  Message,
  ProviderModel as Model,
  ToolCall,
  ToolResultMessage,
} from "../types.ts";

/**
 * Normalize tool call ID for cross-provider compatibility.
 * OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
 * Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
 */
export function transformMessages<TApi extends Api>(
  messages: ReadonlyArray<Message>,
  model: Model<TApi>,
  normalizeToolCallId?: (
    id: string,
    model: Model<TApi>,
    source: AssistantMessage,
  ) => string,
): Message[] {
  // Build a map of original tool call IDs to normalized IDs
  const toolCallIdMap = new Map<string, string>();

  // First pass: transform messages (thinking blocks, tool call ID normalization)
  const transformed = messages.map((msg): Message => {
    // User messages pass through unchanged
    if (msg.role === "user") {
      return msg;
    }

    // Handle toolResult messages - normalize toolCallId if we have a mapping
    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }
      return msg;
    }

    // Assistant messages need transformation check
    const assistantMsg = msg as AssistantMessage;
    const isSameModel =
      assistantMsg.provider === model.provider &&
      assistantMsg.api === model.api &&
      assistantMsg.model === model.id;

    const transformedContent = assistantMsg.content.reduce<
      Array<AssistantMessage["content"][number]>
    >((acc, block) => {
      if (block.type === "thinking") {
        // Redacted thinking is opaque encrypted content, only valid for the same model.
        // Drop it for cross-model to avoid API errors.
        if (block.redacted) {
          if (isSameModel) {
            acc.push(block);
          }
          return acc;
        }

        // For same model: keep thinking blocks with signatures (needed for replay)
        // even if the thinking text is empty (OpenAI encrypted reasoning)
        if (isSameModel && block.thinkingSignature) {
          acc.push(block);
          return acc;
        }

        // Skip empty thinking blocks, convert others to plain text
        if (!block.thinking || block.thinking.trim() === "") {
          return acc;
        }

        if (isSameModel) {
          acc.push(block);
          return acc;
        }

        acc.push({
          type: "text",
          text: block.thinking,
        });
        return acc;
      }

      if (block.type === "text") {
        if (isSameModel) {
          acc.push(block);
          return acc;
        }

        acc.push({
          type: "text",
          text: block.text,
        });
        return acc;
      }

      if (block.type === "toolCall") {
        let normalizedToolCall: ToolCall = block;

        if (!isSameModel && block.thoughtSignature) {
          normalizedToolCall = { ...block };
          delete (normalizedToolCall as { thoughtSignature?: string })
            .thoughtSignature;
        }

        if (!isSameModel && normalizeToolCallId) {
          const normalizedId = normalizeToolCallId(
            block.id,
            model,
            assistantMsg,
          );
          if (normalizedId !== block.id) {
            toolCallIdMap.set(block.id, normalizedId);
            normalizedToolCall = {
              ...normalizedToolCall,
              id: normalizedId as never,
            };
          }
        }

        acc.push(normalizedToolCall);
        return acc;
      }

      acc.push(block);
      return acc;
    }, []);

    return {
      ...assistantMsg,
      content: transformedContent,
    };
  });

  const result: Message[] = [];
  let pendingToolCalls: ToolCall[] = [];
  let existingToolResultIds = new Set<string>();

  for (const msg of transformed) {
    if (msg.role === "assistant") {
      // If we have pending orphaned tool calls from a previous assistant, insert synthetic results now
      if (pendingToolCalls.length > 0) {
        for (const toolCall of pendingToolCalls) {
          if (!existingToolResultIds.has(toolCall.id)) {
            result.push({
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text: "No result provided" }],
              status: "error",
              timestamp: Date.now() as never,
            } as ToolResultMessage);
          }
        }
        pendingToolCalls = [];
        existingToolResultIds = new Set();
      }

      // Skip errored/aborted assistant messages entirely.
      // These are incomplete turns that shouldn't be replayed:
      // - May have partial content (reasoning without message, incomplete tool calls)
      // - Replaying them can cause API errors (e.g., OpenAI "reasoning without following item")
      // - The model should retry from the last valid state
      if (msg.stopReason === "error" || msg.stopReason === "aborted") {
        continue;
      }

      // Track tool calls from this assistant message
      const toolCalls = msg.content.filter(
        (block): block is ToolCall => block.type === "toolCall",
      );

      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = new Set();
      }

      result.push(msg);
      continue;
    }

    if (msg.role === "toolResult") {
      existingToolResultIds.add(msg.toolCallId);
      result.push(msg);
      continue;
    }

    // User message interrupts tool flow - insert synthetic results for orphaned calls
    if (pendingToolCalls.length > 0) {
      for (const toolCall of pendingToolCalls) {
        if (!existingToolResultIds.has(toolCall.id)) {
          result.push({
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: "No result provided" }],
            status: "error",
            timestamp: Date.now() as never,
          } as ToolResultMessage);
        }
      }
      pendingToolCalls = [];
      existingToolResultIds = new Set();
    }

    result.push(msg);
  }

  return result;
}
