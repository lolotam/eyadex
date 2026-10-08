import { describe, expect, it } from "vitest";
import { toAccepted, toPlatformPreview } from "@/shared/api/http/http-invitations";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { invitationCopy } from "./invitation-copy";

const lookup = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);

describe("invitation page copy by area (ADR-0020)", () => {
  it("marks a platform-team preview as platform, so its page never says clinic", () => {
    const preview = toPlatformPreview({ fullName: "Sara", email: "sara@example.test" } as never);
    expect(preview.area).toBe("platform");
    const copy = invitationCopy(preview.area ?? "clinic");
    for (const dict of [ar, en]) {
      for (const key of Object.values(copy)) {
        const text = lookup(dict, key);
        expect(typeof text).toBe("string");
        expect(text).not.toMatch(/عيادة|clinic/i);
      }
    }
  });

  it("keeps the clinic copy for a clinic invitation", () => {
    expect(invitationCopy("clinic").acceptedTitle).toBe("invite.acceptedTitle");
    expect(
      toAccepted({ clinicId: "00000000-0000-7000-8000-000000000001" } as never).clinicId,
    ).not.toBeNull();
  });
});
