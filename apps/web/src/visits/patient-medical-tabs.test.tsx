import type { ReactNode } from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { api, doctorAt, file, getState, startDraft } from "./medical-test-kit";
import { PATIENT_MEDICAL_TABS } from "./patient-medical-tabs";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

const shownFor = (keys: string[]) =>
  PATIENT_MEDICAL_TABS.filter((tab) => tab.visible(keys)).map((tab) => tab.id);

describe("the patient file's medical tabs, each by its key", () => {
  it("all three, in order, with the visits and medical view keys", () => {
    expect(shownFor(["view:visits:own", "view:medical:own"])).toEqual([
      "medical",
      "visits",
      "attachments",
    ]);
  });

  it("the front desk gets Visits only, never the medical file or attachments", () => {
    expect(shownFor(["view:patients:branch", "view:visits:branch"])).toEqual(["visits"]);
  });

  it("no medical or visits key: none", () => {
    expect(shownFor(["view:patients:clinic"])).toEqual([]);
  });
});

describe("the attachments tab's upload", () => {
  it.each([
    ["active", true],
    ["archived", false],
  ] as const)("an %s file: upload offered = %s, archive stays", async (status, offered) => {
    const { visit } = await startDraft();
    const D = doctorAt(0);
    await api.medical.uploadAttachment(D, visit.patientId, file("image/png", 100, "a.png"), null);
    getState().patients.find((p) => p.id === visit.patientId)!.status = status;
    const attachments = PATIENT_MEDICAL_TABS.find((tab) => tab.id === "attachments")!;
    const { permissions } = await api.session.getContext(D);
    await renderAs(
      D,
      attachments.render({ patientId: visit.patientId, patientStatus: status, permissions }),
    );
    await screen.findByText("a.png");
    expect(screen.queryByRole("button", { name: ar.attachments.upload }) !== null).toBe(offered);
    expect(screen.getByRole("button", { name: ar.attachments.archive })).toBeInTheDocument();
  });
});
