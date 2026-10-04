import { describe, expect, it } from "vitest";

import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// Every CLASS 1 / CLASS 12 example from the red-team report, as a leak test: the synthetic value must be
// absent from the serialised output. The metadata-suffix keys are the heart of CLASS 1 — the old matcher
// tested suffixes only, so any credential word followed by Value/Raw/Header/Base64/Pem/Id leaked.

const SECRET = "SYNTHETIC_CREDENTIAL_VALUE";
const out = (value: unknown): string => JSON.stringify(sanitize(value));

describe("CLASS 1 — a credential word followed by metadata is still a secret", () => {
  it.each([
    "passwordValue",
    "passwordRaw",
    "passwordBase64",
    "passwordB64",
    "passwordPlain",
    "passwordHeader",
    "tokenValue",
    "tokenRaw",
    "tokenEncoded",
    "tokenBase64",
    "tokenHeader",
    "tokenDigest",
    "apiKeyValue",
    "apiKeyRaw",
    "authorizationHeader",
    "cookieHeader",
    "privateKeyPem",
    "pem",
    "Pem",
    "certificate",
    "digest",
    "sig",
    "hmac",
    "checksum",
    "secretValue",
    "signatureValue",
    "signatureRaw",
    "credentialValue",
    "credentialId",
    "dsnValue",
    "hashValue",
    "myHashRaw",
    "userHashValue",
    "userDigestValue",
    "passphraseRaw",
    "tokenId",
    "refreshTokenId",
    "otpValue",
    "pinNumber",
    "cvvValue",
    "cvc",
    "cvv2",
    "nonce",
    "salt",
    "csrf",
    "xsrf",
    "bearer",
    "authorizationCode",
    "passwd",
    "pwd",
    "pass",
  ])("the key %s is redacted", (key) => {
    expect(out({ [key]: SECRET })).not.toContain(SECRET);
    expect(sanitize({ [key]: SECRET })).toEqual({ [key]: REDACTED });
  });

  it("is redacted in audit snapshots too (credentials run in both modes)", () => {
    expect(redactSecrets({ passwordValue: SECRET, privateKeyPem: SECRET })).toEqual({
      passwordValue: REDACTED,
      privateKeyPem: REDACTED,
    });
  });
});

describe("CLASS 1 — the leave-alone keys are kept", () => {
  it.each([
    ["passengers", "ok"],
    ["keyboard", "ok"],
    ["statusCode", 200],
    ["errorCode", "E1"],
    ["route", "/v1/clinics/:id"],
    ["method", "GET"],
    ["clinicId", "01920000-0000-7000-8000-00000000c001"],
    ["branchId", "01920000-0000-7000-8000-00000000b001"],
    ["request_id", "01920000-0000-7000-8000-00000000a001"],
  ])("%s is kept", (key, value) => {
    expect(sanitize({ [key]: value })).toEqual({ [key]: value });
  });

  it("sessionCount is redacted (contains 'session') — an accepted over-redaction", () => {
    expect(sanitize({ sessionCount: 5 })).toEqual({ sessionCount: REDACTED });
  });
});

describe("CLASS 12 — a code-named key", () => {
  it.each([
    ["a 5-digit PIN", "48219"],
    ["an 8-digit OTP", "48219301"],
    ["an Arabic-Indic OTP", "٤٨٢١٩٣"],
    ["a pass-code token", "tok_live_x"],
    ["an OAuth code", "4/0AY0e-g7OAuthCodeLeak"],
  ])("redacts %s under code", (_label, value) => {
    expect(sanitize({ code: value })).toEqual({ code: REDACTED });
  });

  it("keeps our own snake_case error codes and the structural code keys", () => {
    expect(sanitize({ code: "not_found" })).toEqual({ code: "not_found" });
    expect(sanitize({ statusCode: 200, errorCode: "E42", countryCode: "KW" })).toEqual({
      statusCode: 200,
      errorCode: "E42",
      countryCode: "KW",
    });
  });

  it("redacts codes named by other spellings", () => {
    expect(
      redactSecrets({
        verificationCode: "4821",
        authCode: "4821",
        oauthCode: "4821",
        pinCode: "4821",
        passCode: "4821",
      }),
    ).toEqual({
      verificationCode: REDACTED,
      authCode: REDACTED,
      oauthCode: REDACTED,
      pinCode: REDACTED,
      passCode: REDACTED,
    });
  });

  it("redacts a code-signing MAC under either spelling", () => {
    expect(sanitize({ codeMac: "a1b2c3d4" })).toEqual({ codeMac: REDACTED });
    expect(sanitize({ code_mac: "a1b2c3d4" })).toEqual({ code_mac: REDACTED });
  });
});
