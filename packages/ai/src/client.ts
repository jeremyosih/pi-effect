import { Layer, ServiceMap } from "effect";
import { complete, completeSimple, stream, streamSimple } from "./stream.ts";

export interface AiClient {
  readonly stream: typeof stream;
  readonly streamSimple: typeof streamSimple;
  readonly complete: typeof complete;
  readonly completeSimple: typeof completeSimple;
}

export const AiClient = ServiceMap.Service<AiClient>("AiClient");

export const AiClientLive = Layer.succeed(AiClient, {
  stream,
  streamSimple,
  complete,
  completeSimple,
});
