import { beforeEach, describe, expect, it } from "vitest";
import { api, as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { allActiveServices } from "./appointment-queries";

beforeEach(() => resetMockData());

// Codex A2 r2: the booking dialog offers every active service, not the first page only.
describe("the booking dialog's services", () => {
  it("follows the cursor past the first hundred", async () => {
    const admin = as("clinic_admin");
    for (let i = 0; i < 101; i += 1) {
      await api.scheduling.createService(
        admin,
        { nameAr: `خدمة ${i}`, nameEn: `Service ${i}`, durationMinutes: 30 },
        crypto.randomUUID(),
      );
    }
    const page = await api.scheduling.listServices(admin, {
      cursor: null,
      limit: 100,
      status: "active",
    });
    const all = await allActiveServices(api, admin);
    expect(all).toHaveLength(page.total);
    expect(all.length).toBeGreaterThan(100);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });
});
