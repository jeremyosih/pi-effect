import { parse as partialParse } from "partial-json";
import { Schema as S } from "effect";

export const JsonObject = S.Record(S.String, S.Unknown);
export type JsonObject = typeof JsonObject.Type;

const decodeJsonObject = S.decodeUnknownSync(S.fromJsonString(JsonObject));

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseStreamingJson = <T extends JsonObject = JsonObject>(
  partialJson: string | undefined,
): T => {
  if (!partialJson || partialJson.trim() === "") {
    return {} as T;
  }

  try {
    const parsed = JSON.parse(partialJson) as unknown;
    return (isJsonObject(parsed) ? parsed : {}) as T;
  } catch {
    try {
      const parsed = partialParse(partialJson) as unknown;
      return (isJsonObject(parsed) ? parsed : {}) as T;
    } catch {
      return {} as T;
    }
  }
};

export const decodeCompletedJson = (json: string | undefined): JsonObject =>
  decodeJsonObject(json && json.trim() !== "" ? json : "{}");
