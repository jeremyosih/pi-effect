import { Effect, Stream, Option } from "effect";
import * as Errors from "./errors.ts";
import { foldTerminalMessage } from "./utils/assistant-events.ts";
import { ProviderRegistry } from "./provider.ts";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ProviderModel,
  ProviderStreamOptions,
  SimpleStreamOptions,
} from "./types.ts";

export const stream = Effect.fn("ai.stream")(function* <TApi extends Api>(
  model: ProviderModel<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
) {
  const registry = yield* ProviderRegistry;
  const provider = yield* registry.resolve(model.api);
  return provider.stream(model, context, options);
});

export const streamSimple = Effect.fn("ai.streamSimple")(function* <TApi extends Api>(
  model: ProviderModel<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const registry = yield* ProviderRegistry;
  const provider = yield* registry.resolve(model.api);
  return provider.streamSimple(model, context, options);
});

export const complete = Effect.fn("ai.complete")(function* <TApi extends Api>(
  model: ProviderModel<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
) {
  const events = yield* stream(model, context, options);

  const message = yield* Stream.runFold(events, Option.none<AssistantMessage>, foldTerminalMessage);

  if (Option.isNone(message)) {
    return yield* new Errors.ProviderProtocolError({
      provider: model.provider,
      message: "Stream ended without terminal done/error event",
    });
  }

  return message.value;
});

export const completeSimple = Effect.fn("ai.completeSimple")(function* <TApi extends Api>(
  model: ProviderModel<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const events = yield* streamSimple(model, context, options);

  const message = yield* Stream.runFold(events, Option.none<AssistantMessage>, foldTerminalMessage);

  if (Option.isNone(message)) {
    return yield* new Errors.ProviderProtocolError({
      provider: model.provider,
      message: "Stream ended without terminal done/error event",
    });
  }

  return message.value;
});
