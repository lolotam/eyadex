import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { mailProviderSealKey } from "../settings.module.ts";

describe("MAIL_PROVIDER_SEAL_KEY (required when settings is mounted)", () => {
  it("accepts 32 base64 bytes", () => {
    const key = randomBytes(32).toString("base64");
    expect(mailProviderSealKey({ MAIL_PROVIDER_SEAL_KEY: key })).toBe(key);
  });

  it.each([{}, { MAIL_PROVIDER_SEAL_KEY: "" }, { MAIL_PROVIDER_SEAL_KEY: "c2hvcnQ=" }])(
    "stops startup naming only the key: %j",
    (env) => {
      expect(() => mailProviderSealKey(env)).toThrow(
        /^Invalid API configuration: MAIL_PROVIDER_SEAL_KEY/,
      );
      expect(() => mailProviderSealKey({ MAIL_PROVIDER_SEAL_KEY: "c2hvcnQ=" })).not.toThrow(
        /c2hvcnQ/,
      );
    },
  );
});
