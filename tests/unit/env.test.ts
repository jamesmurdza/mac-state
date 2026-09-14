import { afterEach, describe, expect, it } from "vitest";
import { requireEnv } from "../../src/env.js";

const NAME = "MAC_STATE_TEST_VAR";

describe("requireEnv", () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  it("returns the value when set", () => {
    process.env[NAME] = "abc";
    expect(requireEnv(NAME)).toBe("abc");
  });

  it("throws a clear error when missing", () => {
    expect(() => requireEnv(NAME)).toThrow(`Missing env var ${NAME}`);
  });

  it("treats an empty string as missing", () => {
    process.env[NAME] = "";
    expect(() => requireEnv(NAME)).toThrow(`Missing env var ${NAME}`);
  });
});
