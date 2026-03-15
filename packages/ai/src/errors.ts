import { Schema as S } from "effect";
import { AuthMissing } from "./auth-resolver.ts";
import { ProviderHttpError } from "./providers/openai/client.ts";

export { AuthMissing } from "./auth-resolver.ts";
export { ProviderHttpError } from "./providers/openai/client.ts";

export class ProviderNotFound extends S.TaggedErrorClass<ProviderNotFound>(
  "ProviderNotFound",
)("ProviderNotFound", {
  api: S.String,
}) {}

export class ProviderProtocolError extends S.TaggedErrorClass<ProviderProtocolError>(
  "ProviderProtocolError",
)("ProviderProtocolError", {
  provider: S.String,
  message: S.String,
}) {}

export class ToolValidationError extends S.TaggedErrorClass<ToolValidationError>(
  "ToolValidationError",
)("ToolValidationError", {
  toolName: S.String,
  message: S.String,
}) {}

export class Aborted extends S.TaggedErrorClass<Aborted>("Aborted")("Aborted", {
  message: S.String,
}) {}

export class ReducerMissingStart extends S.TaggedErrorClass<ReducerMissingStart>(
  "ReducerMissingStart",
)("ReducerMissingStart", {
  eventType: S.String,
}) {}

export class ReducerDuplicateStart extends S.TaggedErrorClass<ReducerDuplicateStart>(
  "ReducerDuplicateStart",
)("ReducerDuplicateStart", {}) {}

export class ReducerInvalidContentIndex extends S.TaggedErrorClass<ReducerInvalidContentIndex>(
  "ReducerInvalidContentIndex",
)("ReducerInvalidContentIndex", {
  contentIndex: S.Number,
  contentLength: S.Number,
}) {}

export class ReducerBlockTypeMismatch extends S.TaggedErrorClass<ReducerBlockTypeMismatch>(
  "ReducerBlockTypeMismatch",
)("ReducerBlockTypeMismatch", {
  contentIndex: S.Number,
  expected: S.String,
  actual: S.String,
}) {}

export class ReducerTerminalStateViolation extends S.TaggedErrorClass<ReducerTerminalStateViolation>(
  "ReducerTerminalStateViolation",
)("ReducerTerminalStateViolation", {
  eventType: S.String,
}) {}

export const ReducerError = S.Union([
  ReducerMissingStart,
  ReducerDuplicateStart,
  ReducerInvalidContentIndex,
  ReducerBlockTypeMismatch,
  ReducerTerminalStateViolation,
]);

export const ProviderStreamError = S.Union([
  AuthMissing,
  ProviderHttpError,
  ProviderProtocolError,
  ToolValidationError,
  Aborted,
]);

export const AiError = S.Union([
  ProviderNotFound,
  ProviderStreamError,
  ReducerError,
]);
