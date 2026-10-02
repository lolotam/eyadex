import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";
import { MkContext } from "../mk-context";
import { KeyringAct } from "./keyring-act";

function renderKeyring(lang: "ar" | "en") {
  const d = lang === "ar" ? ar : en;
  render(
    <MkContext.Provider value={{ lang, d }}>
      <KeyringAct />
    </MkContext.Provider>,
  );
  return screen.getAllByRole("radio");
}

function expectSelected(radios: HTMLElement[], index: number) {
  radios.forEach((radio, i) => {
    expect(radio).toHaveAttribute("aria-checked", String(i === index));
    expect(radio).toHaveAttribute("tabindex", i === index ? "0" : "-1");
  });
  expect(document.activeElement).toBe(radios[index]);
}

describe("Keyring keyboard navigation", () => {
  it("mirrors horizontal arrows in RTL and supports vertical, Home, and End", () => {
    const radios = renderKeyring("ar");
    radios[0]?.focus();

    fireEvent.keyDown(radios[0] as HTMLElement, { key: "ArrowLeft" });
    expectSelected(radios, 1);
    fireEvent.keyDown(radios[1] as HTMLElement, { key: "ArrowRight" });
    expectSelected(radios, 0);
    fireEvent.keyDown(radios[0] as HTMLElement, { key: "ArrowUp" });
    expectSelected(radios, 4);
    fireEvent.keyDown(radios[4] as HTMLElement, { key: "Home" });
    expectSelected(radios, 0);
    fireEvent.keyDown(radios[0] as HTMLElement, { key: "End" });
    expectSelected(radios, 4);
    fireEvent.keyDown(radios[4] as HTMLElement, { key: "ArrowDown" });
    expectSelected(radios, 0);
  });

  it("uses the opposite horizontal direction in LTR", () => {
    const radios = renderKeyring("en");
    radios[0]?.focus();

    fireEvent.keyDown(radios[0] as HTMLElement, { key: "ArrowRight" });
    expectSelected(radios, 1);
    fireEvent.keyDown(radios[1] as HTMLElement, { key: "ArrowLeft" });
    expectSelected(radios, 0);
  });
});
