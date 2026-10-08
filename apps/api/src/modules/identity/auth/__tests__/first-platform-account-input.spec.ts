import { describe, expect, it } from "vitest";

import { readFirstPlatformAccountInput } from "../first-platform-account-input.ts";

const env = {
  AUTH_DATABASE_URL: "postgres://eyadex_auth:change-me@postgres-staging:5432/eyadex",
  BETTER_AUTH_SECRET: "s".repeat(40),
  PLATFORM_URL: "https://staging-platform.eyadex.com",
  AUTH_COOKIE_PREFIX: "eyadex-staging",
  BOOTSTRAP_EMAIL: "ops@example.com",
  BOOTSTRAP_NAME: " Ops Team ",
};

describe("readFirstPlatformAccountInput (ADR-0021)", () => {
  it("reads the container's auth settings, the BOOTSTRAP_* names and one line of stdin", () => {
    expect(readFirstPlatformAccountInput(env, "a-long-password\n")).toEqual({
      databaseUrl: env.AUTH_DATABASE_URL,
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: env.PLATFORM_URL,
      cookiePrefix: "eyadex-staging",
      email: "ops@example.com",
      name: "Ops Team",
      password: "a-long-password",
    });
    expect(readFirstPlatformAccountInput(env, "crlf-password\r\n").password).toBe("crlf-password");
    expect(
      readFirstPlatformAccountInput({ ...env, AUTH_COOKIE_PREFIX: "" }, "p").cookiePrefix,
    ).toBeUndefined();
  });

  it.each(["", "\n", "two\nlines", "one\n\n"])("NEGATIVE: refuses the stdin %j", (stdin) => {
    expect(() => readFirstPlatformAccountInput(env, stdin)).toThrow(/one line on stdin/);
  });

  it("NEGATIVE: names a missing key without printing any value", () => {
    const { BOOTSTRAP_EMAIL: _email, ...rest } = env;
    let message = "";
    try {
      readFirstPlatformAccountInput({ ...rest, BETTER_AUTH_SECRET: "short" }, "pw\n");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).toMatch(/BOOTSTRAP_EMAIL/);
    expect(message).not.toMatch(/short|change-me|postgres-staging/);
  });
});
