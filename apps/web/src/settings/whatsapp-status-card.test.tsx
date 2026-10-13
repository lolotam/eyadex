import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { WhatsappStatusCard } from "./whatsapp-status-card";

vi.mock("@/shared/persona/persona-provider", () => ({ useSession: () => ({ session: null }) }));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const view: WhatsappChannelView = {
  transport: "evolution",
  status: "disconnected",
  phoneLast4: null,
  riskAcceptedAt: null,
  hasCredentials: false,
  phoneNumberId: null,
  businessAccountId: null,
  templates: {
    booked: null,
    rescheduled: null,
    cancelled: null,
    reminder_day: null,
    reminder_2h: null,
    prescription: null,
  },
  connectedAt: null,
  lastError: null,
};

const cases = [
  ["evo_connection_closed", "انقطع اتصال واتساب.", "The WhatsApp connection closed."],
  [
    "evo_not_connected",
    "جوال العيادة غير متصل بواتساب.",
    "The clinic's phone is not connected to WhatsApp.",
  ],
  ["evo_unauthorized", "رفض Evolution مفتاح الاتصال.", "Evolution refused the connection key."],
  ["meta_unauthorized", "رفضت Meta بيانات الاتصال.", "Meta refused the connection credentials."],
  [
    "meta_credentials_invalid",
    "رفضت Meta بيانات الاتصال.",
    "Meta refused the connection credentials.",
  ],
  [
    "meta_rate_limited",
    "وصل الإرسال عبر Meta إلى الحد المسموح. حاول لاحقًا.",
    "Meta's sending limit was reached. Try again later.",
  ],
  [
    "evo_timeout",
    "انتهت مهلة المحاولة دون تأكيد الإرسال.",
    "The attempt timed out without confirming delivery.",
  ],
  [
    "meta_timeout",
    "انتهت مهلة المحاولة دون تأكيد الإرسال.",
    "The attempt timed out without confirming delivery.",
  ],
  [
    "evo_unreachable",
    "تعذّر الوصول إلى خدمة واتساب. حاول لاحقًا.",
    "The WhatsApp service could not be reached. Try again later.",
  ],
  [
    "meta_unreachable",
    "تعذّر الوصول إلى خدمة واتساب. حاول لاحقًا.",
    "The WhatsApp service could not be reached. Try again later.",
  ],
  ["unknown_internal_code", "حدث خطأ في آخر محاولة", "The last attempt failed"],
  ["toString", "حدث خطأ في آخر محاولة", "The last attempt failed"],
] as const;

describe.each(["ar", "en"] as const)("WhatsApp last error in %s", (lang) => {
  it.each(cases)("localizes %s without printing its code", (code, arabic, english) => {
    window.localStorage.setItem("eyadex:language", lang);
    const { container } = render(
      <I18nProvider>
        <WhatsappStatusCard
          view={{ ...view, lastError: code }}
          editable={false}
          onDisconnect={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(lang === "ar" ? arabic : english)).toBeTruthy();
    expect(container.textContent).not.toContain(code);
  });
});
