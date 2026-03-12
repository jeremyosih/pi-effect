import type { ApiProvider } from "../provider.ts";

export const OpenAIResponsesProvider: ApiProvider = {
  api: "openai-responses",
  stream: (_model, _context, _options) => {
    throw new Error("not Implemented");
  },
  streamSimple: (_model, _context, _options) => {
    throw new Error("not Implemented");
  },
};
