import { describe, it, expect } from "vitest";
import { trustProxyHops } from "../src/config.ts";

describe("trustProxyHops", () => {
  it.each([[undefined, 0], ["", 0], ["0", 0], ["1", 1], ["2", 2], ["10", 10]])("reads %j as %i hop(s)", (input, expected) => {
    expect(trustProxyHops(input)).toBe(expected);
  });

  it.each([["true"], ["yes"], ["-1"], ["1.5"], ["loopback"], [" 2"]])(
    "refuses %j instead of silently misconfiguring the proxy trust",
    (input) => {
      expect(() => trustProxyHops(input)).toThrow(/TRUST_PROXY must be a whole number/);
    }
  );
});
