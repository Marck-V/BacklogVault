import { describe, it, expect } from "vitest";
import { escapeIgdbString } from "../src/igdbQuery.ts";

describe("escapeIgdbString", () => {
  it("leaves plain text alone", () => {
    expect(escapeIgdbString("hades")).toBe("hades");
  });

  it("escapes double quotes", () => {
    expect(escapeIgdbString('say "hi"')).toBe('say \\"hi\\"');
  });

  it("escapes backslashes before quotes so a trailing backslash cannot escape the closing quote", () => {
    expect(escapeIgdbString("a\\")).toBe("a\\\\");
    expect(escapeIgdbString('\\"')).toBe('\\\\\\"');
  });

  it("coerces non-strings", () => {
    expect(escapeIgdbString(42)).toBe("42");
  });
});
