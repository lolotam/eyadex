import { randomUUID } from "node:crypto";

import { owner, ownerJson } from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import type { FilledTemplate, WhatsappResult, WhatsappSender } from "../ports/whatsapp-sender.ts";
import { q } from "./notification-fixtures.ts";

/** One call the fake Evolution boundary received. */
export type WhatsappCall =
  | {
      readonly action: "text";
      readonly instance: string;
      readonly number: string;
      readonly text: string;
    }
  | {
      readonly action: "template";
      readonly instance: string;
      readonly number: string;
      readonly template: FilledTemplate;
    };

/** The only mock of N2: the Evolution HTTP boundary. Records every call; answers with `result`. */
export class FakeWhatsapp implements WhatsappSender {
  readonly calls: WhatsappCall[] = [];
  result: () => Promise<WhatsappResult> = async () => ({ sent: true });

  async sendText(instance: string, number: string, text: string): Promise<WhatsappResult> {
    this.calls.push({ action: "text", instance, number, text });
    return this.result();
  }

  async sendTemplate(
    instance: string,
    number: string,
    template: FilledTemplate,
  ): Promise<WhatsappResult> {
    this.calls.push({ action: "template", instance, number, template });
    return this.result();
  }
}

/** The clinic's channel row as the API writes it (0057). */
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
  owner(`INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name, phone_last4,
           templates, connected_at, next_send_at, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, ${transport === null ? "NULL" : q(transport)},
           ${q(o.status ?? "connected")}, ${q(`eyadex-${clinicId}`)}, '0001',
           ${q(JSON.stringify(o.templates ?? {}))}::jsonb, now(),
           ${o.nextSendAt ? q(o.nextSendAt.toISOString()) : "NULL"}, now(), now())`);
  return id;
}

export interface ChannelState {
  next_send_at: string | null;
  last_error: string | null;
}

export const channelRow = (clinicId: string): ChannelState =>
  ownerJson<ChannelState[]>(
    `SELECT next_send_at, last_error FROM clinic_whatsapp_channels WHERE clinic_id = ${q(clinicId)}`,
  )[0]!;
