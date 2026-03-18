import { Match, Option } from "effect";
import { AssistantMessage, AssistantMessageEvent } from "../types.ts";
//Todo: Cleanup this  file certain function are redundants

export type TerminalAssistantMessageEvent = Extract<
  AssistantMessageEvent,
  { readonly type: "done" | "error" }
>;

export const isTerminalAssistantMessageEvent = (
  event: AssistantMessageEvent,
): event is TerminalAssistantMessageEvent =>
  Match.type<AssistantMessageEvent>().pipe(
    Match.discriminatorsExhaustive("type")({
      start: () => false,
      text_start: () => false,
      text_delta: () => false,
      text_end: () => false,
      thinking_start: () => false,
      thinking_delta: () => false,
      thinking_end: () => false,
      toolcall_start: () => false,
      toolcall_delta: () => false,
      toolcall_end: () => false,
      done: () => true,
      error: () => true,
    }),
  )(event);

export const assistantMessageFromTerminalEvent = (event: TerminalAssistantMessageEvent) =>
  Match.type<TerminalAssistantMessageEvent>().pipe(
    Match.discriminatorsExhaustive("type")({
      done: ({ message }) => message,
      error: ({ error }) => error,
    }),
  )(event);

export const assistantMessageFromEvent = (event: AssistantMessageEvent) =>
  Match.type<AssistantMessageEvent>().pipe(
    Match.discriminatorsExhaustive("type")({
      start: ({ partial }) => partial,
      text_start: ({ partial }) => partial,
      text_delta: ({ partial }) => partial,
      text_end: ({ partial }) => partial,
      thinking_start: ({ partial }) => partial,
      thinking_delta: ({ partial }) => partial,
      thinking_end: ({ partial }) => partial,
      toolcall_start: ({ partial }) => partial,
      toolcall_delta: ({ partial }) => partial,
      toolcall_end: ({ partial }) => partial,
      done: ({ message }) => message,
      error: ({ error }) => error,
    }),
  )(event);

export const foldTerminalMessage = (
  current: Option.Option<AssistantMessage>,
  event: AssistantMessageEvent,
) =>
  Match.type<AssistantMessageEvent>().pipe(
    Match.discriminatorsExhaustive("type")({
      start: () => current,
      text_start: () => current,
      text_delta: () => current,
      text_end: () => current,
      thinking_start: () => current,
      thinking_delta: () => current,
      thinking_end: () => current,
      toolcall_start: () => current,
      toolcall_delta: () => current,
      toolcall_end: () => current,
      done: ({ message }) => Option.some(message),
      error: ({ error }) => Option.some(error),
    }),
  )(event);
