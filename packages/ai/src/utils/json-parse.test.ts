import { describe, expect, it } from "vitest";
import {
  decodeCompletedJson,
  parseStreamingJson,
} from "./json-parse.ts";

describe("json-parse", () => {
  it("returns an empty object for empty streaming input", () => {
    expect(parseStreamingJson(undefined)).toEqual({});
    expect(parseStreamingJson("")).toEqual({});
  });

  it("best-effort parses partial streaming JSON", () => {
    expect(parseStreamingJson('{"city":"Paris"')).toEqual({ city: "Paris" });
  });

  it("strictly decodes completed JSON objects", () => {
    expect(decodeCompletedJson('{"city":"Paris","count":2}')).toEqual({
      city: "Paris",
      count: 2,
    });
  });

  it("rejects completed JSON scalars and arrays", () => {
    expect(() => decodeCompletedJson("1")).toThrow();
    expect(() => decodeCompletedJson("null")).toThrow();
    expect(() => decodeCompletedJson('["a"]')).toThrow();
  });

  it("rejects malformed completed JSON", () => {
    expect(() => decodeCompletedJson("{not-json}")).toThrow();
  });
});
