import { randomBytes, randomUUID } from "node:crypto";

import { owner, ownerJson } from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import type { FilledTemplate, WhatsappResult, WhatsappSender } from "../ports/whatsapp-sender.ts";
import { SecretSealer } from "@eyadex/secrets";
import type { MetaSender } from "../ports/meta-sender.ts";
import { PROVIDER_KEY, q } from "./notification-fixtures.ts";

/** The Evolution HTTP boundary only. */
export class FakeWhatsapp implements WhatsappSender {
  readonly calls: { action: "text"; instance: string; number: string; text: string }[] = [];
  result: () => Promise<WhatsappResult> = async () => ({ sent: true, messageId: "evo.fake" });
  async sendText(instance: string, number: string, text: string): Promise<WhatsappResult> {
    this.calls.push({ action: "text", instance, number, text });
    return this.result();
  }
}

/** Direct Graph boundary only; the test checks that the row's sealed token was opened. */
export class FakeMetaSender implements MetaSender {
  readonly calls: {
    action: "template";
    credentials: { phoneNumberId: string; accessToken: string };
    number: string;
    template: FilledTemplate;
  }[] = [];
  result: () => Promise<WhatsappResult> = async () => ({ sent: true, messageId: "wamid.fake" });
  async sendTemplate(
    credentials: { phoneNumberId: string; accessToken: string },
    number: string,
    template: FilledTemplate,
  ): Promise<WhatsappResult> {
    this.calls.push({ action: "template", credentials, number, template });
    return this.result();
  }
}
export const META_TOKEN = randomBytes(24).toString("hex");

/** The clinic's channel row as the API writes it (0057: connected_at set exactly when connected). */
export function seedChannel(
  clinicId: string,
  o: {
    transport?: "evolution" | "coexistence" | null;
    status?: "disconnected" | "pending" | "connected";
    templates?: Record<string, unknown>;
    nextSendAt?: Date | null;
  } = {},
): string {
  const id = randomUUID();
  const transport = o.transport === undefined ? "evolution" : o.transport;
  const status = o.status ?? "connected";
  owner(`INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name, phone_last4,
           templates, sealed_credentials, phone_number_id, connected_at, next_send_at, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, ${transport === null ? "NULL" : q(transport)},
           ${q(status)}, ${q(`eyadex-${clinicId}`)}, '0001',
           ${q(JSON.stringify(o.templates ?? {}))}::jsonb,
           ${transport === "coexistence" ? q(new SecretSealer(PROVIDER_KEY).seal(META_TOKEN, id)) : "NULL"},
           ${transport === "coexistence" ? "'10000'" : "NULL"}, ${status === "connected" ? "now()" : "NULL"},
           ${o.nextSendAt ? q(o.nextSendAt.toISOString()) : "NULL"}, now(), now())`);
  return id;
}

export interface ChannelState {
  status: string;
  connected_at: string | null;
  next_send_at: string | null;
  last_error: string | null;
}

export const channelRow = (clinicId: string): ChannelState =>
  ownerJson<ChannelState[]>(
    `SELECT status, connected_at, next_send_at, last_error FROM clinic_whatsapp_channels WHERE clinic_id = ${q(clinicId)}`,
  )[0]!;
