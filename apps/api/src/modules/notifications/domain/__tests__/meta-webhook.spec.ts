import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { metaChallenge, metaSignatureValid, parseMetaWebhook } from "../meta-webhook.ts";

const NOW = new Date("2027-01-01T12:00:00.000Z");
const seconds = (date: Date) => String(Math.floor(date.getTime() / 1000));
const EARLIER = new Date("2027-01-01T11:59:00.000Z");
const change = (statuses: unknown[], phoneNumberId = "1234567") => ({
  field: "messages",
  value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, statuses },
});
const body = (...changes: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [{ changes }],
});

describe("Meta webhook parser", () => {
  it("reads delivered, read and failed statuses per number, with Meta's event time", () => {
    const parsed = parseMetaWebhook(
      body(
        change([
          { id: "wamid.a", status: "delivered", timestamp: seconds(EARLIER), recipient_id: "x" },
          { id: "wamid.b", status: "read", timestamp: seconds(EARLIER) },
          {
            id: "wamid.c",
            status: "failed",
            timestamp: seconds(EARLIER),
            errors: [{ code: 131026 }],
          },
          { id: "wamid.d", status: "sent", timestamp: seconds(EARLIER) },
        ]),
        change([{ id: "wamid.e", status: "failed" }], "7654321"),
      ),
      NOW,
    );
    expect(parsed).toEqual([
      {
        phoneNumberId: "1234567",
        updates: [
          { messageId: "wamid.a", update: { kind: "delivered", at: EARLIER } },
          { messageId: "wamid.b", update: { kind: "read", at: EARLIER } },
          { messageId: "wamid.c", update: { kind: "failed", code: "meta_not_on_whatsapp" } },
        ],
      },
      {
        phoneNumberId: "7654321",
        updates: [{ messageId: "wamid.e", update: { kind: "failed", code: "meta_rejected" } }],
      },
    ]);
  });

  it("dates a missing, malformed or future timestamp at receipt", () => {
    const future = seconds(new Date("2030-01-01T00:00:00.000Z"));
    for (const timestamp of [undefined, "abc", future])
      expect(
        parseMetaWebhook(body(change([{ id: "w", status: "delivered", timestamp }])), NOW),
      ).toEqual([
        {
          phoneNumberId: "1234567",
          updates: [{ messageId: "w", update: { kind: "delivered", at: NOW } }],
        },
      ]);
  });

  it.each([
    null,
    {},
    { entry: "x" },
    body({ value: { metadata: { phone_number_id: "12" }, statuses: [] } }),
    body({ value: { metadata: {}, statuses: [{ id: "w", status: "read" }] } }),
    body(change([{ id: "w", status: "deleted" }])),
    body(change([{ id: "", status: "read" }])),
    body(change([{ id: "x".repeat(201), status: "read" }])),
    body(change([{ id: "w", status: "sent" }])),
    body({ value: { metadata: { phone_number_id: "1234567" }, messages: [{ text: "hi" }] } }),
  ])("ignores everything that is not a status it knows", (raw) => {
    expect(parseMetaWebhook(raw, NOW)).toEqual([]);
  });

  it("keeps the valid statuses of a batch that has a malformed one", () => {
    const parsed = parseMetaWebhook(
      body(
        change([
          { id: "w", status: "bogus" },
          { id: "v", status: "read" },
        ]),
      ),
      NOW,
    );
    expect(parsed[0]?.updates).toEqual([{ messageId: "v", update: { kind: "read", at: NOW } }]);
  });
});

describe("Meta webhook signature", () => {
  const secret = randomBytes(16).toString("hex");
  const raw = Buffer.from(JSON.stringify(body(change([]))));
  const signed = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  it("accepts the HMAC-SHA256 of the exact bytes", () => {
    expect(metaSignatureValid(raw, signed, secret)).toBe(true);
  });

  it.each([
    undefined,
    "",
    signed.slice(7),
    signed.toUpperCase(),
    `${signed}0`,
    [signed],
    `sha256=${createHmac("sha256", "other").update(raw).digest("hex")}`,
  ])("refuses %s", (header) => {
    expect(metaSignatureValid(raw, header, secret)).toBe(false);
  });

  it("a byte changed after signing fails", () => {
    const tampered = Buffer.from(raw);
    tampered[tampered.length - 2] = 0x20;
    expect(metaSignatureValid(tampered, signed, secret)).toBe(false);
    expect(metaSignatureValid(Buffer.alloc(0), signed, secret)).toBe(false);
  });
});

describe("Meta subscription check", () => {
  const token = randomBytes(32).toString("hex");
  const query = (o: Record<string, unknown>) => ({
    "hub.mode": "subscribe",
    "hub.verify_token": token,
    "hub.challenge": "1158201444",
    ...o,
  });

  it("answers the challenge for subscribe with the token", () => {
    expect(metaChallenge(query({}), token)).toBe("1158201444");
  });

  it.each([
    { "hub.mode": "unsubscribe" },
    { "hub.verify_token": `${token}x` },
    { "hub.verify_token": undefined },
    { "hub.verify_token": [token] },
    { "hub.challenge": "<script>" },
    { "hub.challenge": "" },
    { "hub.challenge": "x".repeat(257) },
    { "hub.challenge": undefined },
  ])("refuses %o", (override) => {
    expect(metaChallenge(query(override), token)).toBeNull();
  });
  it("refuses a missing query", () => expect(metaChallenge(undefined, token)).toBeNull());
});
