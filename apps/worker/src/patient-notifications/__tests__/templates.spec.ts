import { describe, expect, it } from "vitest";

import { renderAppointmentEmail, type AppointmentKind } from "../domain/appointment-email.ts";
import { renderPrescriptionEmail } from "../domain/prescription-email.ts";

const KINDS: AppointmentKind[] = [
  "booked",
  "rescheduled",
  "cancelled",
  "reminder_day",
  "reminder_2h",
];
const LANGUAGES = ["ar", "en"] as const;
const CLINIC = { ar: "عيادة النور", en: "Al Noor <Clinic>" };
const BRANCH = { ar: "فرع السالمية", en: "Salmiya & Co" };

const appointment = (kind: AppointmentKind, language: "ar" | "en", address: string | null) =>
  renderAppointmentEmail({
    kind,
    language,
    clinicName: CLINIC[language],
    branchName: BRANCH[language],
    branchAddress: address,
    // 09:00 UTC is 12:00 in Kuwait (UTC+3, no daylight saving).
    startsAt: new Date("2026-11-02T09:00:00.000Z"),
    timeZone: "Asia/Kuwait",
    providerName: "Dr. Huda <Ali>",
  });

describe("appointment emails (spec §4, N-4)", () => {
  for (const language of LANGUAGES) {
    for (const kind of KINDS) {
      it(`${kind} in ${language}`, () => {
        const email = appointment(kind, language, "Block 2, Street 5");
        expect(email).toMatchSnapshot();
        // Substrings beside the snapshot: an ICU update may reword a date, never drop these.
        expect(email.subject).toContain(CLINIC[language]);
        expect(email.text).toContain(CLINIC[language]);
        expect(email.text).toContain(BRANCH[language]);
        expect(email.text).toContain("Block 2, Street 5");
        expect(email.text).toContain("Dr. Huda <Ali>");
        expect(email.text).toContain("12:00");
        expect(email.text).toContain("2026");
        expect(email.html).toContain(`lang="${language}"`);
        expect(email.html).toContain(`dir="${language === "ar" ? "rtl" : "ltr"}"`);
      });
    }
  }

  it("escapes every value the clinic typed in the HTML, keeps it plain in the text", () => {
    const email = appointment("booked", "en", "<b>Gulf</b> Road");
    expect(email.html).toContain("Al Noor &lt;Clinic&gt;");
    expect(email.html).toContain("Salmiya &amp; Co");
    expect(email.html).toContain("Dr. Huda &lt;Ali&gt;");
    expect(email.html).toContain("&lt;b&gt;Gulf&lt;/b&gt; Road");
    expect(email.html).not.toContain("<b>Gulf");
    expect(email.text).toContain("<b>Gulf</b> Road");
  });

  it("leaves the address line out when the branch has none", () => {
    expect(appointment("booked", "en", null).text).not.toContain("Address");
    expect(appointment("booked", "ar", null).text).not.toContain("العنوان");
  });

  it("asks to contact the clinic: to change it, or to book again after a cancellation", () => {
    expect(appointment("booked", "en", null).text).toContain("please contact the clinic");
    expect(appointment("cancelled", "en", null).text).toContain("To book a new appointment");
    expect(appointment("reminder_2h", "ar", null).text).toContain("يرجى التواصل مع العيادة");
  });

  it("keeps the subject on one line", () => {
    const email = renderAppointmentEmail({
      kind: "booked",
      language: "en",
      clinicName: "Line\r\nBcc: someone@example.invalid",
      branchName: "Main",
      branchAddress: null,
      startsAt: new Date("2026-11-02T09:00:00.000Z"),
      timeZone: "Asia/Kuwait",
      providerName: "Dr. Huda",
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("never calls the reader a patient in Arabic", () => {
    for (const kind of KINDS) {
      const email = appointment(kind, "ar", null);
      expect(`${email.subject}${email.text}`).not.toMatch(/المريض|المرضى/);
    }
  });
});

const LINES = [
  {
    medicine: "Amoxicillin 500 mg",
    dose: "1 capsule",
    frequency: "3 times a day",
    duration: "7 days",
    note: "after food",
  },
  {
    medicine: "Paracetamol <500>",
    dose: "1 tablet",
    frequency: "when needed",
    duration: "",
    note: null,
  },
];

describe("prescription email (spec §4, N-5)", () => {
  for (const language of LANGUAGES) {
    it(`in ${language}`, () => {
      const email = renderPrescriptionEmail({
        language,
        clinicName: CLINIC[language],
        doctorName: "Dr. Huda",
        lines: LINES,
      });
      expect(email).toMatchSnapshot();
      expect(email.subject).toContain(CLINIC[language]);
      expect(email.text).toContain("Dr. Huda");
      expect(email.text).toContain(
        "Amoxicillin 500 mg — 1 capsule — 3 times a day — 7 days — after food",
      );
      expect(email.text).toContain("Paracetamol <500> — 1 tablet — when needed");
      expect(email.html).toContain("Paracetamol &lt;500&gt;");
      expect(email.html).toContain(`dir="${language === "ar" ? "rtl" : "ltr"}"`);
    });
  }
});
