import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";
import { describe, expect, it } from "vitest";

import { notificationSkip, type SendFacts } from "../domain/skip-decision.ts";
import { whatsappNumber } from "../domain/whatsapp-address.ts";
import { whatsappTemplateValues, whatsappText } from "../domain/whatsapp-message.ts";
import { JITTER_MS, nextSendAt, PACE_MS, paceWait } from "../domain/whatsapp-pace.ts";
import { templateFor, templateLanguage } from "../domain/whatsapp-template.ts";

// Spec §7.1 (N2) as pure functions. Fake numbers only (0000…), never a real one.
describe("whatsappNumber", () => {
  it.each([
    ["+96500000001", "96500000001"],
    ["0096500000002", "96500000002"],
    ["00000003", "96500000003"],
    ["+965 0000-0004", "96500000004"],
  ])("%s → %s", (phone, number) => {
    expect(whatsappNumber(phone)).toBe(number);
  });

  it.each(["", "+9660000000", "1234567", "+96500000000x"])("refuses %j", (phone) => {
    expect(whatsappNumber(phone)).toBeNull();
  });
});

const whatsappOn: NotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  whatsappEnabled: true,
};
const linked = { connected: true, templateMissing: false };

const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
  kind: "reminder_day",
  settings: whatsappOn,
  // A WhatsApp row needs no email.
  patient: { email: null, optedOut: false },
  appointment: { status: "booked", startUnchanged: true },
  whatsapp: linked,
  ...over,
});

describe("notificationSkip for a WhatsApp row (spec §7.1)", () => {
  it("sends without an email when the channel is linked and switched on", () => {
    expect(notificationSkip(facts())).toBeNull();
  });

  it("WhatsApp off → setting_off, even with email on", () => {
    expect(notificationSkip(facts({ settings: DEFAULT_NOTIFICATION_SETTINGS }))).toBe(
      "setting_off",
    );
  });

  it("email off does not stop WhatsApp", () => {
    expect(
      notificationSkip(facts({ settings: { ...whatsappOn, emailEnabled: false } })),
    ).toBeNull();
  });

  it("the kind switched off → setting_off", () => {
    const settings = { ...whatsappOn, messages: { ...whatsappOn.messages, reminder_day: false } };
    expect(notificationSkip(facts({ settings }))).toBe("setting_off");
  });

  it("not connected → whatsapp_disconnected; coexistence without a template → template_missing", () => {
    expect(
      notificationSkip(facts({ whatsapp: { connected: false, templateMissing: false } })),
    ).toBe("whatsapp_disconnected");
    expect(notificationSkip(facts({ whatsapp: { connected: true, templateMissing: true } }))).toBe(
      "template_missing",
    );
  });

  it("checks in order: setting, opt-out, appointment, then the channel, then the template", () => {
    const broken = { connected: false, templateMissing: true };
    const allWrong = facts({
      settings: { ...whatsappOn, whatsappEnabled: false },
      patient: { email: null, optedOut: true },
      appointment: { status: "cancelled", startUnchanged: false },
      whatsapp: broken,
    });
    expect(notificationSkip(allWrong)).toBe("setting_off");
    expect(notificationSkip({ ...allWrong, settings: whatsappOn })).toBe("opted_out");
    const optedIn = {
      ...allWrong,
      settings: whatsappOn,
      patient: { email: null, optedOut: false },
    };
    expect(notificationSkip(optedIn)).toBe("not_booked");
    expect(
      notificationSkip({ ...optedIn, appointment: { status: "booked", startUnchanged: false } }),
    ).toBe("moved");
    const onTime = { ...optedIn, appointment: { status: "booked", startUnchanged: true } } as const;
    expect(notificationSkip(onTime)).toBe("whatsapp_disconnected");
    expect(
      notificationSkip({ ...onTime, whatsapp: { connected: true, templateMissing: true } }),
    ).toBe("template_missing");
  });

  it("an email row keeps the N1 rule: no email → no_email, WhatsApp settings ignored", () => {
    const { whatsapp: _row, ...email } = facts({ settings: DEFAULT_NOTIFICATION_SETTINGS });
    expect(notificationSkip(email)).toBe("no_email");
  });
});

describe("the pace (spec §7.1)", () => {
  const now = new Date("2026-10-13T08:00:00.000Z");

  it("waits until next_send_at while it is in the future", () => {
    const later = new Date(now.getTime() + 3_000);
    expect(paceWait(later, now)).toEqual(later);
  });

  it.each([null, new Date(now.getTime()), new Date(now.getTime() - 1)])(
    "sends now when next_send_at is %s",
    (next) => {
      expect(paceWait(next, now)).toBeNull();
    },
  );

  it("the next turn is 8 s later plus 0–4 s of jitter", () => {
    expect(nextSendAt(now, () => 0).getTime() - now.getTime()).toBe(PACE_MS);
    expect(nextSendAt(now, () => 0.5).getTime() - now.getTime()).toBe(PACE_MS + JITTER_MS / 2);
    expect(nextSendAt(now, () => 0.999_999).getTime() - now.getTime()).toBe(PACE_MS + JITTER_MS);
    // A misbehaving source never shortens the pace nor stretches it past the cap.
    expect(nextSendAt(now, () => -3).getTime() - now.getTime()).toBe(PACE_MS);
    expect(nextSendAt(now, () => 7).getTime() - now.getTime()).toBe(PACE_MS + JITTER_MS);
  });
});

describe("templates (coexistence)", () => {
  const templates = {
    booked: { name: "appointment_booked", language: "ar" },
    reminder_day: { name: "Bad Name", language: "en" },
    prescription: { name: "rx_lines", language: "en_US" },
  };

  it("finds a valid template for its kind only", () => {
    expect(templateFor(templates, "booked")).toEqual({
      name: "appointment_booked",
      language: "ar",
    });
    expect(templateFor(templates, "rescheduled")).toBeNull();
    expect(templateFor(templates, "reminder_day")).toBeNull();
    expect(templateFor(null, "booked")).toBeNull();
    expect(templateFor("{}", "booked")).toBeNull();
  });

  it("fills the parameters in the language of the template, else the patient's", () => {
    expect(templateLanguage({ name: "x", language: "en_US" }, "ar")).toBe("en");
    expect(templateLanguage({ name: "x", language: "ar" }, "en")).toBe("ar");
    expect(templateLanguage({ name: "x", language: "fr" }, "ar")).toBe("ar");
  });
});

describe("WhatsApp message content", () => {
  const appointment = (language: "ar" | "en") =>
    ({
      kind: "appointment",
      message: {
        kind: "booked",
        language,
        clinicName: language === "ar" ? "عيادة النور" : "Al Noor Clinic",
        branchName: language === "ar" ? "فرع السالمية" : "Salmiya",
        branchAddress: "Block 2",
        startsAt: new Date("2026-11-02T06:30:00.000Z"),
        timeZone: "Asia/Kuwait",
        providerName: "Dr. Huda",
      },
    }) as const;

  it("appointment template values: clinic, date, time, provider, branch — English", () => {
    expect(whatsappTemplateValues(appointment("en"))).toEqual([
      "Al Noor Clinic",
      "Monday, 2 November 2026",
      "09:30",
      "Dr. Huda",
      "Salmiya",
    ]);
  });

  it("appointment template values in Arabic, with Latin digits", () => {
    const values = whatsappTemplateValues(appointment("ar"));
    expect(values[0]).toBe("عيادة النور");
    expect(values[1]).toContain("الاثنين");
    expect(values[1]).toContain("2026");
    expect(values[2]).toMatch(/^9:30|09:30/);
    expect(values.slice(3)).toEqual(["Dr. Huda", "فرع السالمية"]);
  });

  it("prescription template values: clinic, doctor, the lines on one line joined by •", () => {
    const values = whatsappTemplateValues({
      kind: "prescription",
      message: {
        language: "en",
        clinicName: "Al Noor Clinic",
        doctorName: "Dr. Huda",
        lines: [
          {
            medicine: "Paracetamol",
            dose: "500 mg",
            frequency: "3x",
            duration: "5 days",
            note: null,
          },
          {
            medicine: "Vitamin D",
            dose: "1000 IU",
            frequency: "daily",
            duration: "1\nmonth",
            note: "after\tfood",
          },
        ],
      },
    });
    expect(values).toEqual([
      "Al Noor Clinic",
      "Dr. Huda",
      "Paracetamol — 500 mg — 3x — 5 days • Vitamin D — 1000 IU — daily — 1 month — after food",
    ]);
    expect(values.every((v) => !/[\n\t]| {5}/.test(v))).toBe(true);
  });

  it("the Evolution text is the email's plain-text part, nothing medical in an appointment", () => {
    const text = whatsappText(appointment("en"));
    expect(text).toContain("Your appointment at Al Noor Clinic is booked.");
    expect(text).toContain("Salmiya");
    expect(text).not.toContain("<");
  });
});
