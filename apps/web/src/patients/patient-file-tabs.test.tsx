import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { PatientFileTabs, type PatientFileExtraTab } from "./patient-file-tabs";

beforeEach(() => resetMockData());
afterEach(() => cleanup());

// The patients area shows the tabs the route hands it without knowing them (§1.1); fakes stand in.
function fakeTab(id: "medical" | "visits", resource: string): PatientFileExtraTab {
  return {
    id,
    labelKey: `patientTabs.${id}`,
    visible: (keys) => keys.some((key) => key.startsWith(`view:${resource}:`)),
    render: vi.fn(({ patientStatus }) => <p>{`${id} body (${patientStatus})`}</p>),
  };
}

const tabs = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);
const T = ar.patientTabs;

describe("the patient file tabs", () => {
  it.each([
    [
      ["view:visits:branch", "view:medical:clinic"],
      [T.overview, T.visits, T.medical],
    ],
    [["view:visits:branch"], [T.overview, T.visits]],
  ])("with %j: Overview, then the visible added tabs in the route's order", async (keys, shown) => {
    const extra = [fakeTab("visits", "visits"), fakeTab("medical", "medical")];
    await renderAs(
      as("clinic_admin"),
      <PatientFileTabs
        patientId="p"
        patientStatus="active"
        overview={<p>o</p>}
        extraTabs={extra}
      />,
      keys,
    );
    expect(tabs()).toEqual(shown);
  });

  it("no visible added tab: the overview alone, with no tab bar", async () => {
    await renderAs(
      as("clinic_admin"),
      <PatientFileTabs
        patientId="p"
        patientStatus="active"
        overview={<p>overview</p>}
        extraTabs={[fakeTab("medical", "medical")]}
      />,
      ["view:patients:clinic"],
    );
    expect(tabs()).toEqual([]);
    expect(screen.getByText("overview")).toBeInTheDocument();
  });

  it("renders an added tab only once it is opened, with the file's status", async () => {
    const visits = fakeTab("visits", "visits");
    await renderAs(
      as("clinic_admin"),
      <PatientFileTabs
        patientId="p"
        patientStatus="archived"
        overview={<p>o</p>}
        extraTabs={[visits]}
      />,
      ["view:visits:branch"],
    );
    expect(visits.render).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("tab", { name: T.visits }), { button: 0 });
    expect(await screen.findByText("visits body (archived)")).toBeInTheDocument();
  });
});
