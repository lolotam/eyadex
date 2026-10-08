import { RESERVED_CLINIC_SLUGS } from "@eyadex/contracts/onboarding";
import { describe, expect, it } from "vitest";

import { checkNewClinic, RESERVED_SLUGS } from "../new-clinic.ts";

const now = new Date("2026-10-09T00:00:00Z");
const later = new Date("2026-11-09T00:00:00Z");

// PRD §4.15 + ADR-0021 (owner decision 2026-10-09): a clinic can never claim a staging host name.
describe("reserved clinic slugs", () => {
  it.each(["staging", "staging-app", "staging-platform"])("refuses %s", (slug) => {
    expect(checkNewClinic(slug, later, now)).toEqual({ ok: false, code: "reserved_slug" });
  });

  it("keeps the API list and the contract list identical", () => {
    expect([...RESERVED_SLUGS].sort()).toEqual([...RESERVED_CLINIC_SLUGS].sort());
  });

  it("still accepts an ordinary slug", () => {
    expect(checkNewClinic("staging-dental", later, now)).toEqual({ ok: true });
  });
});
