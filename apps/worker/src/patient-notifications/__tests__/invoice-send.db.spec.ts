import { randomBytes, randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox, type ClaimedEvent } from "@eyadex/db";
import { SealOpenError, SecretSealer } from "@eyadex/secrets";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  owner,
  ownerJson,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { invoiceLinkContext, invoiceTokenHash } from "../domain/invoice-link.ts";
import type { WhatsappResult } from "../ports/whatsapp-sender.ts";
import { linksOf, queueInvoice, seedInvoice, tokenIn, voidInvoice } from "./invoice-fixtures.ts";
import {
  INVOICE_LINK_KEY,
  ledgerRow,
  q,
  queueNotification,
  seedAppointment,
  seedWorld,
  sendHarness,
  setSettings,
} from "./notification-fixtures.ts";
import { FakeMetaSender, FakeWhatsapp, seedChannel } from "./whatsapp-fixtures.ts";

// Plan Task 9 (C1, spec §8 rules 15–16, §8c.1) on real PostgreSQL with fake mail and WhatsApp boundaries:
// the link commits before any send, a retry re-sends the same link, and the token is never logged.
let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;
type Options = Parameters<typeof sendHarness>[3];
const make = (options: Options = {}) =>
  sendHarness(app, outbox, true, { random: () => 0.5, ...options });
const later = (h: ReturnType<typeof make>, ms = 86_400_000) => {
  h.clock.t = new Date(h.clock.t.getTime() + ms);
};
const hex = (token: string) => invoiceTokenHash(token).toString("hex");

function linkedWorld() {
  const w = seedWorld("en");
  setSettings(w.clinicId, { whatsapp_enabled: true });
  seedChannel(w.clinicId);
  return w;
}

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

describe("the invoice link (C1)", () => {
  it("the first send mints one live link whose token hashes to token_hash and whose seal opens", async () => {
    const h = make();
    const w = seedWorld("en");
    const invoice = seedInvoice(w, "12500");
    const { notificationId } = queueInvoice(w, invoice.id);
    await drain(h.poller);

    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent", route: "platform" });
    const [mail] = h.platform.sent;
    expect(mail!.subject).toBe(`Your invoice ${invoice.number} from Al Noor <Clinic>`);
    expect(mail!.text).toContain("12.500 KWD");
    const token = tokenIn(mail!.text);
    expect(mail!.html).toContain(`https://app.example.invalid/api/v1/public/invoices/${token}`);
    const links = linksOf(notificationId);
    expect(links).toEqual([expect.objectContaining({ live: true, token_hash: hex(token) })]);
    const context = invoiceLinkContext(w.clinicId, links[0]!.id, notificationId);
    expect(new SecretSealer(INVOICE_LINK_KEY).open(links[0]!.token_sealed, context)).toBe(token);
  });

  it("a crash after the link committed leaves the row queued; the retry sends the same token", async () => {
    const fake = new FakeWhatsapp();
    const h = make({ whatsapp: fake });
    const w = linkedWorld();
    const { notificationId } = queueInvoice(w, seedInvoice(w).id, "whatsapp");
    fake.result = async () => {
      throw new Error("worker died mid-send");
    };
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "queued", attempts: 0 });
    expect(linksOf(notificationId)).toHaveLength(1);

    fake.result = async () => ({ sent: true, messageId: "evo.fake" });
    later(h);
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent", route: "evolution" });
    const [first, retry] = fake.calls.map((call) => tokenIn(call.text));
    expect(retry).toBe(first);
    expect(linksOf(notificationId)).toEqual([
      expect.objectContaining({ live: true, token_hash: hex(first!) }),
    ]);
  });

  it("a rotated seal key revokes the old link and sends a new one; one link stays live", async () => {
    const fake = new FakeWhatsapp();
    const w = linkedWorld();
    const { notificationId } = queueInvoice(w, seedInvoice(w).id, "whatsapp");
    fake.result = async () => {
      throw new Error("worker died mid-send");
    };
    await drain(make({ whatsapp: fake }).poller);
    const rotated = make({
      whatsapp: fake,
      invoiceSealer: new SecretSealer(randomBytes(32).toString("base64")),
    });
    fake.result = async () => ({ sent: true, messageId: "evo.fake" });
    later(rotated);
    await drain(rotated.poller);

    const [old, fresh] = fake.calls.map((call) => tokenIn(call.text));
    expect(fresh).not.toBe(old);
    expect(linksOf(notificationId).map((l) => [l.token_hash, l.live])).toEqual([
      [hex(old!), false],
      [hex(fresh!), true],
    ]);
  });

  it.each([
    ["evo_not_on_whatsapp", false],
    ["evo_timeout", true],
  ])("a final %s leaves the link live: %s (C1-Q4)", async (error, live) => {
    const fake = new FakeWhatsapp();
    fake.result = async (): Promise<WhatsappResult> => ({ sent: false, error });
    const h = make({ whatsapp: fake });
    const w = linkedWorld();
    const { notificationId } = queueInvoice(w, seedInvoice(w).id, "whatsapp");
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "failed" });
    expect(linksOf(notificationId).map((l) => l.live)).toEqual([live]);
  });

  it("two handlers of one event send once; the second finds the row sent", async () => {
    const fake = new FakeWhatsapp();
    const one = make({ whatsapp: fake });
    const two = make({ whatsapp: fake });
    const w = linkedWorld();
    const { notificationId, eventId } = queueInvoice(w, seedInvoice(w).id, "whatsapp");
    const event: ClaimedEvent = {
      id: eventId,
      clinicId: w.clinicId,
      type: "patient.notification_requested",
      payload: { notificationId },
      attempts: 0,
      createdAt: new Date(),
    };
    await Promise.all([one.handle(event), two.handle(event)]);
    expect(fake.calls).toHaveLength(1);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent" });
    expect(linksOf(notificationId)).toEqual([expect.objectContaining({ live: true })]);
  });

  it("without INVOICE_LINK_SEAL_KEY an invoice waits queued and other messages still send", async () => {
    const h = make({ invoiceSealer: null });
    const w = seedWorld("en");
    const invoice = queueInvoice(w, seedInvoice(w).id);
    const booked = queueNotification(w, "booked", seedAppointment(w));
    await drain(h.poller);
    expect(ledgerRow(invoice.notificationId)).toMatchObject({ status: "queued", attempts: 0 });
    expect(linksOf(invoice.notificationId)).toEqual([]);
    expect(ledgerRow(booked.notificationId)).toMatchObject({ status: "sent" });
  });

  it("a seal copied onto another link row never opens (context binding)", async () => {
    const h = make();
    const w = seedWorld("en");
    const invoice = seedInvoice(w);
    const a = queueInvoice(w, invoice.id);
    const b = queueInvoice(w, invoice.id);
    await drain(h.poller);
    const [linkA] = linksOf(a.notificationId);
    const [linkB] = linksOf(b.notificationId);
    const sealer = new SecretSealer(INVOICE_LINK_KEY);
    expect(() =>
      sealer.open(linkA!.token_sealed, invoiceLinkContext(w.clinicId, linkB!.id, b.notificationId)),
    ).toThrow(SealOpenError);
  });
});

describe("the invoice at send time (spec §8 rule 15)", () => {
  describe.each([false, true])("skip with missing link key: %s", (missingKey) => {
    it.each([
      ["email", "setting_off"],
      ["whatsapp", "setting_off"],
      ["email", "no_email"],
      ["whatsapp", "whatsapp_disconnected"],
      ["whatsapp", "template_missing"],
    ] as const)("%s skip %s is recorded before preparing any link", async (channel, reason) => {
      const h = make({
        ...(missingKey ? { invoiceSealer: null } : {}),
        meta: new FakeMetaSender(),
      });
      const w = seedWorld("en");
      setSettings(w.clinicId, {
        email_enabled: reason !== "setting_off",
        whatsapp_enabled: reason !== "setting_off",
      });
      if (reason === "no_email") {
        owner(`UPDATE patients SET email = NULL WHERE id = ${q(w.patientId)}`);
      }
      if (reason === "template_missing") seedChannel(w.clinicId, { transport: "coexistence" });
      const { notificationId } = queueInvoice(w, seedInvoice(w).id, channel);
      await drain(h.poller);
      expect(ledgerRow(notificationId)).toMatchObject({
        status: "skipped",
        skip_reason: reason,
        attempts: 0,
      });
      expect(linksOf(notificationId).length).toBe(0);
      expect(h.platform.sent).toEqual([]);
      expect(h.lines.join("\n")).toContain(`"reason":"${reason}"`);
    });
  });

  it("voided before the worker sends: skipped as invoice_void, no link minted", async () => {
    const h = make();
    const w = seedWorld("en");
    const invoice = seedInvoice(w);
    const { notificationId } = queueInvoice(w, invoice.id);
    voidInvoice(w, invoice.id);
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "skipped",
      skip_reason: "invoice_void",
    });
    expect(linksOf(notificationId)).toEqual([]);
    expect(h.platform.sent).toEqual([]);
  });

  it("edited before the worker sends: the message carries the latest total", async () => {
    const h = make();
    const w = seedWorld("en");
    const invoice = seedInvoice(w, "12500");
    queueInvoice(w, invoice.id);
    owner(`UPDATE invoices SET total_minor = 9000, subtotal_minor = 9000, version = 2
           WHERE id = ${q(invoice.id)}`);
    await drain(h.poller);
    expect(h.platform.sent[0]!.text).toContain("9.000 KWD");
  });

  it("the transport runs after the link committed, and no log line or outbox row carries the token", async () => {
    const seen: number[] = [];
    const fake = new FakeWhatsapp();
    const h = make({ whatsapp: fake });
    const w = linkedWorld();
    const { notificationId } = queueInvoice(w, seedInvoice(w).id, "whatsapp");
    // The fake reads invoice_links over its own connection: the link is visible only once Tx 1 committed.
    fake.result = async () => {
      seen.push(linksOf(notificationId).length);
      return { sent: true, messageId: "evo.fake" };
    };
    await drain(h.poller);
    expect(seen).toEqual([1]);
    const token = tokenIn(fake.calls[0]!.text);
    const [link] = linksOf(notificationId);
    const logged = h.lines.join("\n");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(link!.token_sealed);
    const payloads = JSON.stringify(
      ownerJson(`SELECT payload FROM outbox_events WHERE clinic_id = ${q(w.clinicId)}`),
    );
    expect(payloads).not.toContain(token);
    expect(payloads).not.toContain(link!.token_sealed);
  });
});
