import { describe, expect, it } from "vitest";

import { parseMailProviderTest } from "../domain/test-event.ts";

const legacy = {
  clinicId: "0192aaaa-0000-7000-8000-000000000001",
  providerId: "0192aaaa-0000-7000-8000-000000000002",
  providerVersion: 1,
  actorUserId: "0192aaaa-0000-7000-8000-000000000003",
};

describe("pending mail provider test event compatibility", () => {
  it("accepts a pre-slot event as a primary test", () => {
    expect(parseMailProviderTest(legacy, legacy.clinicId)).toEqual({
      ...legacy,
      slot: "primary",
    });
  });

  it("preserves an explicitly requested fallback", () => {
    expect(parseMailProviderTest({ ...legacy, slot: "fallback" }, legacy.clinicId)).toEqual({
      ...legacy,
      slot: "fallback",
    });
  });

  it.each([null, "other", "", 1])("rejects an explicitly invalid slot %j", (slot) => {
    expect(parseMailProviderTest({ ...legacy, slot }, legacy.clinicId)).toBeNull();
  });

  it("still rejects an event assigned to another clinic", () => {
    expect(parseMailProviderTest(legacy, legacy.providerId)).toBeNull();
  });
});
