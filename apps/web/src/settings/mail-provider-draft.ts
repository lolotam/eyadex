import type { MailProviderKind, MailProviderView } from "@eyadex/contracts/mail-provider";

export type Draft = {
  kind: MailProviderKind;
  apiKey: string;
  host: string;
  port: string;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

/** Secrets always start empty: a stored key or password is never shown (write-only, ADR-0014). */
export function draftOf(current: MailProviderView | null): Draft {
  return {
    kind: current?.kind ?? "resend",
    apiKey: "",
    host: current?.smtpHost ?? "",
    port: String(current?.smtpPort ?? 587),
    user: current?.smtpUser ?? "",
    password: "",
    fromName: current?.fromName ?? "",
    fromEmail: current?.fromEmail ?? "",
    replyTo: current?.replyTo ?? "",
  };
}

export function toRequest(d: Draft) {
  const sender = {
    fromName: d.fromName,
    fromEmail: d.fromEmail,
    ...(d.replyTo.trim() ? { replyTo: d.replyTo } : {}),
  };
  return d.kind === "resend"
    ? { kind: "resend" as const, apiKey: d.apiKey, ...sender }
    : {
        kind: "smtp" as const,
        host: d.host,
        port: Number(d.port),
        user: d.user,
        password: d.password,
        ...sender,
      };
}
