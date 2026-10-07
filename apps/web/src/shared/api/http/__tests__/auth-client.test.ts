import { describe, expect, it } from "vitest";
import { createAuthClient } from "../auth-client";
import { createTransport } from "../http-transport";
import { stubFetch } from "./fetch-stub";

const URI = "otpauth://totp/Eyadex:someone?secret=JBSWY3DPEHPK3PXP&issuer=Eyadex";

function client(answer: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(answer);
  return { ...stub, auth: createAuthClient(createTransport(stub.fetchImpl)) };
}

describe("auth client", () => {
  it("enrolment keeps the recovery codes the API returns, to show once", async () => {
    const h = client(() => ({ body: { totpURI: URI, backupCodes: ["aaaa-1111", "bbbb-2222"] } }));
    const enrollment = await h.auth.enableTotp("pw-for-tests");
    expect(enrollment).toEqual({ uri: URI, backupCodes: ["aaaa-1111", "bbbb-2222"] });
    expect(h.calls[0]).toMatchObject({ method: "POST", url: "/api/auth/two-factor/enable" });
  });

  it("a recovery code is sent alone on the allowlisted route, never with trustDevice", async () => {
    const h = client(() => ({ body: { token: "t", user: {} } }));
    await h.auth.verifyBackupCode("aaaa-1111");
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      url: "/api/auth/two-factor/verify-backup-code",
      body: { code: "aaaa-1111" },
      credentials: "same-origin",
    });
  });
});
