import { createServer, type Server, type Socket } from "node:net";

import { createTransport } from "nodemailer";
import { afterEach, describe, expect, it } from "vitest";

import {
  afterDataCode,
  dataStageTracker,
  SmtpMailSender,
  type SmtpTransport,
} from "../mail/smtp-mail-sender.ts";

// A real SMTP conversation on a local socket: the stage flag comes from nodemailer's own transaction log,
// so only a real exchange shows whether it flips at the DATA command and not before.
type Step = "mail" | "rcpt" | "data" | "body";
interface Script {
  /** What the server does at that step instead of answering 250 / 354. */
  readonly at: Step;
  readonly act: "close" | "silent" | string;
}

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function fakeSmtp(script: Script): Promise<number> {
  server = createServer((socket: Socket) => {
    let inBody = false;
    let buffer = "";
    const answer = (step: Step, normal: string) => {
      if (script.at !== step) return void socket.write(`${normal}\r\n`);
      if (script.act === "close") return void socket.destroy();
      if (script.act !== "silent") socket.write(`${script.act}\r\n`);
    };
    socket.write("220 fake.invalid ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end = buffer.indexOf("\r\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inBody) {
          if (line === ".") {
            inBody = false;
            answer("body", "250 queued");
          }
        } else if (/^EHLO/i.test(line)) socket.write("250-fake.invalid\r\n250 8BITMIME\r\n");
        else if (/^MAIL FROM/i.test(line)) answer("mail", "250 ok");
        else if (/^RCPT TO/i.test(line)) answer("rcpt", "250 ok");
        else if (/^DATA/i.test(line)) {
          inBody = script.at !== "data";
          answer("data", "354 go ahead");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        end = buffer.indexOf("\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

// The production transport forces STARTTLS; this one speaks plain SMTP to the local fake, with the same
// stage tracker createSmtpTransport wires in.
function plainTransport(port: number): SmtpTransport {
  const stage = dataStageTracker();
  const transporter = createTransport({
    host: "127.0.0.1",
    port,
    secure: false,
    ignoreTLS: true,
    socketTimeout: 300,
    logger: stage.logger,
    transactionLog: true,
  });
  return {
    sendMail: (mail) => {
      stage.reset();
      return transporter.sendMail(mail);
    },
    close: () => transporter.close(),
    dataSent: stage.dataSent,
  };
}

const message = {
  to: "patient@example.invalid",
  subject: "Reminder",
  html: "<p>hello</p>",
  text: "hello",
  idempotencyKey: "0192aaaa-0000-7000-8000-000000000002",
};

const send = async (script: Script) => {
  const transport = plainTransport(await fakeSmtp(script));
  try {
    return await new SmtpMailSender(transport, "Clinic <desk@example.invalid>", 3_000).send(
      message,
    );
  } finally {
    transport.close();
  }
};

describe("SMTP failure stage (spec §3: before or after DATA)", () => {
  it("a silent server after the body is a timeout after DATA", async () => {
    expect(await send({ at: "body", act: "silent" })).toEqual({
      sent: false,
      error: "smtp_timeout_after_data",
    });
  });

  it("a connection dropped after the body is marked after DATA", async () => {
    const result = await send({ at: "body", act: "close" });
    expect(result.sent).toBe(false);
    expect(!result.sent && result.error.endsWith("_after_data")).toBe(true);
  });

  it("a refusal of the recipient is a reply before DATA", async () => {
    expect(await send({ at: "rcpt", act: "550 no such user" })).toEqual({
      sent: false,
      error: "smtp_550",
    });
  });

  it("a connection dropped at MAIL FROM is before DATA", async () => {
    const result = await send({ at: "mail", act: "close" });
    expect(result).toEqual({ sent: false, error: "smtp_econnection" });
  });

  it("a timeout waiting for the 354 counts as after DATA: the command was written", async () => {
    expect(await send({ at: "data", act: "silent" })).toEqual({
      sent: false,
      error: "smtp_timeout_after_data",
    });
  });

  it("a reply after the body stays a plain reply code", async () => {
    expect(await send({ at: "body", act: "554 rejected" })).toEqual({
      sent: false,
      error: "smtp_554",
    });
  });

  it("a delivered message is sent", async () => {
    expect(await send({ at: "mail", act: "250 ok" })).toEqual({
      sent: true,
      provider: "smtp",
      fallback: false,
    });
  });
});

describe("afterDataCode", () => {
  it.each([
    ["smtp_timeout", true, "smtp_timeout_after_data"],
    ["smtp_econnection", true, "smtp_econnection_after_data"],
    ["smtp_550", true, "smtp_550"],
    ["smtp_timeout", false, "smtp_timeout"],
  ])("%s with dataSent=%s → %s", (code, dataSent, expected) => {
    expect(afterDataCode(code, dataSent)).toBe(expected);
  });
});
