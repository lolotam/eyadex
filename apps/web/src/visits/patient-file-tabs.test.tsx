import type { ReactNode } from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientFileTabs } from "@/patients/patient-file-tabs";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { doctorAt } from "./medical-test-kit";
import { renderAs } from "./medical-ui-kit";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

const tabs = () => screen.queryAllByRole("tab").map((t) => t.textContent);
const T = ar.patientTabs;

describe("the patient file tabs, each by its key", () => {
  it("shows all four with the visits and medical view keys", async () => {
    await renderAs(doctorAt(0), <PatientFileTabs patientId="x" overview={<p>overview</p>} />, [
      "view:visits:own",
      "view:medical:own",
    ]);
    expect(tabs()).toEqual([T.overview, T.medical, T.visits, T.attachments]);
  });

  it("the front desk gets Visits only, never the medical file or attachments", async () => {
    await renderAs(doctorAt(0), <PatientFileTabs patientId="x" overview={<p>overview</p>} />, [
      "view:patients:branch",
      "view:visits:branch",
    ]);
    expect(tabs()).toEqual([T.overview, T.visits]);
  });

  it("no medical key: the overview alone, with no tab bar", async () => {
    await renderAs(doctorAt(0), <PatientFileTabs patientId="x" overview={<p>overview</p>} />, [
      "view:patients:clinic",
    ]);
    expect(tabs()).toEqual([]);
    expect(screen.getByText("overview")).toBeInTheDocument();
  });
});
