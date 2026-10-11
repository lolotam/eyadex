import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { api, doctorAt, file, getState, memberWithKeys, startDraft } from "./medical-test-kit";
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

  it("a writer without view:medical gets Attachments, for the API's file-level upload", () => {
    expect(shownFor(["view:patients:clinic", "update:medical:clinic"])).toEqual(["attachments"]);
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

// The API's file-level upload needs only the update reach and an active file (`uploadTarget` with no
// visit), while its list needs the view reach: a write-only caller uploads but never lists.
describe("the attachments tab without view:medical", () => {
  it.each([
    ["active", true],
    ["archived", false],
  ] as const)("an %s file: upload offered = %s, no list and no names", async (status, offered) => {
    const { visit } = await startDraft();
    const sent = file("image/png", 100, "private-scan.png");
    await api.medical.uploadAttachment(doctorAt(0), visit.patientId, sent, null);
    getState().patients.find((p) => p.id === visit.patientId)!.status = status;
    const P = memberWithKeys(["view:patients:clinic", "update:medical:clinic"]);
    const { permissions } = await api.session.getContext(P);
    const attachments = PATIENT_MEDICAL_TABS.find((tab) => tab.id === "attachments")!;
    await renderAs(
      P,
      attachments.render({ patientId: visit.patientId, patientStatus: status, permissions }),
    );
    await screen.findByText(offered ? ar.attachments.writeOnly : ar.attachments.hidden);
    expect(screen.queryByRole("button", { name: ar.attachments.upload }) !== null).toBe(offered);
    expect(screen.queryByText("private-scan.png")).toBeNull();
    if (offered) {
      fireEvent.change(screen.getByLabelText(ar.attachments.upload), {
        target: { files: [file("image/png", 50, "new-scan.png")] },
      });
      await waitFor(() =>
        expect(getState().medical.attachments.filter((a) => a.visitId === null)).toHaveLength(2),
      );
    }
    expect(getState().clinicAudit.some((r) => r.action === "attachment.listed")).toBe(false);
  });
});
